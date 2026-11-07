# ClusterLens

ClusterLens is a local-first gallery for a recovered photo archive. It indexes folders in place, reads the EXIF that survived, groups faces into people with InsightFace and HDBSCAN, labels documents and scenes with SigLIP, and exports a people-first copy of the library. It runs entirely on your machine as a FastAPI server with a React front end.

This is the 2.0.0 build. I developed and tested it on Linux against a 9,022-file recovered archive.

![People page with CelebA identity cards, face counts, and blurred faces; the sidebar shows 18 people](docs/screenshots/people-preview.png)

## Installation

### Requirements

- Python 3.10 or newer. This build is tested on Python 3.14.9.
- Node 20.19 or newer on the 20.x line, or 22.12 and later, to build the front end. This build is tested on Node 26.13.0.
- About 2 GB of free disk for model weights, plus room in the data directory for thumbnails and face crops.
- A CPU. InsightFace and SigLIP run through ONNX Runtime and PyTorch on CPU; there is no GPU path.
- Linux is the tested platform. macOS and Windows are untested. The folder picker uses `zenity` and the "open export" action uses `xdg-open`, so those optional actions need those tools.

No database server, message broker, or external service is required. SQLite is the index, and the front end is served from the same process as the API.

### Build and run

```bash
git clone https://github.com/abderrahmenex86/ClusterLens.git
cd ClusterLens
python3 -m venv venv
source venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt

cd frontend
npm install
npm run build
cd ..

python -m backend.app
```

Expected startup output:

```text
INFO:     Started server process [12345]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8765 (Press CTRL+C to quit)
```

Check that it is alive:

```bash
curl -s http://127.0.0.1:8765/api/health
```

```json
{"status":"ok","version":"2.0.0"}
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765) and add a folder from Sources. The first analysis downloads the InsightFace and SigLIP weights. No photo, face, or index data leaves the machine; the outbound traffic is the model download.

If `python3 -m venv` fails on Debian or Ubuntu, install the venv package first:

```bash
sudo apt install python3-venv
```

## Table of contents

- [What it does](#what-it-does)
- [Features](#features)
- [How it works](#how-it-works)
- [Project layout](#project-layout)
- [Configuration](#configuration)
- [Usage](#usage)
- [HTTP API](#http-api)
- [Testing](#testing)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Limits](#limits)
- [Preview data](#preview-data)
- [Stack](#stack)
- [Contributing](#contributing)
- [Licence](#licence)

## What it does

ClusterLens is for the folder you get after a drive recovery: file names are gone, duplicates are common, and EXIF is often the only reliable signal left. It does not try to repair the archive or rewrite it. It builds an index beside the originals, then gives you two ways to browse: by person and by document.

The people workflow is the main event. A scan hashes new or changed files without changing them, exact duplicates share one image record, and InsightFace finds faces in the originals. HDBSCAN proposes groups of unsorted faces, you name or merge the good ones, and a k-NN pass assigns new faces against the people you confirmed. The optional linear SVM is a second opinion for faces where k-NN is not confident. Every correction is stored, and enough corrections trigger a retrain.

Documents are the other browse mode. SigLIP compares each image against 49 scene prompts and stores the top labels. A photo lands in Documents when its primary label is one of `document`, `screenshot`, `receipt`, `whiteboard`, `paper`, `book`, or `form`. That is a zero-shot guess, not OCR, and the limits section describes where it fails.

The export is a copy job, never a move. Photos with confirmed people are copied into `People/<name>/`, photos with faces but no confirmed person go to `People/Unsorted/`, documents go to `Documents/<label>/`, and everything else goes to `Unknown/`. A photo with three confirmed people is copied three times. Every copy is recorded in `.clusterlens/manifest.jsonl`.

## Features

- Sources are indexed in place. The scanner opens files read-only, hashes changed files, links byte-identical duplicates to one image, and marks vanished files as missing without deleting their metadata.
- People are built from faces, not folder names. InsightFace detects faces, HDBSCAN proposes groups, k-NN assigns against confirmed faces, and a linear SVM can take over when k-NN is uncertain.
- A review area shows proposed people, unsorted faces, and uncertain assignments. Naming a proposal creates a person; merging a proposal moves its faces into an existing person.
- The classifier trains from confirmed faces. It needs at least two people with two faces each, holds out a stratified sample when there is enough data, and records macro F1, accuracy, class count, and the threshold used.
- The gallery groups photos by EXIF year, with unknown dates at the end. Person, scene, source, year, document, and unsorted filters are URL parameters, so a filtered view can be bookmarked.
- Documents and screenshots are a separate browse mode driven by the seven document labels. The sidebar shows the document count on the Documents row.
- The export preview reports total photos, copies, bytes, branch counts, multi-person photos, filename collisions, and free space before anything is written.
- A bottom-left activity dock shows queued, running, paused, failed, and finished jobs. Jobs can be paused, resumed, canceled, and retried; failed jobs retry up to three attempts.
- The app binds to `127.0.0.1`, serves the front end from the same origin, has no upload endpoint, and has no CORS configuration. Photos stay on disk.

![Documents view with 11 documents grouped by 2024 and 2023](docs/screenshots/documents-preview.png)

## How it works

The server has one API process, two worker threads, and a SQLite database in WAL mode. The `io` queue handles scan, thumbnail, and export jobs. The `ml` queue handles analyze, assign, cluster, train, and face re-embedding. Each queue has one worker, so ML jobs run one at a time.

A scan follows this path:

```text
POST /api/sources
  api.py: validate path, insert source, enqueue scan (io)
  jobs.py: claim the job, run handle_scan
  services.py: walk source, SHA-256 changed files, upsert images/files
  services.py: mark unseen files missing, enqueue thumbnail and analyze
  services.py: handle_thumbnail writes 256 and 1024 previews, EXIF date, pHash
  services.py: handle_analyze writes faces, image embeddings, scene labels
  services.py: enqueue assign, then cluster if enough unsorted faces remain
  app: SSE /api/stream updates the activity dock
