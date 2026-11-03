# ClusterLens

Sorts an unlabelled photo collection into folders by the people in it. It finds
faces, groups them by identity, and lets you name the groups before exporting
them as albums.

## What it does

- Deduplicates source images with perceptual hashing, then extracts face
  embeddings with InsightFace `buffalo_l`.
- Groups faces with HDBSCAN, which leaves blurred, occluded, and background faces
  as noise instead of forcing them into a cluster.
- Opens a React interface for renaming clusters, merging identities that were
  split, and exporting the result.
- Fits an SVM on the identities you confirmed, so new photos can be routed into
  existing folders without clustering the whole library again.
- Builds the named folders from hard links, so exporting a collection costs no
  extra disk space.

## Run it

You need Python 3.10+ and Node 18+.

```bash
git clone https://github.com/abderrahmeneex86/ClusterLens
cd ClusterLens

python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Sort a folder of photos:

```bash
python main.py \
  --input  /path/to/mixed-photos \
  --duplicates /path/to/duplicates \
  --output /path/to/albums \
  --db faces.db
```

Optional flags: `--hash-threshold` for pHash deduplication tolerance,
`--min-cluster` (default 4) for the smallest group that counts as a person, and
`--min-samples` for how aggressively HDBSCAN discards noise.

Start the backend and the interface:

```bash
python backend/server.py --db-file faces.db --input-dir /path/to/albums --port 8000
npm --prefix frontend run dev
```

The interface reads the same database the batch job wrote.

## How it works

Detection and embedding happen once, in a batch, so a large import cannot time
out inside a request. The cluster ID becomes the unit the interface works with:
renaming writes a label, merging joins two clusters, and confirming an identity
trains the SVM. Export walks the confirmed clusters and links each matching file
into the output directory.

The SQLite database stores image paths, face embeddings, and cluster
assignments. It does not store image bytes, so the library never grows beyond the
photo folder.

## Limits

- Faces are grouped by embedding distance, so one person photographed at very
  different ages or angles can end up in two clusters. Merging is manual.
- The SVM only helps for people you have already confirmed. A stranger becomes a
  new cluster.
- Hard links stay within one filesystem. Exporting to another drive copies the
  files instead.

## Stack

PyTorch · InsightFace · imagededup · HDBSCAN · scikit-learn · FastAPI · SQLite ·
React · Vite · Tailwind CSS
