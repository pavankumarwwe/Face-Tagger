const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const csvParser = require('csv-parser');
const fastcsv = require('fast-csv');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

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

function verifySecret(filename, code) {
    return new Promise((resolve) => {
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
            const displayName = f.replace('.csv', '').trim();
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

// Helper to load data
function loadData(filename) {
    return new Promise((resolve) => {
        const updatedPath = getUpdatedFile(filename);
        const fileToLoad = fs.existsSync(updatedPath) ? updatedPath : path.join(RAW_DIR, filename);
        const loadedRows = [];

        if (!fs.existsSync(fileToLoad)) return resolve([]);

        fs.createReadStream(fileToLoad)
            .pipe(csvParser())
            .on('data', (row) => {
                if (typeof row.Actors === 'undefined') row.Actors = row.editable_text || '';
                delete row.editable_text;
                delete row.cast_member;
                loadedRows.push(row);
            })
            .on('end', () => resolve(loadedRows))
            .on('error', () => resolve([]));
    });
}

// Save CSV
function saveCSV() {
    const updatedPath = getUpdatedFile(currentFile);
    fastcsv.writeToPath(updatedPath, rows, { headers: true })
        .on('error', err => console.error('Error writing CSV', err))
        .on('finish', () => console.log('Saved to', updatedPath));
}

app.post('/api/load', async (req, res) => {
    const { filename, secretCode } = req.body;
    
    const isLocal = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
    if (!isLocal) {
        const isAuthorized = await verifySecret(filename, secretCode);
        if (!isAuthorized) {
            return res.status(401).json({ error: 'Incorrect or missing secret code.' });
        }
    }

    const statuses = await getMovieStatuses();
    if (statuses[filename] && statuses[filename].status === 'Complete') {
        return res.status(403).json({ error: 'This movie is marked as Complete and cannot be edited.' });
    }

    currentFile = filename;
    currentMovieName = filename.replace('.csv', '').replace('_tagged', '').trim();

    rows = await loadData(filename);
    castOptions = await loadCastOptions(currentMovieName); // Changed from loadCast to loadCastOptions
    const youtubeUrl = await loadMovieUrl(currentMovieName);

    res.json({ rows, castOptions, currentFile, youtubeUrl });
});

app.get('/api/data', async (req, res) => {
    res.json({ requiresAuth: true });
});

app.post('/api/update', async (req, res) => {
    const { arrayIndex, field, value, filename, secretCode } = req.body;
    
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
        currentFile = filename;
        rows = await loadData(filename);
    }

    if (rows[arrayIndex]) {
        rows[arrayIndex][field] = value;
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
            currentFile = filename;
            rows = await loadData(filename);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

module.exports = app;