```

The database keeps one `images` row per content hash and one `files` row per path. That is how a duplicate can appear in two source folders without being processed twice. `faces` stores normalized InsightFace embeddings and normalized bounding boxes, `people` stores confirmed names, `clusters` stores HDBSCAN proposals per run, `scene_labels` stores the top SigLIP labels, and `classifier_runs` stores the active SVM and its metrics. `face_corrections` is an append-only log of label changes, box edits, cluster accepts, and undos.

### Scan and cache

`backend/services.py:handle_scan` walks each enabled source with `os.walk`, does not follow symlinks, and skips hidden entries plus a small deny list (`node_modules`, `.git`, `venv`, `@eaDir`, and similar). Supported extensions are `.jpg`, `.jpeg`, `.png`, `.webp`, `.heic`, `.heif`, `.bmp`, `.tif`, and `.tiff`. A file whose size and `mtime_ns` match the last scan is reused without hashing.

`backend/ml.py:load_image_asset` handles EXIF orientation, reads `DateTimeOriginal`, `DateTimeDigitized`, or `DateTime`, and falls back to no date. It does not fall back to the filesystem modification time, because recovered files often have meaningless mtimes. The date source is stored as `exif` or `unknown`. `save_thumbnails` writes `256.webp` and `1024.webp` with quality 82; `save_face_crop` writes a padded 256 px WebP per face.

### Faces, people, and the classifier

`handle_analyze` runs InsightFace `buffalo_l` on CPU with a 640 by 640 detector. Faces smaller than `face_min_size` (48 px by default) or below `face_min_det_score` (0.6 by default) are discarded. Each remaining face gets a normalized 512-D embedding and a quality value equal to its smaller side in pixels.

`handle_assign` compares each unsorted face against every confirmed face. The best cosine score per person wins. A score at or above `knn_high` (0.50) assigns the face by k-NN. Below that, the SVM is consulted: its probability must be at least `classifier_threshold` (0.75), the person must be in the k-NN candidate set, and either the k-NN score is below `knn_low` (0.35) or the SVM agrees with the k-NN winner. A face that was moved away from a person is blocked from being reassigned to that same person by the next pass.

`handle_cluster` runs HDBSCAN with cosine distance, `cluster_selection_method="eom"`, `cluster_min_size` (4), and `cluster_min_samples` (3) over unsorted faces whose quality is at least `face_min_size`. A run is stored in `cluster_runs`, and each group becomes a row in `clusters`. Accepting a proposal creates a person or merges into an existing one. Old proposals from earlier runs are not shown; only the latest run is the review queue.

Training uses a linear SVM with `probability=True`, `class_weight="balanced"`, and `C=1.0`. It takes at most 200 faces per person. If there are at least two people with two faces each and enough samples for a stratified split, it holds out 20% with `random_state=1337` and records macro F1 and accuracy. Otherwise it trains on everything and leaves the metrics empty. The active model is a pickle in the data directory, and `GET /api/classifier` reports its timestamp, class count, threshold, macro F1, and how many corrections have arrived since training.

### Export

`export_preview` walks every image with at least one live file and decides a branch in this order:

1. One or more confirmed people: `People/<name>/`, one copy per person.
2. No confirmed person, but at least one visible face: `People/Unsorted/`.
3. No face, but a primary document label: `Documents/<label>/`.
4. Everything else: `Unknown/`.

The preview and the job apply the same routing rules, so the numbers you see before starting are the numbers the job tries to produce. `handle_export` copies the canonical original (the largest live file for that image), keeps the original basename, and appends `__<hash8>` when a relative path already exists. It writes each copy to a `.tmp` file and uses `os.replace` to make the final name appear atomically. The destination gets a `.clusterlens/export.json` marker and a `.clusterlens/manifest.jsonl` manifest with the image id, export path, label, person id, content hash, date, source paths, and byte size.

## Project layout

```text
backend/
  app.py        FastAPI lifespan, worker startup, SPA fallback
  api.py        all /api routes, request models, response shaping
  services.py   scan, analyze, assign, cluster, train, export
  jobs.py       SQLite job queue, workers, pause/cancel/retry
  ml.py         InsightFace, SigLIP, EXIF, thumbnails, face crops
  db.py         schema, default settings, WAL connection
  config.py     environment variables and data directory paths
