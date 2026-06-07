# ClusterLens

<div align="center">
  <p>
    <img src="https://img.shields.io/badge/PyTorch-EE4C2C?style=for-the-badge&logo=pytorch&logoColor=white" alt="PyTorch" />
    <img src="https://img.shields.io/badge/scikit_learn-F7931E?style=for-the-badge&logo=scikit-learn&logoColor=white" alt="Scikit-Learn" />
    <img src="https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI" />
    <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
  </p>
</div>

ClusterLens is an end-to-end Machine Learning pipeline and web application designed to automatically organize messy, unlabeled photo collections by the people in them.

## Features

- **Batch Perception Pipeline**: Deduplicates source images using Perceptual Hashing (pHash) and extracts 512-dimensional normalized face embeddings via the InsightFace `buffalo_l` model.
- **Density-Based Clustering**: Automatically groups faces using HDBSCAN, isolating blurred, dynamic, or occluded faces as noise ($1$) to maintain clean, high-confidence clusters.
- **Human-in-the-Loop Curation**: Features a responsive React user interface allowing users to rename generated folders, resolve identity merges, and export final named albums.
- **Open-Set Inference Classifiers**: Fits a Support Vector Machine (SVM) on human-verified data to automatically sort and route future photos into their corresponding target directories.
- **Zero-Cost Storage System**: Leverages filesystem hard links to construct physical named folders without consuming additional disk space.
- **Separation of Concerns**: Decouples the computationally heavy extraction/clustering batch tasks from the REST API to ensure memory stability and prevent web requests from timing out.

## Tech Stack

- **Machine Learning:** PyTorch, InsightFace (`buffalo_l`), HDBSCAN, Scikit-Learn (SVM), ImageHash
- **Backend Framework:** FastAPI, SQLAlchemy, SQLite
- **Frontend Framework:** ReactJS, Vite
- **Styling:** Tailwind CSS

## Getting Started

### Prerequisites
- Python (v3.10+)
- Node.js (v18+)
- Local directories configured for picture storage

### Directory Setup

Create the following directory layout on your system:
```text
~/pictures/dataset/
├── originals/      <-- Place your unstructured photos here
├── duplicates/     <-- Deduplicated files will be moved here
├── pending/        <-- Future photos for automatic sorting
└── named/          <-- Physical albums structured by identity
```

### Installation

1. **Clone the repository:**
```bash
git clone https://github.com/abderrahmenex86/ClusterLens.git
cd ClusterLens
```

2. **Install Python dependencies:**
```bash
virtualenv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

3. **Install Frontend dependencies:**
```bash
cd frontend
npm install
```

---

## How to Use It

### 1. Run the Batch Pipeline
Process, deduplicate, and extract initial facial clusters from your raw photos folder:
```bash
python cli/cli.py --input ~/pictures/dataset/originals --duplicates ~/pictures/dataset/duplicates --db ~/pictures/dataset/faces.db
```

### 2. Start the Curation Web App
Launch the backend and frontend development servers to review your clusters:

*In Terminal 1:*
```bash
python backend/server.py --db-file ~/pictures/dataset/faces.db --input-dir ~/pictures/dataset/originals
```

*In Terminal 2:*
```bash
cd frontend
npm run dev
```
Open your browser to `http://localhost:5173` to label clusters, verify alignments, and click **Export Named Clusters**.

### 3. Train the Classifier
Once identities have been verified and named, train the SVM classifier:
```bash
python cli/train_svm.py --db ~/pictures/dataset/faces.db --model-out ~/pictures/dataset/face_svm.pkl
```

### 4. Process Incoming Photos
Drop future photos into your `pending/` directory and run the classification runner to sort them using your newly trained SVM weights:
```bash
python cli/process_pending.py --pending ~/pictures/dataset/pending --named ~/pictures/dataset/named --archive ~/pictures/dataset/originals --model ~/pictures/dataset/face_svm.pkl
```
