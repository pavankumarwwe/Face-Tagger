const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const csvParser = require('csv-parser');
const fastcsv = require('fast-csv');
const multer = require('multer');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const actorsDir = path.join(__dirname, '..', 'Actors Faces');
        if (!fs.existsSync(actorsDir)) fs.mkdirSync(actorsDir, { recursive: true });
        cb(null, actorsDir);
    },
    filename: (req, file, cb) => {
        const actorName = req.body.actorName || 'Unknown';
        const ext = path.extname(file.originalname);
        cb(null, `${actorName}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'));
        }
    },
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

const app = express();
app.use(cors());
app.use(bodyParser.json());

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

const BASE_DIR = path.join(__dirname, '..');
const RAW_DIR = path.join(BASE_DIR, 'raw_movies');
const TAGGED_DIR = path.join(BASE_DIR, 'tagged_movies');
const CAST_FILE = path.join(BASE_DIR, 'movie_cast.csv');

let currentFile = 'adhurs.csv';
let currentMovieName = 'Adhurs';

function getUpdatedFile(filename) {
    if (!fs.existsSync(TAGGED_DIR)) fs.mkdirSync(TAGGED_DIR, { recursive: true });
    return path.join(TAGGED_DIR, filename.replace('.csv', '_tagged.csv'));
}

const SECRETS_FILE = path.join(BASE_DIR, 'movie_secrets.csv');

function getMovieStatuses() {
    const STATUS_FILE = path.join(BASE_DIR, 'movie_status.csv');
    return new Promise((resolve) => {
        const statuses = {};
        if (!fs.existsSync(STATUS_FILE)) return resolve(statuses);
        fs.createReadStream(STATUS_FILE)
            .pipe(csvParser())
            .on('data', (row) => {
                if (row.filename) statuses[row.filename] = row;
            })
            .on('end', () => resolve(statuses))
            .on('error', () => resolve(statuses));
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

        if (!fs.existsSync(SECRETS_FILE)) return resolve(true);

        let valid = false;
        let foundMovie = false;
        const targetFilename = filename.toLowerCase().replace('_tagged', '').trim();

        fs.createReadStream(SECRETS_FILE)
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

app.get('/api/all-actors', (req, res) => {
    const actorsDir = path.join(BASE_DIR, 'Actors Faces');
    if (!fs.existsSync(actorsDir)) return res.json({ actors: [] });
    fs.readdir(actorsDir, (err, files) => {
        if (err) return res.status(500).json({ error: err.message });
        const images = files.filter(f => f.match(/\.(jpg|jpeg|png|webp)$/i));
        // Extract actor names from filenames (remove extension)
        const actorNames = images.map(f => f.replace(/\.(jpg|jpeg|png|webp)$/i, '')).sort();
        res.json({ actors: actorNames });
    });
});

app.get('/api/cast', async (req, res) => {
    const { movie } = req.query;
    if (!movie) return res.json({ cast: [] });
    const cast = await loadCastOptions(movie);
    res.json({ cast });
});

const MOVIE_ASSIGNMENTS_FILE = path.join(BASE_DIR, 'Movie_Assignments.csv');

function loadMovieUrl(movieName) {
    return new Promise((resolve) => {
        if (!fs.existsSync(MOVIE_ASSIGNMENTS_FILE)) return resolve(null);
        let url = null;
        const normalizedTarget = movieName.trim().toLowerCase();
        fs.createReadStream(MOVIE_ASSIGNMENTS_FILE)
            .pipe(csvParser())
            .on('data', (row) => {
                if (row['movie_name'] && row['movie_name'].trim().toLowerCase() === normalizedTarget) {
                    if (row['youtube_url']) url = row['youtube_url'].trim();
                }
            })
            .on('end', () => resolve(url))
            .on('error', () => resolve(url));
    });
}

// Helper to load cast
function loadCastOptions(movieName) {
    return new Promise((resolve) => {
        let options = [];
        if (!fs.existsSync(CAST_FILE)) return resolve([]);

        fs.createReadStream(CAST_FILE)
            .pipe(csvParser())
            .on('data', (row) => {
                // simple substring match or exact match
                if (row['Movie Name'] && movieName.toLowerCase().includes(row['Movie Name'].toLowerCase())) {
                    if (row['Cast']) {
                        options = row['Cast'].split(',').map(c => c.trim()).filter(Boolean);
                    }
                }
            })
            .on('end', () => resolve(options))
            .on('error', () => resolve([]));
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

        // Priority: 1. Tagged file, 2. Transliterated file (with speaker), 3. Original filename
        let fileToLoad;
        let actualFilename = filename;

        if (fs.existsSync(updatedPath)) {
            fileToLoad = updatedPath;
            // Extract the actual filename from the tagged path
            actualFilename = path.basename(updatedPath).replace('_tagged.csv', '.csv');
        } else {
            // Check if the filename is already transliterated or if a transliterated version exists
            const transliteratedName = filename.replace('.csv', '_transliterated.csv');
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

// Save CSV
function saveCSV() {
    const updatedPath = getUpdatedFile(currentFile);
    console.log('💾 Saving CSV...');
    console.log('  currentFile:', currentFile);
    console.log('  updatedPath:', updatedPath);
    console.log('  rows count:', rows.length);
    console.log('  first row Actors:', rows[0]?.Actors);
    fastcsv.writeToPath(updatedPath, rows, { headers: true })
        .on('error', err => console.error('Error writing CSV', err))
        .on('finish', () => console.log('✅ Saved to', updatedPath));
}

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
    if (statuses[filename] && statuses[filename].status === 'Complete') {
        return res.status(403).json({ error: 'This movie is marked as Complete and cannot be edited.' });
    }

    const loadResult = await loadData(filename);
    rows = loadResult.rows;
    currentFile = loadResult.actualFilename;
    currentMovieName = currentFile.replace('.csv', '').replace('_tagged', '').replace('_transliterated', '').trim();

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
        youtubeUrl
    });
});

app.get('/api/data', async (req, res) => {
    res.json({ requiresAuth: true });
});

app.post('/api/update', async (req, res) => {
    const { arrayIndex, field, value, filename, secretCode } = req.body;

    console.log('📝 Update request:', { arrayIndex, field, value: value?.substring(0, 50), filename });

    const statuses = await getMovieStatuses();
    if (statuses[filename] && statuses[filename].status === 'Complete') {
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
        saveCSV();
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Row not found' });
    }
});

// Added save endpoint
app.post('/api/save', (req, res) => {
    saveCSV();
    res.json({ success: true });
});

// Add actor to movie cast (from reference page - no auth required)
app.post('/api/add-to-movie-cast', async (req, res) => {
    const { movieName, actorName } = req.body;

    if (!movieName || !actorName) {
        return res.status(400).json({ error: 'Movie name and actor name required' });
    }

    try {
        // Read current movie_cast.csv
        const castRows = [];
        if (fs.existsSync(CAST_FILE)) {
            await new Promise((resolve, reject) => {
                fs.createReadStream(CAST_FILE)
                    .pipe(csvParser())
                    .on('data', (row) => castRows.push(row))
                    .on('end', resolve)
                    .on('error', reject);
            });
        }

        // Find the movie row
        let movieRow = castRows.find(r => r['Movie Name'] && r['Movie Name'].toLowerCase().trim() === movieName.toLowerCase().trim());

        if (movieRow) {
            // Parse existing cast
            const currentCast = movieRow['Cast'] ? movieRow['Cast'].split(',').map(a => a.trim()) : [];

            // Check if actor already exists
            const actorExists = currentCast.some(a => a.toLowerCase() === actorName.toLowerCase());

            if (!actorExists) {
                currentCast.push(actorName);
                movieRow['Cast'] = currentCast.join(', ');

                await new Promise((resolve, reject) => {
                    fastcsv.writeToPath(CAST_FILE, castRows, { headers: true })
                        .on('error', reject)
                        .on('finish', resolve);
                });

                console.log(`✅ Added ${actorName} to ${movieName} cast`);
                return res.json({ success: true });
            } else {
                return res.json({ success: true, message: 'Actor already in cast' });
            }
        } else {
            // Movie not found - create new entry
            castRows.push({
                'Movie Name': movieName,
                'Cast': actorName
            });

            await new Promise((resolve, reject) => {
                fastcsv.writeToPath(CAST_FILE, castRows, { headers: true })
                    .on('error', reject)
                    .on('finish', resolve);
            });

            console.log(`✅ Created new movie entry and added ${actorName}`);
            return res.json({ success: true });
        }
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
        const castRows = [];
        if (fs.existsSync(CAST_FILE)) {
            await new Promise((resolve, reject) => {
                fs.createReadStream(CAST_FILE)
                    .pipe(csvParser())
                    .on('data', (row) => castRows.push(row))
                    .on('end', resolve)
                    .on('error', reject);
            });
        }

        const movieRow = castRows.find(r => r['Movie Name'] && r['Movie Name'].toLowerCase().trim() === movieName.toLowerCase().trim());

        if (movieRow) {
            const currentCast = movieRow['Cast'] ? movieRow['Cast'].split(',').map(a => a.trim()) : [];
            const updatedCast = currentCast.filter(a => a.toLowerCase() !== actorName.toLowerCase());

            movieRow['Cast'] = updatedCast.join(', ');

            await new Promise((resolve, reject) => {
                fastcsv.writeToPath(CAST_FILE, castRows, { headers: true })
                    .on('error', reject)
                    .on('finish', resolve);
            });

            console.log(`✅ Removed ${actorName} from ${movieName} cast`);
            return res.json({ success: true });
        } else {
            return res.status(404).json({ error: 'Movie not found' });
        }
    } catch (err) {
        console.error('Error removing from cast:', err);
        return res.status(500).json({ error: err.message });
    }
});

// Push movie_cast.csv to GitHub
app.post('/api/push-cast', async (req, res) => {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
    }

    try {
        const repoOwner = 'pavankumarwwe';
        const repoName = 'Face-Tagger';

        // Read movie_cast.csv
        const fileContent = fs.readFileSync(CAST_FILE, 'utf8');
        const base64Content = Buffer.from(fileContent).toString('base64');
        const githubPath = 'movie_cast.csv';
        const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${githubPath}`;

        // Get current file SHA
        let sha = null;
        const getRes = await fetch(apiUrl, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Face-Tagger-App'
            }
        });

        if (getRes.ok) {
            const getData = await getRes.json();
            sha = getData.sha;
        }

        // Push to GitHub
        const body = {
            message: `Update movie cast via Cast Images page`,
            content: base64Content
        };
        if (sha) body.sha = sha;

        const putRes = await fetch(apiUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Face-Tagger-App',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (putRes.ok) {
            console.log('✅ Pushed movie_cast.csv to GitHub');
            res.json({ success: true });
        } else {
            const errorData = await putRes.json();
            res.status(500).json({ error: errorData.message || 'GitHub API Error' });
        }
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
        // Read current movie_cast.csv
        const castRows = [];
        if (fs.existsSync(CAST_FILE)) {
            await new Promise((resolve, reject) => {
                fs.createReadStream(CAST_FILE)
                    .pipe(csvParser())
                    .on('data', (row) => castRows.push(row))
                    .on('end', resolve)
                    .on('error', reject);
            });
        }

        // Find the movie row
        let movieRow = castRows.find(r => r['Movie Name'] && r['Movie Name'].toLowerCase().trim() === movieName.toLowerCase().trim());

        if (movieRow) {
            // Parse existing cast
            const currentCast = movieRow['Cast'] ? movieRow['Cast'].split(',').map(a => a.trim()) : [];

            // Check if actor already exists (case-insensitive)
            const actorExists = currentCast.some(a => a.toLowerCase() === actorName.toLowerCase());

            if (!actorExists) {
                // Add new actor
                currentCast.push(actorName);
                movieRow['Cast'] = currentCast.join(', ');

                // Write back to CSV
                await new Promise((resolve, reject) => {
                    fastcsv.writeToPath(CAST_FILE, castRows, { headers: true })
                        .on('error', reject)
                        .on('finish', resolve);
                });

                console.log(`✅ Added ${actorName} to ${movieName} cast`);

                // Reload cast options
                const updatedCast = await loadCastOptions(movieName);
                return res.json({ success: true, cast: updatedCast });
            } else {
                // Actor already in cast
                return res.json({ success: true, cast: currentCast, message: 'Actor already in cast' });
            }
        } else {
            // Movie not found - create new entry
            castRows.push({
                'Movie Name': movieName,
                'Cast': actorName
            });

            await new Promise((resolve, reject) => {
                fastcsv.writeToPath(CAST_FILE, castRows, { headers: true })
                    .on('error', reject)
                    .on('finish', resolve);
            });

            console.log(`✅ Created new movie entry and added ${actorName} to ${movieName}`);

            const updatedCast = await loadCastOptions(movieName);
            return res.json({ success: true, cast: updatedCast });
        }
    } catch (err) {
        console.error('Error adding to cast:', err);
        return res.status(500).json({ error: err.message });
    }
});

