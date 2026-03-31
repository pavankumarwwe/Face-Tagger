# Face-Tagger

Face-Tagger is a small Express-based web app for reviewing movie dialogue CSVs, assigning actors to lines, managing per-movie cast lists, and exporting finished files. The hosted version is deployed on Fly.io and keeps editable movie data on persistent storage so work survives deploys and machine restarts.

## What The Hosted Site Does

The hosted site serves a browser UI for movie-by-movie tagging work.

- Lists available movie CSVs from `raw_movies/`.
- Opens a movie editor and loads either the original CSV, a transliterated CSV, or the latest saved tagged CSV.
- Lets users assign or edit actor names row by row.
- Shows cast suggestions from `movie_cast.csv`.
- Shows actor image options from `Actors Faces/`.
- Lets users add or remove cast members for a movie, then persist those changes back into `movie_cast.csv`.
- Tracks movie status such as `Not Started`, `In Progress`, and `Complete`.
- Locks completed movies from editing unless reopened with the universal password or the movie-specific secret.
- Exports the latest tagged CSV for a completed movie.

## Project Layout

### Runtime app

- [`csv_webapp/server.js`](/Users/user/Downloads/VS%20Code%20Personal%20Repos/Face-Tagger/csv_webapp/server.js): Express server and API layer.
- [`csv_webapp/public/index.html`](/Users/user/Downloads/VS%20Code%20Personal%20Repos/Face-Tagger/csv_webapp/public/index.html): movie list UI.
- [`csv_webapp/public/editor.html`](/Users/user/Downloads/VS%20Code%20Personal%20Repos/Face-Tagger/csv_webapp/public/editor.html): tagging UI.
- [`csv_webapp/public/script.js`](/Users/user/Downloads/VS%20Code%20Personal%20Repos/Face-Tagger/csv_webapp/public/script.js): browser-side editor logic.
- [`csv_webapp/public/style.css`](/Users/user/Downloads/VS%20Code%20Personal%20Repos/Face-Tagger/csv_webapp/public/style.css): shared styles.

### Main data inputs used by the app

- [`raw_movies/`](/Users/user/Downloads/VS%20Code%20Personal%20Repos/Face-Tagger/raw_movies): source movie CSVs that appear in the site.
- [`movie_cast.csv`](/Users/user/Downloads/VS%20Code%20Personal%20Repos/Face-Tagger/movie_cast.csv): cast list per movie. The app reads this for cast suggestions and writes back to this file when cast changes are pushed.
- [`Actors Faces/`](/Users/user/Downloads/VS%20Code%20Personal%20Repos/Face-Tagger/Actors%20Faces): actor images served publicly by the app at `/faces/...`.
- [`movie_secrets.csv`](/Users/user/Downloads/VS%20Code%20Personal%20Repos/Face-Tagger/movie_secrets.csv): optional per-movie secret codes for access control. This file is intentionally gitignored.
- [`Movie_Assignments.csv`](/Users/user/Downloads/VS%20Code%20Personal%20Repos/Face-Tagger/Movie_Assignments.csv): optional movie metadata, currently used for YouTube URLs. This file is intentionally gitignored.

### Persistent output written by the app

- `.face-tagger-data/tagged_movies/`: local persistent tagged CSV output when running outside Fly.io.
- `.face-tagger-data/movie_status.csv`: local persistent movie statuses when running outside Fly.io.
- `.face-tagger-data/movie_secrets.csv`: optional local override copy if written into storage.
- `.face-tagger-data/Movie_Assignments.csv`: optional local override copy if written into storage.
- `/data/face-tagger/tagged_movies/`: Fly.io persistent tagged CSV output in production.
- `/data/face-tagger/movie_status.csv`: Fly.io persistent movie status file in production.
- `/data/face-tagger/movie_secrets.csv`: optional production secrets override if present.
- `/data/face-tagger/Movie_Assignments.csv`: optional production assignments override if present.

### Helper or support data not consumed by the live site

