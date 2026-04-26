# AI Face Organizer & Clusterer

An end-to-end Machine Learning pipeline and web application that automatically organizes messy, unlabeled photo collections by the people in them.

This project transforms a folder of random images into structured, named photo albums. It uses deep learning for face extraction, density-based clustering to group similar faces, a web UI for human review, and a Support Vector Machine (SVM) to learn and sort future photos automatically.

## ⚙️ System Architecture

The project is split into three decoupled microservices:

1. Batch ELT Pipeline (CLI):
    - Deduplication: Uses Perceptual Hashing (pHash) to find and remove duplicate images before processing.

    - Perception: Uses InsightFace (ArcFace) to detect faces, align them, and extract 512-dimensional vector embeddings.

    - Clustering: Uses HDBSCAN to group faces into clusters. It automatically discards blurry or hidden faces as "noise" (-1) to keep the folders clean.

    - Database: Saves all metadata to a local SQLite database so the heavy AI models only need to run once.

2. Human-in-the-Loop Web App:
    - Backend (FastAPI): A fast REST API that connects to the SQLite database. It uses thread-safe dependency injection to handle concurrent requests without locking the database.

    - Frontend (React): A user interface to review the clusters. It allows the user to easily rename clusters (e.g., "Person_4" to "Adam"), merge mistakes, and export the final albums.

3. Inference:
    - Training: Trains an open-set Support Vector Machine (SVM) on the human-verified database.

    - Stream Processing: A watchdog script that looks at a pending/ folder, classifies new photos using the SVM, and routes them to the correct named albums.

## 🚀 Key Technical Highlights

- Zero-Cost Storage (Hard Linking): Creating the final photo albums takes zero extra disk space.

- Separation of Concerns: The heavy Machine Learning tasks (which depending on the size of the dataset can take anywhere from minutes to hours) are completely separated from the REST API to prevent HTTP timeouts and memory crashes.

## 📁 Directory Structure

```text
├── cli/
│ ├── cli.py                # Batch pipeline (Deduplicate, Extract & Cluster)
│ ├── train_svm.py          # Trains the classifier on named faces
│ └── process_pending.py    # Sorts new photos automatically
├── backend/                # FastAPI Backend
├── frontend/               # React Frontend
├── requirements.txt        # Python dependencies
└── README.md
```

## 🛠️ Installation & Setup

1. Install Python dependencies:

```bash
virtualenv venv
source venv/bin/activate
pip install -r requirements.txt
```

2. Install Frontend dependencies:

```bash
cd frontend
npm install
```

3. Prepare your data folders:

Create the following directory structure and put your unorginised photos inside originals/.

```text
~/pictures/dataset/
├── originals/      <-- Put your photos here
├── duplicates/
├── pending/
└── named/
```

## 💻 How to Use It

1. Run the Batch Pipeline

- This step will move duplicates to a separate folder, extract all faces, and perform the initial clustering.

```bash
python cli/cli.py --input ~/pictures/dataset/originals --duplicates ~/pictures/dataset/duplicates --db ~/pictures/dataset/faces.db
```

2. Start the Web App

```bash
python backend/server.py --db-file ~/pictures/dataset/faces.db --input-dir ~/pictures/dataset/originals
```

```bash
cd frontend
npm run dev
```

- Open your browser to http://localhost:5173. Use the app to rename the clusters (e.g., "Abderrahmene", "Mohamed") and click Export Named Clusters.

3. Train the Model

- Now that you have labeled the data, train the SVM classifier.

```bash
python cli/train_svm.py --db ~/pictures/dataset/faces.db --model-out ~/pictures/dataset/face_svm.pkl
```

4. Process Future Photos

- Whenever you take new photos, put them in the \~/pictures/dataset/pending/ folder. Then, run the inference script to automatically sort them:

```bash
python cli/process_pending.py --pending ~/pictures/dataset/pending --named ~/pictures/dataset/named --archive ~/pictures/dataset/originals --model ~/pictures/dataset/face_svm.pkl
```