frontend/
  src/App.tsx           routes and app bootstrap
  src/pages/            gallery, people, review, sources, export, settings
  src/lib/api.ts        typed API client and SSE handling
  src/components/       layout, shared UI, face context dialog
tests/test_core.py      backend unit and integration tests
docs/sample-data.md     preview dataset and licensing notes
docs/screenshots/       README images
```

## Configuration

### Environment variables

Backend variables are read at startup by `backend/config.py`. The Hugging Face flags are set by `backend/ml.py`, and `VITE_API_TARGET` is read by Vite.

| Variable | Type | Default | Effect |
|---|---|---|---|
| `CLUSTERLENS_DATA_DIR` | string | `~/.local/share/clusterlens` | Where the SQLite database, thumbnails, face crops, and classifier pickles live. |
| `CLUSTERLENS_HOST` | string | `127.0.0.1` | Bind address. Changing this exposes an unauthenticated API to the network. |
| `CLUSTERLENS_PORT` | integer | `8765` | HTTP port for the API and the built front end. |
| `CLUSTERLENS_IMAGE_MODEL` | string | `google/siglip-base-patch16-224` | Hugging Face model for image and text embeddings and scene labels. Existing images are not re-embedded or relabelled just because this changes; the analyzer selects images with a missing `faces_at`, `embed_at`, or `scene_at` timestamp. Clear those timestamps or reset the library to rebuild. |
| `CLUSTERLENS_IMAGE_MODEL_DIM` | integer | `768` | Reported by `GET /api/system/info`; not used to size or validate vectors. The model's output dimension is what gets stored. |
| `CLUSTERLENS_EMBEDDINGS` | boolean | `true` | Set to `false` to skip SigLIP image embeddings on new images. Those images get no scene labels or search vectors. Face analysis still runs. |
| `CLUSTERLENS_SCENES` | boolean | `true` | Read into the settings object but not consulted by the analyze job. Use the `scenes_enabled` setting instead. |
| `CLUSTERLENS_ML_THREADS` | integer | `6` | PyTorch CPU threads for SigLIP. It does not cap ONNX Runtime or the rest of the process. |
| `VITE_API_TARGET` | string | `http://127.0.0.1:8765` | Vite dev server proxy target. Only used by `npm run dev`. |
| `HF_HUB_DISABLE_IMPLICIT_TOKEN` | boolean | `1` if unset | Prevents an expired Hugging Face token from turning a public model download into a 401. Set by `backend/ml.py`. |
| `HF_HUB_DISABLE_TELEMETRY` | boolean | `1` if unset | Disables Hugging Face telemetry. Set by `backend/ml.py`. |

