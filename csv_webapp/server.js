const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const csvParser = require('csv-parser');
const fastcsv = require('fast-csv');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Security: Prevent access to sensitive files
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filepath) => {
        // Prevent access to CSV files from public directory
        if (filepath.endsWith('.csv')) {
            res.status(403).send('Forbidden');
        }
    }
}));
app.use('/faces', express.static(path.join(__dirname, '..', 'Actors Faces')));

// Rate limiting: Track failed attempts per movie
const failedAttempts = new Map(); // key: "IP:filename", value: { count, blockedUntil }
const MAX_ATTEMPTS = 20;
const BLOCK_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds

// Pending cast changes (in-memory storage until pushed to cloud)
// Structure: { movieName: { added: Set(), removed: Set() } }
const pendingCastChanges = new Map();

const BASE_DIR = path.join(__dirname, '..');
const RAW_DIR = path.join(BASE_DIR, 'raw_movies');
const TAGGED_DIR = path.join(BASE_DIR, 'tagged_movies');
const CAST_FILE = path.join(BASE_DIR, 'movie_cast.csv');
const STATUS_FILE = path.join(BASE_DIR, 'movie_status.csv');
const SECRETS_FILE = path.join(BASE_DIR, 'movie_secrets.csv');
const MOVIE_ASSIGNMENTS_FILE = path.join(BASE_DIR, 'Movie_Assignments.csv');

// Persistent storage on Fly. When mounted, edited CSVs live here instead of inside the repo tree.
const STORAGE_ROOT = process.env.FACE_TAGGER_STORAGE_DIR
    || (process.env.FLY_APP_NAME ? '/data/face-tagger' : path.join(BASE_DIR, '.face-tagger-data'));
const STORAGE_TAGGED_DIR = path.join(STORAGE_ROOT, 'tagged_movies');
const STORAGE_CAST_FILE = path.join(STORAGE_ROOT, 'movie_cast.csv');
const STORAGE_STATUS_FILE = path.join(STORAGE_ROOT, 'movie_status.csv');
const STORAGE_SECRETS_FILE = path.join(STORAGE_ROOT, 'movie_secrets.csv');
const STORAGE_ASSIGNMENTS_FILE = path.join(STORAGE_ROOT, 'Movie_Assignments.csv');
const writeQueues = new Map();