// Upload actor photo
app.post('/api/upload-actor', upload.single('photo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const actorName = req.body.actorName;
        console.log(`✅ Uploaded photo for ${actorName}`);

        res.json({
            success: true,
            filename: req.file.filename,
            path: `/faces/${req.file.filename}`
        });
    } catch (err) {
        console.error('Error uploading actor photo:', err);
        res.status(500).json({ error: err.message });
    }
});

// Rename actor
app.post('/api/rename-actor', async (req, res) => {
    const { oldName, newName, secretCode } = req.body;

    const isLocal = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
    if (!isLocal) {
        if (!secretCode || secretCode !== '!@Mkpkntr5038!') {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    }

    if (!oldName || !newName) {
        return res.status(400).json({ error: 'Old name and new name required' });
    }

    try {
        const actorsDir = path.join(BASE_DIR, 'Actors Faces');

        // Find the old file
        const files = fs.readdirSync(actorsDir);
        const oldFile = files.find(f => {
            const nameWithoutExt = f.replace(/\.(jpg|jpeg|png|webp)$/i, '');
            return nameWithoutExt === oldName;
        });

        if (!oldFile) {
            return res.status(404).json({ error: 'Actor photo not found' });
        }

        const ext = path.extname(oldFile);
        const oldPath = path.join(actorsDir, oldFile);
        const newPath = path.join(actorsDir, `${newName}${ext}`);

        // Rename the file
        fs.renameSync(oldPath, newPath);

        console.log(`✅ Renamed actor from ${oldName} to ${newName}`);

        res.json({ success: true, newFilename: `${newName}${ext}` });
    } catch (err) {
        console.error('Error renaming actor:', err);
        res.status(500).json({ error: err.message });
    }
});

// Delete actor photo
app.post('/api/delete-actor', async (req, res) => {
    const { actorName, secretCode } = req.body;

    const isLocal = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
    if (!isLocal) {
        if (!secretCode || secretCode !== '!@Mkpkntr5038!') {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    }

    if (!actorName) {
        return res.status(400).json({ error: 'Actor name required' });
    }

    try {
        const actorsDir = path.join(BASE_DIR, 'Actors Faces');

        // Find the file
        const files = fs.readdirSync(actorsDir);
        const actorFile = files.find(f => {
            const nameWithoutExt = f.replace(/\.(jpg|jpeg|png|webp)$/i, '');
            return nameWithoutExt === actorName;
        });

        if (!actorFile) {
            return res.status(404).json({ error: 'Actor photo not found' });
        }

        const filePath = path.join(actorsDir, actorFile);
        fs.unlinkSync(filePath);

        console.log(`✅ Deleted actor photo: ${actorName}`);

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting actor:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/push', async (req, res) => {
    const { filename, secretCode } = req.body;
    if (!filename) return res.status(400).json({ error: 'No filename provided' });

    const isLocal = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
    if (!isLocal) {
        const isAuthorized = await verifySecret(filename, secretCode);
        if (!isAuthorized) return res.status(401).json({ error: 'Unauthorized push attempt.' });
    }

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        return res.status(500).json({ error: 'GITHUB_TOKEN environment variable is not set on the server.' });
    }

    try {
        const repoOwner = 'pavankumarwwe';
        const repoName = 'Face-Tagger';
        
        // Ensure rows are loaded
        if ((rows.length === 0 || currentFile !== filename) && filename) {
            const loadResult = await loadData(filename);
            rows = loadResult.rows;
            currentFile = loadResult.actualFilename;
        }

        if (rows.length === 0) {
            return res.status(400).json({ error: 'No data found to push.' });
        }

        const fileContent = await new Promise((resolve, reject) => {
            fastcsv.writeToString(rows, { headers: true })
                .then(str => resolve(str))
                .catch(err => reject(err));
        });

        const base64Content = Buffer.from(fileContent).toString('base64');
        const githubPath = `tagged_movies/${filename.replace('.csv', '_tagged.csv')}`;
        const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${githubPath}`;

        let sha = null;
        const getRes = await fetch(apiUrl, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Face-Tagger-App'
            }
        });
        
        if (getRes.ok) {
            const getData = await getRes.json();
            sha = getData.sha;
        }

        const body = {
            message: `Update ${githubPath} via web UI`,
            content: base64Content
        };
        if (sha) body.sha = sha;

        const putRes = await fetch(apiUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Face-Tagger-App',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (putRes.ok) {
            res.json({ success: true });
        } else {
            const errorData = await putRes.json();
            res.status(500).json({ error: errorData.message || 'GitHub API Error' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Push actors to GitHub (with password)
app.post('/api/push-actors', async (req, res) => {
    const { secretCode } = req.body;

    // Verify password
    if (secretCode !== '!@Mkpkntr5038!') {
        return res.status(401).json({ error: 'Incorrect password' });
    }

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
    }

    try {
        const repoOwner = 'pavankumarwwe';
        const repoName = 'Face-Tagger';
        const actorsDir = path.join(__dirname, '..', 'Actors Faces');

        // Read all files in Actors Faces directory
        const files = fs.readdirSync(actorsDir).filter(f => {
            const ext = path.extname(f).toLowerCase();
            return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
        });

        console.log(`📤 Pushing ${files.length} actor images to GitHub...`);

        let successCount = 0;
        let errorCount = 0;

        // Push each file to GitHub
        for (const fileName of files) {
            try {
                const filePath = path.join(actorsDir, fileName);
                const fileContent = fs.readFileSync(filePath);
                const base64Content = Buffer.from(fileContent).toString('base64');
                const githubPath = `Actors Faces/${fileName}`;
                const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${encodeURIComponent(githubPath)}`;

                // Get current file SHA if it exists
                let sha = null;
                const getRes = await fetch(apiUrl, {
                    headers: {
                        'Authorization': `token ${token}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'User-Agent': 'Face-Tagger-App'
                    }
                });

                if (getRes.ok) {
                    const getData = await getRes.json();
                    sha = getData.sha;
                }

                // Push to GitHub
                const body = {
                    message: `Update actor: ${fileName}`,
                    content: base64Content
                };
                if (sha) body.sha = sha;

                const putRes = await fetch(apiUrl, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `token ${token}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'User-Agent': 'Face-Tagger-App',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(body)
                });

                if (putRes.ok) {
                    successCount++;
                    console.log(`  ✓ ${fileName}`);
                } else {
                    errorCount++;
                    console.error(`  ✗ ${fileName}: ${putRes.statusText}`);
                }

                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (fileErr) {
                errorCount++;
                console.error(`  ✗ ${fileName}:`, fileErr.message);
            }
        }

        console.log(`✅ Pushed ${successCount}/${files.length} actor images to GitHub`);

        if (errorCount > 0) {
            res.json({
                success: true,
                message: `Pushed ${successCount} files, ${errorCount} errors`
            });
        } else {
            res.json({ success: true });
        }

    } catch (err) {
        console.error('Error pushing actors:', err);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

module.exports = app;