Example with an explicit data directory and a different port:

```bash
CLUSTERLENS_DATA_DIR="$HOME/.local/share/clusterlens-demo" \
CLUSTERLENS_PORT=8766 \
venv/bin/python -m backend.app
```

### Stored settings

These live in the `settings` table and can be changed from Settings or `PATCH /api/settings`. The API accepts a JSON object with a `values` key.

| Key | Default | Effect |
|---|---:|---|
| `auto_retrain_after` | 50 | Queue a classifier retrain after this many corrections since the active model was trained. `0` or a negative value disables automatic training. |
| `classifier_threshold` | 0.75 | SVM probability required before the classifier can assign a face. |
| `cluster_min_size` | 4 | Minimum faces in an HDBSCAN proposal. Also the unsorted count that triggers clustering after an analyze or assign pass. |
| `cluster_min_samples` | 3 | HDBSCAN minimum samples. Higher values produce stricter clusters and more noise. |
| `face_min_det_score` | 0.6 | InsightFace detector confidence required to keep a face. |
| `face_min_size` | 48 | Minimum face side in pixels for detection and clustering. Also used as the quality floor when clustering. |
| `knn_high` | 0.50 | Cosine similarity at or above which k-NN assigns a face directly. |
| `knn_low` | 0.35 | Below this score, a confident SVM can override the k-NN winner. Between `knn_low` and `knn_high`, the SVM can only confirm the same person. |
| `scenes_enabled` | 1 | Run SigLIP scene labeling and document classification. The Settings page exposes this as a switch. |
| `watcher_enabled` | 0 | Stored only. The folder watcher is not implemented in 2.0. |
| `embedding_model` | `google/siglip-base-patch16-224` | Stored only. The actual image model comes from `CLUSTERLENS_IMAGE_MODEL`. |

`PATCH /api/settings` ignores keys outside the allowlist and returns the full settings object after the update.

### Data directory

The default layout is:

```text
~/.local/share/clusterlens/
  clusterlens.db
  clusterlens.db-wal
  clusterlens.db-shm
  thumbs/<image_id>/256.webp
  thumbs/<image_id>/1024.webp
  face-thumbs/<face_id>.webp
  models/classifier_<unix-timestamp>.pkl
```

Model weights are not in the data directory by default. InsightFace writes to `~/.insightface/models/buffalo_l`, and Transformers uses the Hugging Face cache, normally `~/.cache/huggingface`. Set `HF_HOME` if you want that cache somewhere else.

To run two libraries side by side, give each one its own data directory and port. They do not share a database, thumbnails, or classifier:

```bash
CLUSTERLENS_DATA_DIR="$HOME/.local/share/clusterlens-personal" CLUSTERLENS_PORT=8765 venv/bin/python -m backend.app
CLUSTERLENS_DATA_DIR="$HOME/.local/share/clusterlens-demo" CLUSTERLENS_PORT=8766 venv/bin/python -m backend.app
```

## Usage

### Start the app

```bash
source venv/bin/activate
python -m backend.app
```

The front end is served from `frontend/dist`. If that directory is missing, the root page returns:

```text
Frontend build not found. Run the Vite dev server.
```

Build it with `cd frontend && npm run build`, or use the Vite dev server described under Development.

### Add a source

Open `/sources` and choose Add folders. You can paste one path per line, or use Choose folders to open a native picker. Include subfolders is on by default. The dialog queues a scan as soon as you choose Add and index.

A source cannot be the data directory, inside the data directory, or overlapping another source. The API rejects those cases before anything is scanned. Removing a source deletes its rows in `sources` and `files`; the folder and the original files stay on disk. The optional "forget" query on `DELETE /api/sources/{id}` also removes images that no longer have a file.

### Browse the gallery

All photos is the unfiltered timeline. The gallery orders known capture dates newest first and puts unknown dates at the end, then loads more photos as you scroll. The sidebar filters are People, Documents, and Needs review. A URL can carry `person`, `scene`, `source`, `year`, `unsorted`, and `document`, which makes a filtered view easy to share or bookmark.

Click a photo to open the overlay. Face boxes are clickable. From there you can assign a face to a person, create a person, move a face, mark it as not a face, open the numeric box editor, or find similar faces by cosine similarity. A box edit queues `reembed_face`, which re-runs detection and replaces the embedding only if the corrected box overlaps a detected face with IoU of at least 0.25.