function ensureDirSync(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function ensureStorageLayout() {
    ensureDirSync(STORAGE_ROOT);
    ensureDirSync(STORAGE_TAGGED_DIR);
}

ensureStorageLayout();

function queueWrite(filePath, task) {
    const previous = writeQueues.get(filePath) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    writeQueues.set(filePath, next.finally(() => {
        if (writeQueues.get(filePath) === next) {
            writeQueues.delete(filePath);
        }
    }));
    return next;
}

function getPreferredFilePath(primaryPath, fallbackPath) {
    return fs.existsSync(primaryPath) ? primaryPath : fallbackPath;
}

function readCsvRowsFromFile(filePath, normalizeRow = (row) => row) {
    return new Promise((resolve, reject) => {
        const rows = [];
        if (!fs.existsSync(filePath)) return resolve(rows);

        fs.createReadStream(filePath)
            .pipe(csvParser({
                mapHeaders: ({ header }) => header.replace(/^\uFEFF/, '')
            }))
            .on('data', (row) => rows.push(normalizeRow(row)))
            .on('end', () => resolve(rows))
            .on('error', reject);
    });
}

async function readMergedCsvRows(primaryPath, fallbackPath, normalizeRow = (row) => row, keyFn = null) {
    const [primaryRows, fallbackRows] = await Promise.all([
        readCsvRowsFromFile(primaryPath, normalizeRow),
        readCsvRowsFromFile(fallbackPath, normalizeRow)
    ]);

    if (!keyFn) {
        return primaryRows.length > 0 ? primaryRows : fallbackRows;
    }

    const merged = new Map();
    fallbackRows.forEach((row) => merged.set(keyFn(row), row));
    primaryRows.forEach((row) => merged.set(keyFn(row), row));
    return [...merged.values()];
}

async function writeCsvRowsAtomically(filePath, rowsToSave) {
    ensureDirSync(path.dirname(filePath));

    return queueWrite(filePath, async () => {
        const csvString = await fastcsv.writeToString(rowsToSave, { headers: true });
        const tempPath = `${filePath}.tmp`;
        await fs.promises.writeFile(tempPath, csvString, 'utf8');
        await fs.promises.rename(tempPath, filePath);
        console.log('✅ Saved to', filePath);
        return filePath;
    });
}

let currentFile = 'adhurs.csv';
let currentMovieName = 'Adhurs';

function getUpdatedFile(filename) {
    const safeFilename = path.basename(filename || '');
    return path.join(STORAGE_TAGGED_DIR, safeFilename.replace('.csv', '_tagged.csv'));
}

function getBaseMovieName(value) {
    return (value || '')
        .toString()
        .replace(/^\uFEFF/, '')
        .replace(/^.*[\\/]/, '')
        .replace(/\.csv$/i, '')
        .replace(/_tagged$/i, '')
        .replace(/_transliterated$/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^_+|_+$/g, '');
}

function canonicalMovieKey(value) {
    return getBaseMovieName(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

function getCastMovieName(row) {
    return (row?.['Movie Name'] || '')
        .toString()
        .trim();
}

function normalizeCastRow(row) {
    return {
        'Movie Name': getCastMovieName(row),
        'Cast': (row?.Cast || '').toString().trim()
    };
}

function readCastRows() {
    // Always use local movie_cast.csv file, not cloud storage
    return readCsvRowsFromFile(CAST_FILE, normalizeCastRow);
}

function getMovieStatuses() {
    return readMergedCsvRows(
        STORAGE_STATUS_FILE,
        STATUS_FILE,
        (row) => row,
        (row) => row.filename
    ).then((rows) => {
        const statuses = {};
        rows.forEach((row) => {
            if (row.filename) statuses[row.filename] = row;
        });
        return statuses;
    });
}

// Rate limiting helpers
function getRateLimitKey(ip, filename) {
    return `${ip}:${filename}`;
}

function isBlocked(ip, filename) {
    const key = getRateLimitKey(ip, filename);
    const attempt = failedAttempts.get(key);
    if (!attempt) return false;

    if (attempt.blockedUntil && Date.now() < attempt.blockedUntil) {
        return true;
    }

    // Reset if block period has passed
    if (attempt.blockedUntil && Date.now() >= attempt.blockedUntil) {
        failedAttempts.delete(key);
        return false;
    }

    return false;
}

function recordFailedAttempt(ip, filename) {
    const key = getRateLimitKey(ip, filename);
    const attempt = failedAttempts.get(key) || { count: 0, blockedUntil: null };
    attempt.count += 1;

    if (attempt.count >= MAX_ATTEMPTS) {
        attempt.blockedUntil = Date.now() + BLOCK_DURATION;
        console.log(`🚫 IP ${ip} blocked from "${filename}" until ${new Date(attempt.blockedUntil).toLocaleString()}`);
    }

    failedAttempts.set(key, attempt);
}

function resetAttempts(ip, filename) {
    const key = getRateLimitKey(ip, filename);
    failedAttempts.delete(key);
}

function getBlockedTimeRemaining(ip, filename) {
    const key = getRateLimitKey(ip, filename);
    const attempt = failedAttempts.get(key);
    if (!attempt || !attempt.blockedUntil) return 0;

    const remaining = attempt.blockedUntil - Date.now();
    return remaining > 0 ? Math.ceil(remaining / 60000) : 0; // Return minutes
}

function verifySecret(filename, code) {
    return new Promise((resolve) => {
        // Universal code that works for any movie
        if (code === '!@Mkpkntr5038!') return resolve(true);

        const secretsPath = getPreferredFilePath(STORAGE_SECRETS_FILE, SECRETS_FILE);
        if (!fs.existsSync(secretsPath)) return resolve(true);

        let valid = false;
        let foundMovie = false;
        const targetFilename = filename.toLowerCase().replace('_tagged', '').trim();

        fs.createReadStream(secretsPath)
            .pipe(csvParser())
            .on('data', (row) => {
                if (row.filename && row.filename.toLowerCase().trim() === targetFilename) {
                    foundMovie = true;
                    if (row.secret_code === code) valid = true;
                }
            })
            .on('end', () => {
                if (foundMovie) {
                    resolve(valid);
                } else {
                    resolve(code === 'pavanKPK5038');
                }
            })
            .on('error', () => resolve(false));
    });
}

let rows = [];
let castOptions = [];

app.get('/api/files', async (req, res) => {
    const statuses = await getMovieStatuses();
    if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
    
    fs.readdir(RAW_DIR, (err, files) => {
        if (err) return res.status(500).json({ error: err.message });
        const csvFiles = files.filter(f => f.endsWith('.csv') && (!statuses[f] || statuses[f].status !== 'Complete'));
        res.json({ files: csvFiles, currentFile });
    });
});

app.get('/api/movies', async (req, res) => {
    const statuses = await getMovieStatuses();
    if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });

    fs.readdir(RAW_DIR, (err, files) => {
        if (err) return res.status(500).json({ error: err.message });
        const csvFiles = files.filter(f => f.endsWith('.csv'));
        
        csvFiles.sort((a, b) => a.localeCompare(b));
        
        const movies = csvFiles.map(f => {
            const displayName = f.replace('.csv', '').replace('_transliterated', '').trim();
            const st = statuses[f] || {};
            return {
                filename: f,
                displayName,
                status: st.status || 'Not Started',
                youtubeUrl: st.youtube_url || ''
            };
        });
        
        res.json({ movies });
    });
});

app.get('/api/actors', (req, res) => {
    const actorsDir = path.join(BASE_DIR, 'Actors Faces');
    if (!fs.existsSync(actorsDir)) return res.json({ actors: [] });
    fs.readdir(actorsDir, (err, files) => {
        if (err) return res.status(500).json({ error: err.message });
        const images = files.filter(f => f.match(/\.(jpg|jpeg|png|webp)$/i));
        res.json({ actors: images });
    });
});

app.get('/api/cast', async (req, res) => {
    const { movie } = req.query;
    if (!movie) return res.json({ cast: [] });
    console.log(`📡 Fetching cast for movie: "${movie}"`);
    const cast = await loadCastOptions(movie);
    console.log(`📡 Returning ${cast.length} cast members:`, cast);
    res.json({ cast });
});

function loadMovieUrl(movieName) {
    return new Promise((resolve) => {
        const assignmentsPath = getPreferredFilePath(STORAGE_ASSIGNMENTS_FILE, MOVIE_ASSIGNMENTS_FILE);
        if (!fs.existsSync(assignmentsPath)) return resolve(null);
        let url = null;
        const normalizedTarget = canonicalMovieKey(movieName);
        fs.createReadStream(assignmentsPath)
            .pipe(csvParser())
            .on('data', (row) => {
                if (canonicalMovieKey(row['movie_name']) === normalizedTarget) {
                    if (row['youtube_url']) url = row['youtube_url'].trim();
                }
            })
            .on('end', () => resolve(url))
            .on('error', () => resolve(url));
    });
}

// Helper to load cast (with pending changes applied)
function loadCastOptions(movieName) {
    return new Promise((resolve) => {
        let options = [];
        if (!fs.existsSync(CAST_FILE)) return resolve([]);

        const normalizedMovieName = canonicalMovieKey(movieName);

        readCastRows()
            .then((castRows) => {
                const movieRow = castRows.find(row => canonicalMovieKey(row['Movie Name']) === normalizedMovieName);
                if (movieRow?.Cast) {
                    options = movieRow.Cast.split(',').map(c => c.trim()).filter(Boolean);
                }

                // Apply pending changes for this movie (check all variations)
                for (const [pendingMovie, changes] of pendingCastChanges.entries()) {
                    if (canonicalMovieKey(pendingMovie) === normalizedMovieName) {
                        // Apply additions
                        for (const actor of changes.added) {
                            if (!options.some(a => a.toLowerCase() === actor.toLowerCase())) {
                                options.push(actor);
                            }
                        }
                        // Apply removals
                        for (const actor of changes.removed) {
                            options = options.filter(a => a.toLowerCase() !== actor.toLowerCase());
                        }
                        break;
                    }
                }
                resolve(options);
            })
            .catch(() => resolve([]));
    });
}

// Normalize actor name for deduplication (remove dots, extra spaces)
function normalizeActorName(name) {
    return name.replace(/\./g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Helper to load all available actors from Actors Faces folder
function loadAllActors() {
    return new Promise((resolve) => {
        const actorsDir = path.join(BASE_DIR, 'Actors Faces');
        if (!fs.existsSync(actorsDir)) return resolve([]);

        fs.readdir(actorsDir, (err, files) => {
            if (err) return resolve([]);
            const images = files.filter(f => f.match(/\.(jpg|jpeg|png|webp)$/i));
            const actorNames = images.map(f => f.replace(/\.(jpg|jpeg|png|webp)$/i, '')).sort();
            resolve(actorNames);
        });
    });
}

// Helper to load data
// Returns { rows, actualFilename } where actualFilename is the base name of the file that was actually loaded
function loadData(filename) {
    return new Promise((resolve) => {
        const updatedPath = getUpdatedFile(filename);
        const safeFilename = path.basename(filename || '');

        // Priority: 1. Cloud-saved tagged file, 2. Transliterated file (with speaker), 3. Original filename.
        // We intentionally do not fall back to repo-tagged CSVs here so an older deployment cannot
        // overwrite a newer cloud-saved movie.
        let fileToLoad;
        let actualFilename = safeFilename;

        if (fs.existsSync(updatedPath)) {
            fileToLoad = updatedPath;
            // Extract the actual filename from the tagged path
            actualFilename = path.basename(updatedPath).replace('_tagged.csv', '.csv');
        } else {
            // Check if the filename is already transliterated or if a transliterated version exists
            const transliteratedName = safeFilename.replace('.csv', '_transliterated.csv');
            const transliteratedPath = path.join(RAW_DIR, transliteratedName);

            if (fs.existsSync(transliteratedPath)) {
                fileToLoad = transliteratedPath;
                actualFilename = transliteratedName;
            } else {
                fileToLoad = path.join(RAW_DIR, filename);
                actualFilename = filename;
            }
        }

        const loadedRows = [];

        if (!fs.existsSync(fileToLoad)) return resolve({ rows: [], actualFilename: filename });

        fs.createReadStream(fileToLoad)
            .pipe(csvParser())
            .on('data', (row) => {
                if (typeof row.Actors === 'undefined') row.Actors = row.editable_text || '';
                delete row.editable_text;
                delete row.cast_member;
                loadedRows.push(row);
            })
            .on('end', () => resolve({ rows: loadedRows, actualFilename }))
            .on('error', () => resolve({ rows: [], actualFilename: filename }));
    });
}

function saveCSV(targetFile = currentFile, rowsToSave = rows) {
    const updatedPath = getUpdatedFile(targetFile);
    const safeTarget = path.basename(targetFile || currentFile || '');
    console.log('💾 Saving CSV...');
    console.log('  currentFile:', safeTarget);
    console.log('  updatedPath:', updatedPath);
    console.log('  rows count:', rowsToSave.length);
    console.log('  first row Actors:', rowsToSave[0]?.Actors);

    return writeCsvRowsAtomically(updatedPath, rowsToSave);
}

async function loadStatusRowsForWrite() {
    return readMergedCsvRows(
        STORAGE_STATUS_FILE,
        STATUS_FILE,
        (row) => row,
        (row) => row.filename
    );
}

function buildStatusRow(filename, status, existingRow = {}) {
    return {
        filename,
        movie_name: existingRow.movie_name || getBaseMovieName(filename),
        youtube_url: existingRow.youtube_url || '',
        status
    };
}

async function upsertMovieStatus(filename, status) {
    const safeFilename = path.basename(filename || '');
    const statuses = await loadStatusRowsForWrite();
    const existingIndex = statuses.findIndex((row) => row.filename === safeFilename);
    const existingRow = existingIndex >= 0 ? statuses[existingIndex] : {};
    const nextRow = buildStatusRow(safeFilename, status, existingRow);

    if (existingIndex >= 0) {
        statuses[existingIndex] = nextRow;
    } else {
        statuses.push(nextRow);
    }

    await writeCsvRowsAtomically(STORAGE_STATUS_FILE, statuses);
    return nextRow;
}

async function getStatusForFile(filename) {
    const statuses = await getMovieStatuses();
    return statuses[path.basename(filename || '')] || null;
}

app.get('/api/status', async (req, res) => {
    const filename = path.basename(req.query.filename || '');
    if (!filename) return res.status(400).json({ error: 'filename is required' });

    const statusRow = await getStatusForFile(filename);
    res.json({
        filename,
        status: statusRow?.status || 'Not Started',
        movie_name: statusRow?.movie_name || getBaseMovieName(filename),
        youtube_url: statusRow?.youtube_url || ''
    });
});

app.post('/api/status', async (req, res) => {
    const { filename, status, secretCode } = req.body;
    const safeFilename = path.basename(filename || '');
    if (!safeFilename || !status) {
        return res.status(400).json({ error: 'filename and status are required' });
    }

    const currentStatusRow = await getStatusForFile(safeFilename);
    const currentStatus = currentStatusRow?.status || 'Not Started';

    if (currentStatus === 'Complete' && status === 'In Progress') {
        const isLocal = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
        if (!isLocal) {
            const isAuthorized = await verifySecret(safeFilename, secretCode);
            if (!isAuthorized) {
                return res.status(401).json({ error: 'Password required to reopen a completed movie.' });
            }
        }
    }

    const updated = await upsertMovieStatus(safeFilename, status);
    res.json({ success: true, status: updated.status });
});

app.post('/api/load', async (req, res) => {
    const { filename, secretCode } = req.body;
    const clientIp = req.ip || req.connection.remoteAddress;

    const isLocal = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
    if (!isLocal) {
        // Check if IP is blocked for this specific movie
        if (isBlocked(clientIp, filename)) {
            const minutesRemaining = getBlockedTimeRemaining(clientIp, filename);
            return res.status(429).json({
                error: `Too many failed attempts for "${filename}". Please try again in ${minutesRemaining} minutes.`,
                blockedFor: minutesRemaining
            });
        }

        const isAuthorized = await verifySecret(filename, secretCode);
        if (!isAuthorized) {
            recordFailedAttempt(clientIp, filename);
            const key = getRateLimitKey(clientIp, filename);
            const attempt = failedAttempts.get(key);
            const attemptsLeft = MAX_ATTEMPTS - attempt.count;

            console.log(`❌ Failed attempt from ${clientIp} for "${filename}". Attempts left: ${attemptsLeft}`);

            return res.status(401).json({
                error: 'Incorrect or missing secret code.',
                attemptsLeft: attemptsLeft > 0 ? attemptsLeft : 0
            });
        }

        // Reset attempts on successful login for this movie
        resetAttempts(clientIp, filename);
    }

    const statuses = await getMovieStatuses();
    if (statuses[path.basename(filename)] && statuses[path.basename(filename)].status === 'Complete') {
        return res.status(403).json({ error: 'This movie is marked as Complete and cannot be edited.' });
    }

    const loadResult = await loadData(filename);
    rows = loadResult.rows;
    currentFile = loadResult.actualFilename;
    currentMovieName = getBaseMovieName(currentFile);

    castOptions = await loadCastOptions(currentMovieName);
    const allActors = await loadAllActors();

    // Deduplicate actors: combine cast + all actors, keep first occurrence
    const seenNormalized = new Map();
    const deduplicatedCast = [];
    const deduplicatedAll = [];

    // Process cast options first (they take priority)
    castOptions.forEach(actor => {
        const normalized = normalizeActorName(actor);
        if (!seenNormalized.has(normalized)) {
            seenNormalized.set(normalized, actor);
            deduplicatedCast.push(actor);
        }
    });

    // Process all actors, skip if already in cast
    allActors.forEach(actor => {
        const normalized = normalizeActorName(actor);
        if (!seenNormalized.has(normalized)) {
            seenNormalized.set(normalized, actor);
            deduplicatedAll.push(actor);
        }
    });

    const youtubeUrl = await loadMovieUrl(currentMovieName);

    res.json({
        rows,
        castOptions: deduplicatedCast,
        allActors: deduplicatedAll,
        currentFile,
        youtubeUrl,
        status: statuses[path.basename(filename)]?.status || 'Not Started'
    });
});

app.get('/api/data', async (req, res) => {
    res.json({ requiresAuth: true });
});

app.post('/api/update', async (req, res) => {
    const { arrayIndex, field, value, filename, secretCode } = req.body;

    console.log('📝 Update request:', { arrayIndex, field, value: value?.substring(0, 50), filename });

    const statuses = await getMovieStatuses();
    if (statuses[path.basename(filename)] && statuses[path.basename(filename)].status === 'Complete') {
        return res.status(403).json({ error: 'Cannot edit: Movie marked as Complete.' });
    }

    const isLocal = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
    if (!isLocal) {
        const isAuthorized = await verifySecret(filename, secretCode);
        if (!isAuthorized) return res.status(401).json({ error: 'Unauthorized save attempt.' });
    }

    // Cloud stateless fallback: If memory was wiped, reload the file
    if ((rows.length === 0 || currentFile !== filename) && filename) {
        console.log('🔄 Reloading file due to memory wipe. currentFile:', currentFile, 'filename:', filename);
        const loadResult = await loadData(filename);
        rows = loadResult.rows;
        currentFile = loadResult.actualFilename;
        console.log('✅ Reloaded. New currentFile:', currentFile, 'rows count:', rows.length);
    }

    if (rows[arrayIndex]) {
        console.log(`  Before update: rows[${arrayIndex}][${field}] =`, rows[arrayIndex][field]);
        rows[arrayIndex][field] = value;
        console.log(`  After update: rows[${arrayIndex}][${field}] =`, rows[arrayIndex][field]);
        await saveCSV(currentFile, rows);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Row not found' });
    }
});

// Added save endpoint
app.post('/api/save', async (req, res) => {
    await saveCSV();
    res.json({ success: true });
});

// Add actor to movie cast (from reference page - no auth required)
app.post('/api/add-to-movie-cast', async (req, res) => {
    const { movieName, actorName } = req.body;

    if (!movieName || !actorName) {
        return res.status(400).json({ error: 'Movie name and actor name required' });
    }

    try {
        // Initialize pending changes for this movie if needed
        if (!pendingCastChanges.has(movieName)) {
            pendingCastChanges.set(movieName, { added: new Set(), removed: new Set() });
        }

        const changes = pendingCastChanges.get(movieName);

        // If this actor was marked for removal, just unmark it
        if (changes.removed.has(actorName)) {
            changes.removed.delete(actorName);
        } else {
            // Otherwise, mark it for addition
            changes.added.add(actorName);
        }

        console.log(`📝 Queued: Add ${actorName} to ${movieName} (will save on push)`);
        return res.json({ success: true });

    } catch (err) {
        console.error('Error adding to cast:', err);
        return res.status(500).json({ error: err.message });
    }
});

// Remove actor from movie cast
app.post('/api/remove-from-movie-cast', async (req, res) => {
    const { movieName, actorName } = req.body;

    if (!movieName || !actorName) {
        return res.status(400).json({ error: 'Movie name and actor name required' });
    }

    try {
        // Initialize pending changes for this movie if needed
        if (!pendingCastChanges.has(movieName)) {
            pendingCastChanges.set(movieName, { added: new Set(), removed: new Set() });
        }

        const changes = pendingCastChanges.get(movieName);

        // If this actor was marked for addition, just unmark it
        if (changes.added.has(actorName)) {
            changes.added.delete(actorName);
        } else {
            // Otherwise, mark it for removal
            changes.removed.add(actorName);
        }

        console.log(`📝 Queued: Remove ${actorName} from ${movieName} (will save on push)`);
        return res.json({ success: true });

    } catch (err) {
        console.error('Error removing from cast:', err);
        return res.status(500).json({ error: err.message });
    }
});

// Persist movie_cast.csv to Fly storage
app.post('/api/push-cast', async (req, res) => {
    const { movieName, filename, secretCode } = req.body;

    // Require movie name to verify password
    if (!movieName && !filename) {
        return res.status(400).json({ error: 'Movie name or filename is required for authentication' });
    }

    // Check password (skip for localhost)
    const isLocal = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
    if (!isLocal) {
        const clientIp = req.ip || req.connection.remoteAddress;

        // Prefer the exact filename, because movie secrets are stored against the raw file name.
        const authFilename = filename || `${movieName}.csv`;

        // Check if IP is blocked for this movie
        if (isBlocked(clientIp, authFilename)) {
            const minutesRemaining = getBlockedTimeRemaining(clientIp, authFilename);
            return res.status(429).json({
                error: `Too many failed attempts. Please try again in ${minutesRemaining} minutes.`,
                blockedFor: minutesRemaining
            });
        }

        const isAuthorized = await verifySecret(authFilename, secretCode);
        if (!isAuthorized) {
            recordFailedAttempt(clientIp, authFilename);
            const key = getRateLimitKey(clientIp, authFilename);
            const attempt = failedAttempts.get(key);
            const attemptsLeft = MAX_ATTEMPTS - (attempt?.count || 0);

            console.log(`❌ Failed push attempt from ${clientIp} for "${movieName}". Attempts left: ${attemptsLeft}`);

            return res.status(401).json({
                error: 'Incorrect or missing secret code.',
                attemptsLeft: attemptsLeft > 0 ? attemptsLeft : 0
            });
        }

        // Reset attempts on successful authentication
        resetAttempts(clientIp, authFilename);
    }

    try {
        // First, apply all pending changes to the CSV file
        if (pendingCastChanges.size > 0) {
            console.log(`📝 Applying ${pendingCastChanges.size} pending movie cast changes...`);

            // Read current movie_cast.csv
            const castRows = await readCastRows();

            // Apply all pending changes
            for (const [movieName, changes] of pendingCastChanges.entries()) {
                let movieRow = castRows.find(r => canonicalMovieKey(r['Movie Name']) === canonicalMovieKey(movieName));

                if (!movieRow) {
                    // Create new movie entry
                    movieRow = { 'Movie Name': getBaseMovieName(movieName), 'Cast': '' };
                    castRows.push(movieRow);
                }

                // Get current cast
                let currentCast = movieRow['Cast'] ? movieRow['Cast'].split(',').map(a => a.trim()).filter(a => a) : [];

                // Apply additions
                for (const actor of changes.added) {
                    if (!currentCast.some(a => a.toLowerCase() === actor.toLowerCase())) {
                        currentCast.push(actor);
                        console.log(`  ✓ Added ${actor} to ${movieName}`);
                    }
                }

                // Apply removals
                for (const actor of changes.removed) {
                    currentCast = currentCast.filter(a => a.toLowerCase() !== actor.toLowerCase());
                    console.log(`  ✓ Removed ${actor} from ${movieName}`);
                }

                // Update the row
                movieRow['Cast'] = currentCast.join(', ');
            }

            // Write updated CSV to local file (always use local, not cloud)
            await writeCsvRowsAtomically(CAST_FILE, castRows);

            // Clear pending changes after successful save
            pendingCastChanges.clear();
            console.log('✅ All pending changes saved to local movie_cast.csv');
        }
        const persistedCast = await readCastRows();
        await writeCsvRowsAtomically(CAST_FILE, persistedCast);

        res.json({ success: true, storagePath: CAST_FILE });
    } catch (err) {
        console.error('Push error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Add actor to movie cast (from editor - with auth)
app.post('/api/add-to-cast', async (req, res) => {
    const { movieName, actorName, secretCode, filename } = req.body;

    const isLocal = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
    if (!isLocal) {
        const isAuthorized = await verifySecret(filename, secretCode);
        if (!isAuthorized) return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!movieName || !actorName) {
        return res.status(400).json({ error: 'Movie name and actor name required' });
    }

    try {
        // Queue the cast change for the next push, instead of saving immediately.
        if (!pendingCastChanges.has(movieName)) {
            pendingCastChanges.set(movieName, { added: new Set(), removed: new Set() });
        }

        const changes = pendingCastChanges.get(movieName);

        if (changes.removed.has(actorName)) {
            changes.removed.delete(actorName);
        } else {
            changes.added.add(actorName);
        }

        console.log(`📝 Queued: Add ${actorName} to ${movieName} (will save on push)`);
        const updatedCast = await loadCastOptions(movieName);
        return res.json({ success: true, cast: updatedCast });
    } catch (err) {
        console.error('Error adding to cast:', err);
        return res.status(500).json({ error: err.message });
    }
});

// Persist tagged movie CSV to Fly storage
app.post('/api/push', async (req, res) => {
    const { filename, secretCode, rows: clientRows } = req.body;
    if (!filename) return res.status(400).json({ error: 'No filename provided' });

    const isLocal = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
    if (!isLocal) {
        const isAuthorized = await verifySecret(filename, secretCode);
        if (!isAuthorized) return res.status(401).json({ error: 'Unauthorized push attempt.' });
    }

    try {
        let rowsToSave = rows;
        const safeFilename = path.basename(filename);

        if (Array.isArray(clientRows) && clientRows.length > 0) {
            rowsToSave = clientRows;
            rows = clientRows;
            currentFile = safeFilename;
        } else if ((rows.length === 0 || currentFile !== filename) && filename) {
            const loadResult = await loadData(filename);
            rowsToSave = loadResult.rows;
            rows = loadResult.rows;
            currentFile = loadResult.actualFilename;
        }

        if (!rowsToSave || rowsToSave.length === 0) {
            return res.status(400).json({ error: 'No data found to push.' });
        }

        await saveCSV(filename, rowsToSave);
        res.json({ success: true, storagePath: getUpdatedFile(filename) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/export', async (req, res) => {
    const filename = path.basename(req.query.filename || '');
    if (!filename) {
        return res.status(400).json({ error: 'filename is required' });
    }

    const taggedPath = getUpdatedFile(filename);
    const fallbackPath = path.join(RAW_DIR, filename);
    const filePath = getPreferredFilePath(taggedPath, fallbackPath);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Export file not found' });
    }

    res.download(filePath, path.basename(filePath));
});

// The server starts with cloud-backed persistent storage enabled
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

module.exports = app;
