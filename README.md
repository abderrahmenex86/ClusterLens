# ClusterLens

A local-first smart gallery for recovered photo archives. It was built after a corrupted drive left thousands of photos without filenames, dates, or GPS, so it reconstructs what it can from the pixels: people, scenes, visual similarity, and a searchable library.

![ClusterLens gallery with blurred sample photos](docs/screenshots/gallery.png)

## What it does

- Indexes multiple folders in place. DCIM, Downloads, Pictures, Telegram, and Messenger folders are sources, not a special import format. Files are never moved, renamed, or deleted.
- Detects faces with InsightFace, groups unsorted faces with HDBSCAN, and keeps confirmed people stable while new photos arrive.
- Assigns new faces with k-NN over confirmed faces and an optional linear SVM trained from corrections.
- Searches the library in natural language with SigLIP image and text embeddings, then filters by person, scene, source, or year.
- Labels scenes with zero-shot prompts, so a beach, a room, a document, or a screenshot can be found without a second classifier.
- Exports full-photo copies into a people-first tree, with scenes, years, and unknown as fallbacks. Every copy is recorded in `.clusterlens/manifest.jsonl`.

## Run it

Requires Python 3.10+, Node 20.19+ (or 22.12+), and about 2 GB of disk for model weights.

```bash
git clone https://github.com/abderrahmenex86/ClusterLens.git
cd ClusterLens
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

cd frontend
npm install
npm run build
cd ..

python -m backend.app
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765). Add folders from the Sources page. The first analysis downloads the InsightFace and SigLIP weights once, then runs entirely on the machine.

For development, run `npm run dev` in `frontend` with the API on port 8765. Vite proxies `/api` to the backend. Run the backend tests with `venv/bin/python -m unittest discover -s tests`.

Set `CLUSTERLENS_DATA_DIR` to choose where the SQLite database, thumbnails, face crops, and classifier models live. The default is `~/.local/share/clusterlens`.

## How it works

Adding a source queues a background scan. The scanner hashes files, links exact duplicates to one image, and marks missing files without deleting their metadata. An analysis job then generates thumbnails, extracts face boxes and 512-D embeddings, computes a SigLIP image embedding, and stores zero-shot scene labels.

New faces first go through k-NN against confirmed faces. If a classifier is trained, its probability is used as a second opinion; uncertain faces stay in Unsorted. HDBSCAN proposes new people from that pool, and naming a proposal is what creates a person. Corrections are logged and can trigger a classifier retrain.

Search embeds the query with SigLIP and compares it to the image matrix with cosine similarity. At this library size, a matrix multiply is enough; a vector database is deliberately not part of the stack.

Export is a copy job, never a move. A photo with three confirmed people is copied into three `People/<name>/` folders. If it has no confirmed person, it falls through to `Scenes/`, then `Years/`, then `Unknown/`. The manifest records the source path, content hash, labels, and export path for every copy.

## Constraints

Sources are read-only by contract. The indexer opens them read-only, duplicate detection groups instead of moving, and export writes only to a chosen destination outside the sources. The old CLI that moved duplicates and archived originals is gone.

The app binds to `127.0.0.1`, serves the frontend from the same origin, and has no CORS or upload path. Photos stay on the machine. Model downloads are the only network calls, and only on the first run.

No vector database, no cloud queue, no hosted demo. SQLite in WAL mode, two background workers, and models cached locally are enough for a personal archive.

## Limits

- First ingest is CPU-bound. On a 6-core Ryzen 5, face detection measured about 310 ms per image; SigLIP adds roughly 0.3 s per image. Expect one to two hours for 9,000 photos. Incremental scans are fast.
- Dates come from EXIF only. Recovered file mtimes are treated as unreliable, so most photos show an unknown date instead of a made-up one.
- The folder watcher is not wired yet. Adding a source scans it; new files need a rescan until the watcher lands.
- Manual face creation and a drag-and-drop box editor are not there yet. A selected face can be reassigned, ignored, or corrected through numeric box coordinates, which re-embeds the face.
- Events are represented in the export hierarchy but not inferred yet.
- The interface is desktop-first. Mobile has a compact nav, not the full two-sidebar workflow.
- There is no authentication. That is appropriate for a localhost tool and not for a shared machine.

## Stack

FastAPI, SQLite, InsightFace, SigLIP, HDBSCAN, scikit-learn, React, TypeScript, Vite, Tailwind, Radix primitives.