### Review faces and proposals

![Review page with a proposed person, two proposals, classifier status, and blurred faces](docs/screenshots/review-preview.png)

Needs review combines the latest HDBSCAN proposals and the unsorted face queue. For a proposal, type a name and choose Create person, or choose Merge into to move the proposal's faces into a person you already have. Skip moves to the next proposal; Not a person marks the whole proposal ignored. For an individual face, Review faces lets you assign it, create a person, or mark it as not a face.

The queue counts are not a completion bar. A proposal can be a false group, and a face can be a blurry background face that should be ignored. The point of the review step is to turn the model's guesses into a small, trustworthy set of confirmed labels.

### Train the classifier

Train SVM in the top bar queues `train_classifier`. The button is disabled until at least two people have two faces each. The classifier card on Review shows the active model's timestamp, class count, threshold, macro F1, and corrections since training. The Settings page has an Assign unsorted faces button that runs a fresh k-NN and SVM pass over the current unsorted queue.

The metric is only as good as the split. A small library can put near-identical shots on both sides of the hold-out, so read the first number as a check that training ran, not as a quality claim. The Limits section has the longer version.

### Export the library

Open `/export`, set a destination, choose Preview export, then Start export. The default destination is `~/Pictures/ClusterLens Export`. The preview does not write photos; it validates the destination and counts what would be copied.

Example from the 112-photo preview library:

```bash
curl -s -X POST http://127.0.0.1:8766/api/exports/preview \
  -H 'Content-Type: application/json' \
  -d '{"destination":"/tmp/clusterlens-export"}' | python3 -m json.tool
```

```json
{
  "destination": "/tmp/clusterlens-export",
  "totalPhotos": 112,
  "copies": 112,
  "bytes": 2682584,
  "byBranch": {
    "people": 90,
    "peopleUnsorted": 10,
    "documents": 11,
    "unknown": 1
  },
  "multiPersonPhotos": 0,
  "collisions": 0,
  "freeSpace": 7159730176,
  "warnings": []
}
```

The one `unknown` photo in that library is an event ticket. SigLIP labels its primary scene as `night`, so it is not in Documents and has no face. It is a useful example of the zero-shot limit, not a bug in the export.

The destination must be empty, not exist yet, or be a previous ClusterLens export with `.clusterlens/export.json`. It cannot be inside a source or the app data directory. If a photo has multiple confirmed people, the preview warns and the job copies it once per person. Filename collisions get a short content-hash suffix. A destination that already has files but no ClusterLens marker is rejected rather than merged.

### Reset the library

Settings has a Reset library action. It clears the index and caches, can keep sources and queue a fresh scan, and never touches source files or exported folders. The confirmation dialog is explicit about that, and the API response includes `Index and caches cleared. Source files and exported folders were not touched.` Active jobs must be paused or canceled first; the API returns `409` with `Pause or cancel active jobs before resetting` otherwise.

The reset removes thumbnails, face crops, classifier pickles, and the rows in `images`, `files`, `faces`, `people`, `clusters`, `scene_labels`, `image_embeddings`, `classifier_runs`, `jobs`, `job_errors`, `exports`, and `export_items`, along with the correction and cluster-run rows. It also runs `VACUUM` on a best-effort basis. If `keep_sources` is true, sources stay and can be rescanned; if false, sources are removed too.

## HTTP API

All routes are under `/api`. FastAPI's interactive documentation is at `/docs`, and the schema is at `/openapi.json`. Errors use the standard shape:

```json
{"detail": "Not a directory: /home/me/Photos-missing"}
```

The main resource groups:

| Area | Routes |
|---|---|
| System | `GET /api/health`, `GET /api/system/info`, `POST /api/system/reset`, `POST /api/system/pick-folders`, `GET /api/system/browse`, `POST /api/system/open-folder`, `GET /api/models` |
| Settings | `GET /api/settings`, `PATCH /api/settings` |
| Sources | `GET/POST /api/sources`, `PATCH/DELETE /api/sources/{id}`, `POST /api/sources/{id}/scan`, `POST /api/sources/{id}/relink` |
| Jobs | `GET /api/jobs`, `POST /api/jobs/analyze`, `POST /api/jobs/assign`, `GET /api/jobs/{id}`, `GET /api/jobs/{id}/items`, `POST /api/jobs/{id}/pause`, `POST /api/jobs/{id}/resume`, `POST /api/jobs/{id}/cancel`, `POST /api/jobs/{id}/retry` |
| Images | `GET /api/images`, `GET /api/images/{id}`, `GET /api/images/{id}/preview`, `GET /api/images/{id}/file`, `GET /api/images/{id}/similar`, `POST /api/images/{id}/faces` |
| Search and labels | `GET /api/search`, `GET /api/scenes`, `GET /api/timeline`, `GET /api/stats` |
| People | `GET/POST /api/people`, `GET/PATCH/DELETE /api/people/{id}`, `POST /api/people/merge`, `POST /api/people/{id}/split`, `GET /api/people/{id}/faces` |
| Faces | `PATCH /api/faces/{id}`, `POST /api/faces/bulk`, `GET /api/faces/{id}/similar`, `POST /api/corrections/{id}/undo` |
| Clusters | `GET /api/clusters`, `POST /api/clusters/recluster`, `POST /api/clusters/{id}/accept`, `POST /api/clusters/{id}/ignore` |
| Review | `GET /api/review`, `GET /api/review/faces` |
| Classifier | `GET /api/classifier`, `GET /api/classifier/runs`, `POST /api/classifier/train` |
| Exports | `POST /api/exports/preview`, `POST /api/exports`, `GET /api/exports`, `GET /api/exports/{id}`, `POST /api/exports/{id}/cancel`, `POST /api/exports/{id}/open` |
| Events | `GET /api/stream` (server-sent events for job and source state) |

`GET /api/images` accepts `person_id`, `scene`, `source_id`, `year`, `has_faces`, `unsorted`, `document`, `limit` (1 to 200), and `offset`. `GET /api/search` accepts `q`, `person_id`, `scene`, `source_id`, `year`, `document`, `limit` (1 to 100), and `offset`, and returns 409 with `Image embeddings are not ready yet` until the embedding pass has produced vectors.

`POST /api/images/{id}/faces` currently returns 501 with `Manual face creation will arrive in the next iteration`. The UI creates faces through detection and edits their boxes through `PATCH /api/faces/{id}`.

### Small API example

On the preview library:

```bash
curl -s http://127.0.0.1:8766/api/stats | python3 -m json.tool
```

```json
{
  "images": 112,
  "visibleImages": 112,
  "pendingImages": 0,
  "faces": 100,
  "people": 18,
  "unsortedFaces": 10,
  "scenes": 25,
  "documents": 11,
  "sources": 1,
  "proposals": 2
}
```

`visibleImages` counts images with a thumbnail. `images` also includes images whose thumbnail failed, which is why the two numbers can differ during a run.

## Testing

Run the backend suite from the repository root:

```bash
venv/bin/python -m unittest discover -s tests
```

Expected output:

```text
.......
----------------------------------------------------------------------
Ran 7 tests in 1.306s

OK
```

The tests cover the stratified split helper, people-first export routing with multi-person copies, ignored faces staying out of person views, rejecting an export inside a source, nested source validation, a scan that does not modify source files, and thumbnail generation.

They do not test model accuracy, the browser UI, or a real archive. Those are the parts you have to check by running the app against your own folder.

Check the front end from `frontend/`:

```bash
npm run typecheck
npm run build
```

`typecheck` prints nothing on success. `build` currently ends with:

```text
dist/assets/index-CgiOeBNt.js   555.76 kB │ gzip: 167.12 kB
✓ built in 506ms
```

Vite prints a warning that the main chunk is larger than 500 kB. It is a warning, not a failure.

## Development

Run the API on 8765 and Vite on 5181 in two terminals:

```bash
source venv/bin/activate
python -m backend.app
```

```bash
cd frontend
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:8765`. If the backend is on another port, set the target before starting Vite:

```bash
VITE_API_TARGET=http://127.0.0.1:8766 npm run dev
```

The backend starts Uvicorn with `reload=False`. Restart the process after changing Python code. The front end hot-reloads through Vite.

Useful checks before a change:

```bash
venv/bin/python -m unittest discover -s tests
cd frontend && npm run typecheck && npm run build
```

