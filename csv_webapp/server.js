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
app.use(express.static('public'));

const BASE_DIR = '/Users/user/Downloads/Face Tagger';
const CAST_FILE = path.join(BASE_DIR, 'movie_cast.csv');

let currentFile = 'adhurs.csv';
let currentMovieName = 'Adhurs';

function getUpdatedFile(filename) {
    return path.join(BASE_DIR, filename.replace('.csv', '_tagged.csv'));
}

let rows = [];
let castOptions = [];

// API to list CSV files
app.get('/api/files', (req, res) => {
    fs.readdir(BASE_DIR, (err, files) => {
        if (err) return res.status(500).json({ error: err.message });
        const csvFiles = files.filter(f =>
            f.endsWith('.csv') &&
            f !== 'movie_cast.csv' &&
            !f.toLowerCase().includes('movie_assignments') &&
            !f.endsWith('_tagged.csv') &&
            !f.endsWith('_transliterated.csv')
        );
        res.json({ files: csvFiles, currentFile });
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
        const fileToLoad = fs.existsSync(updatedPath) ? updatedPath : path.join(BASE_DIR, filename);
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
    const filename = req.body.filename;
    currentFile = filename;
    currentMovieName = filename.replace('.csv', '').replace('_tagged', '').trim();

    rows = await loadData(filename);
    castOptions = await loadCastOptions(currentMovieName); // Changed from loadCast to loadCastOptions
    const youtubeUrl = await loadMovieUrl(currentMovieName);

    res.json({ rows, castOptions, currentFile, youtubeUrl });
});

app.get('/api/data', async (req, res) => {
    // Initial load
    if (rows.length === 0) {
        castOptions = await loadCastOptions(currentMovieName);
        rows = await loadData(currentFile);
    }
    const youtubeUrl = await loadMovieUrl(currentMovieName);
    res.json({ rows, castOptions, currentFile, youtubeUrl });
});

app.post('/api/update', (req, res) => {
    const { arrayIndex, field, value } = req.body;
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

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