- [`Actors Database/`](/Users/user/Downloads/VS%20Code%20Personal%20Repos/Face-Tagger/Actors%20Database): generated face-cropped thumbnails for memR or similar external UI use. The current site does not read this folder.
- [`missing_actor_photos.csv`](/Users/user/Downloads/VS%20Code%20Personal%20Repos/Face-Tagger/missing_actor_photos.csv): helper tracking file, not used by the server.
- [`missing_movie_titles.csv`](/Users/user/Downloads/VS%20Code%20Personal%20Repos/Face-Tagger/missing_movie_titles.csv): helper tracking file, not used by the server.
- [`proper_portrait_not_found.csv`](/Users/user/Downloads/VS%20Code%20Personal%20Repos/Face-Tagger/proper_portrait_not_found.csv): helper tracking file, not used by the server.
- [`scripts/build_actors_database.swift`](/Users/user/Downloads/VS%20Code%20Personal%20Repos/Face-Tagger/scripts/build_actors_database.swift): utility script to generate `Actors Database/`; it is not part of the runtime server.
- [`vercel.json`](/Users/user/Downloads/VS%20Code%20Personal%20Repos/Face-Tagger/vercel.json): present in the repo but not used by the current Fly.io deployment flow.

## File Selection Rules In The App

When a movie is opened, the server chooses the CSV in this order:

1. A previously saved tagged file from persistent storage: `tagged_movies/<movie>_tagged.csv`
2. A transliterated raw file from `raw_movies/<movie>_transliterated.csv`
3. The original raw file from `raw_movies/<movie>.csv`

When exporting, the server prefers the saved tagged file. If no tagged version exists yet, it falls back to the raw movie CSV.

## What The App Reads And Writes

### Reads

- Reads movie list from `raw_movies/`.
- Reads cast options from `movie_cast.csv`.
- Reads actor image filenames from `Actors Faces/`.
- Reads movie completion status from persistent storage first, then falls back to the repo copy if present.
- Reads secrets and movie assignments from persistent storage first, then falls back to the repo copy.

### Writes

- Writes tagged CSV edits into persistent `tagged_movies/`.
- Writes movie status updates into persistent `movie_status.csv`.
- Writes cast updates back into the repo-root `movie_cast.csv`.

### Does not write

- Does not write back into `raw_movies/`.
- Does not write anything into `Actors Faces/`.
- Does not consume or update `Actors Database/`.

## Security And Access Behavior

- The app blocks direct static access to `.csv` files under the public directory.
- Actor images are intentionally exposed from `Actors Faces/` through `/faces`.
- Completed movies are blocked from editing unless reopened.
- Localhost skips password checks for convenience.
- Remote access uses movie-specific secrets when available.
- There is also a universal password path in the server logic for reopening completed movies.
- Failed remote password attempts are rate-limited per IP and movie.

## Local Development

### Requirements

- Node.js 18+ is recommended.
- npm is required.

### Install

Run from the repo root:

```bash
cd csv_webapp
npm install
```

### Start

```bash
cd csv_webapp
npm start
```

The server starts on `http://localhost:3000`.

Local development uses:

- repo-root files such as `raw_movies/`, `movie_cast.csv`, and `Actors Faces/`
- persistent local storage under [`.face-tagger-data/`](/Users/user/Downloads/VS%20Code%20Personal%20Repos/Face-Tagger/.face-tagger-data)

You can also override the storage location with the `FACE_TAGGER_STORAGE_DIR` environment variable.

## Fly.io Deployment

Deployment is configured with:

- [`Dockerfile`](/Users/user/Downloads/VS%20Code%20Personal%20Repos/Face-Tagger/Dockerfile)
- [`fly.toml`](/Users/user/Downloads/VS%20Code%20Personal%20Repos/Face-Tagger/fly.toml)

Current production behavior:

- The container runs `node csv_webapp/server.js`.
- Fly exposes port `3000`.
- A volume is mounted at `/data`.
- The app stores persistent runtime data under `/data/face-tagger`.

This means deploys can replace the container image without losing tagged CSVs and status metadata.

## Notes And Caveats

- `movie_cast.csv` is intentionally read from and written to the repo-root file, not the Fly storage directory.
- `tagged_movies/` at repo root is defined in server constants but is not the active save target; persistent storage is used instead.
- Duplicate actor source images with the same stem but different extensions can result in duplicate generated files in `Actors Database/` with suffixes such as `__webp`.
- Sensitive files such as `movie_secrets.csv` and `Movie_Assignments.csv` are gitignored and should not be committed.