`npm run lint` also exists, but the test and build commands above are the ones I run before committing. `npm run preview` serves the built `frontend/dist` through Vite; the FastAPI app already serves that build at the app root, so it is only useful for checking the static bundle in isolation.

The job queue is in `backend/jobs.py`. A worker claims the oldest queued job in its queue by priority and creation time, writes a heartbeat every 10 seconds, and checks pause and cancel flags between items. A failed job is requeued until `attempts` reaches `max_attempts` (3). On startup, `recover_stale_jobs` requeues a running job whose heartbeat is older than 120 seconds; after three attempts it becomes `failed` with `Interrupted`. This is why stopping the server in the middle of a scan does not leave a permanently running job.

## Troubleshooting

### The app opens an empty library

The default data directory is `~/.local/share/clusterlens`. If your index is somewhere else, start the app with `CLUSTERLENS_DATA_DIR` pointing at the directory that contains `clusterlens.db`. Two libraries on one machine need different data directories and different ports.

### `Not a directory: /path`

The source path does not exist, is a file, or was typed with a shell shortcut that the server did not expand. Use an absolute path. The API expands `~`, but it does not expand environment variables.

### `Folder is already a source: /path`

That exact folder is already in the source list. If you want to rescan it, use Rescan instead of adding it again.

### `Folder is inside an existing source: /path` or `Folder contains an existing source: /path`

Sources cannot overlap. Add the parent folder once and let it scan recursively, or remove the overlapping source first. Overlapping sources would index the same files twice and inflate the library.

### Source status is `offline` and the job says `Source folder is not available: /path`

The drive is unmounted, the folder was moved, or the path changed. Remount it, or relink the source:

```bash
curl -s -X POST http://127.0.0.1:8765/api/sources/1/relink \
  -H 'Content-Type: application/json' \
  -d '{"path":"/new/path/to/photos"}'
```

Relinking queues a fresh scan. If the new path is not a directory, the API returns `422` with `New path is not a directory`.

### `Export destination cannot be inside a source folder`

The export would write into a folder ClusterLens is indexing, which would make the export part of the source on the next scan. Choose a folder outside every source, for example `~/Pictures/ClusterLens Export` when the sources are under `~/Pictures/DCIM`.

### `Destination is not empty and was not created by ClusterLens`

ClusterLens only writes into an empty folder or a folder with its own `.clusterlens/export.json` marker. Pick an empty folder, or remove the old contents yourself. It will not merge into an arbitrary folder.

### `An export is already running`

The API allows one export job at a time. Wait for the current job, or cancel it from the Export page or `POST /api/exports/{id}/cancel`, then start the new one.

### `No confirmed faces to train on` or `Need at least two people with two faces each`

The SVM needs labels before it can learn. Confirm at least two faces for one person and two for another, then train again. A person with one face is still useful for k-NN, but it is not enough to train a classifier.

### `Image embeddings are not ready yet`

`GET /api/search` needs at least one image embedding. Wait for the analyze job to finish, or check whether `CLUSTERLENS_EMBEDDINGS` is set to `false`. The UI does not expose semantic search yet; this is an API-only feature in 2.0.

### `Native folder picker is not available. Install zenity or type a path.`

The Choose folders button calls `zenity`. Install it with your package manager, or paste the path into the text area. The text path is the portable option and works without a desktop environment.

### `Pause or cancel active jobs before resetting`

Reset refuses to run while a job is queued, running, or paused. Open the activity dock and pause or cancel the job, then reset. This guard exists because deleting the index under a running worker produces confusing partial state.

### `database is locked`

Another process is writing to the same SQLite file. Stop the other ClusterLens instance, or give each instance its own `CLUSTERLENS_DATA_DIR`. The connection uses WAL, a 5 second busy timeout, and `synchronous=NORMAL`; it is not designed for two writers on one database.

### Port 8765 is already in use

Start the second instance on another port:

```bash
CLUSTERLENS_PORT=8766 venv/bin/python -m backend.app
```

The health check and UI then live on `http://127.0.0.1:8766`.

## Limits

First ingest is CPU-bound. On a 6-core Ryzen 5, face detection measured about 310 ms per image and SigLIP added roughly 0.3 seconds per image. A 9,022-file archive therefore takes one to two hours for the first full analysis. Incremental scans are much faster because unchanged files are skipped by size and mtime, and because thumbnails, faces, and embeddings are reused.

Dates come only from EXIF. In the recovered archive, 7,171 of 9,022 files had a usable date, so 1,851 photos fell into the unknown group. GPS was present on 1,630 files but is not read or displayed. A file with no EXIF date is not dated from its mtime or its folder name.

Scene labels are zero-shot guesses from SigLIP, not OCR or object detection. The model has 49 prompts covering places, objects, events, and document types. It stores the top five labels with scores at or above 0.02, and only marks a primary label when the top score is at least 0.03. A document photographed at a strange angle, a receipt in low light, or a ticket with a strong `night` signal can land outside the seven document labels. The preview library has exactly that case: an event ticket is labelled `night` and goes to `Unknown` on export.

Clustering is only as good as the faces it sees. Faces smaller than `face_min_size`, below `face_min_det_score`, in profile, or partly hidden may never reach the unsorted pool. HDBSCAN can split one person across two proposals or merge two people into one. The review queue exists because those are normal failure modes, not exceptions.

The classifier's reported macro F1 is optimistic when there are only a few photos per person, because a random split can put near-duplicate shots on both sides. Treat the number as a way to notice broken training, not as a promise about your archive.

The folder watcher is not wired. `watcher_enabled` is stored, but no watchdog observer is started. New files need a rescan. Manual face creation returns 501. The box editor edits numeric coordinates rather than offering a drag handle. Person-to-person merge and split exist in the API but are not exposed as buttons; the review flow only merges a proposal into an existing person. Semantic search exists in the API but has no UI. There is no OCR, no video, no RAW support, and no undo button for corrections, although `POST /api/corrections/{id}/undo` exists.

The interface is desktop-first. A compact mobile nav exists, but the full sidebar workflow, the face overlay, and the export page are designed for a wide screen. There is no authentication. The default bind address is `127.0.0.1`, which fits a localhost tool; do not change `CLUSTERLENS_HOST` on a shared or untrusted network without putting your own access control in front of it.

The schema is created with `CREATE TABLE IF NOT EXISTS` and there is no migration framework. A schema change can require a fresh data directory or a manual SQLite migration. SQLite is also a single-writer design: one machine, one library, two worker threads. There is no vector database, cloud queue, or hosted demo. It is not a multi-user server and it is not a replacement for a cloud photo service.

## Preview data

The screenshots use a 112-photo toy library: five photos for each of 20 CelebA identities, plus 11 synthetic documents and one event ticket. The library has 100 detected faces, 18 confirmed people, 10 unsorted faces, two open proposals, 11 documents, and one source. The two proposals are `CelebA 17` and `CelebA 220`; they are left untouched so the review flow has something to show.

The classifier was trained on the 18 confirmed identities (90 faces) and reports macro F1 1.0 on a random 20% hold-out of 18 faces. With five photos per identity, that split is easy. The number verifies that training, metrics, and model persistence work; it is not a claim about face recognition in the wild.

The source images are not committed. CelebA is used locally under its non-commercial research terms, the identity labels are numeric, and the faces are blurred in every committed screenshot. The receipts, invoices, forms, notes, ticket, and code screenshot are synthetic images generated for the demo. The whiteboard is a CC BY-SA photo by Birkenkrahe. Dataset links, terms, and credits are in [docs/sample-data.md](docs/sample-data.md).

The screenshots were taken at 1440 by 900 in light mode. The app's default theme is light; the dark theme is a toggle in the top bar.

## Stack

Python 3.10+, FastAPI, SQLite in WAL mode, InsightFace buffalo_l, SigLIP base, scikit-learn (HDBSCAN and a linear SVM), React 19, TypeScript, Vite 8, Tailwind 4, and Radix primitives.

## Contributing

Issues and pull requests are welcome. Run the backend tests, `npm run typecheck`, and `npm run build` before sending a change. Keep source handling read-only, and do not add a path that writes into a source or into the app data directory.

## Licence

There is no licence file in this repository yet, so the code is not licensed for reuse. The preview data has separate terms: CelebA images are not committed and are used only under the dataset's non-commercial research terms, the synthetic documents are generated for the demo, and the whiteboard photo is CC BY-SA 3.0. See [docs/sample-data.md](docs/sample-data.md) for the dataset links and credits.
