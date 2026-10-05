# AI-Based Smart Traffic Violation Detection and Management System

An automated, intelligent computer vision and deep learning system for traffic monitoring, multi-violation detection, forensic evidence capture, license plate recognition, and human verification.

---

## 🚦 System Overview

This project provides a comprehensive traffic monitoring solution supporting three core automated violation detection pipelines:

1. **🚦 Red Signal Violation Detection (`RED_LIGHT_JUMP`)**: Tracks vehicles crossing configured stop lines during an active red traffic light phase.
2. **🏎️ Speed Violation Detection (`SPEEDING`)**: Measures vehicle speed between calibrated road measurement lines and flags vehicles exceeding posted road speed limits.
3. **🪖 No-Helmet Violation Detection (`NO_HELMET`)**: Associates detected motorcycle riders with their vehicles and verifies protective helmet compliance across multiple confirmation frames.

### Core Technologies
- **Python 3.12**
- **FastAPI & Uvicorn**: Headless asynchronous REST API
- **OpenCV**: Headless video processing, H.264 MP4 generation, and traffic light color analysis
- **Ultralytics YOLOv8**: Real-time object detection (vehicles, riders, helmets)
- **ByteTrack**: Multi-object tracking across frames with persistent Track IDs
- **EasyOCR**: Optical character recognition for vehicle license plates
- **MongoDB**: Persistent storage for processing jobs, violations, and review statuses
- **HTML5 / Modern ES6 JavaScript / Tailwind CSS**: Single-page web interface

---

## 📁 Project Architecture

```
Smart-Traffic-Violation-Detection/
├── backend/
│   ├── config.py             # System paths, constants, and hyperparameters
│   ├── database.py           # MongoDB connection pooling & CRUD operations
│   ├── detector.py           # Traffic light HSV color detector & CLAHE
│   ├── helmet_yolov8n.pt     # Helmet detection model (gitignored binary)
│   ├── main.py               # FastAPI REST API endpoints
│   ├── ocr_service.py        # EasyOCR license plate localization & recognition
│   ├── requirements.txt      # Python dependencies
│   ├── road_config.json      # Stop line, speed line, and camera calibration parameters
│   ├── utils.py              # Geometric intersection math & HUD rendering
│   ├── video_processor.py    # Core headless video processing pipeline
│   ├── yolov8n.pt            # YOLOv8n object detection model (gitignored binary)
│   ├── uploads/              # Storage directory for uploaded videos (.gitkeep)
│   ├── outputs/              # Storage directory for processed MP4 videos (.gitkeep)
│   └── evidence/             # Per-video violation evidence and crops (.gitkeep)
├── frontend/
│   ├── data.js               # API client for backend communication
│   ├── detection.js          # Overlay helper routines
│   ├── index.html            # Unified application interface
│   ├── main.js               # Frontend application controller
│   ├── screenshot.js         # Snapshot utility
│   └── style.css             # Custom styles and animations
├── FINAL_APPLICATION_REPORT.md   # Architectural integration documentation
├── PROJECT_HANDOFF_REPORT.md      # Comprehensive engineering handoff specification
├── RED_SIGNAL_VISUALIZATION_REPORT.md # Documentation of preview overlay & calibration
└── README.md                     # System documentation
```

---

## 🤖 AI Model Setup & Acquisition

To keep repository size minimal, binary model weights (`*.pt`) are excluded from Git history. Obtain the required models as follows:

### 1. Vehicle Detection Model (`yolov8n.pt`)
- **Target Location**: `backend/yolov8n.pt`
- **Source**: Official Ultralytics YOLOv8 nano COCO weights.
- **Acquisition**:
  - Automatically downloaded by Ultralytics when the application is first run, OR
  - Download manually from [Ultralytics Releases](https://github.com/ultralytics/assets/releases/download/v8.2.0/yolov8n.pt) and place in `backend/yolov8n.pt`.

### 2. Helmet Detection Model (`helmet_yolov8n.pt`)
- **Target Location**: `backend/helmet_yolov8n.pt`
- **Source**: Hugging Face Model Hub repository `iam-tsr/yolov8n-helmet-detection` (`best.pt`).
- **Acquisition**:
  - Download `best.pt` from the Hugging Face repository, rename it to `helmet_yolov8n.pt`, and place it in the `backend/` directory.
- *Notice*: Model license/provenance is not fully verified.

---

## 🚀 How to Run the Application

### 1. Prerequisites
- **Python 3.10+** (tested on Python 3.12 64-bit on Windows)
- **MongoDB** running locally on port 27017 (`mongodb://localhost:27017`)

### 2. Install Dependencies
```bash
pip install -r backend/requirements.txt
pip install lap
```
*(Note: `lap` is required by the ByteTrack tracking engine).*

### 3. Start MongoDB
Ensure the local MongoDB service is running:
```bash
mongod --dbpath <your_db_path>
```

### 4. Start the FastAPI Backend Server
From the project root:
```bash
py -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000
```
- API Base URL: `http://127.0.0.1:8000`
- Interactive API Documentation: `http://127.0.0.1:8000/docs`

### 5. Start the Frontend Web Server
In a separate terminal, from the project root:
```bash
py -m http.server 5500 --directory frontend
```

### 6. Open the Application
Open your web browser and navigate to:
```
http://127.0.0.1:5500/index.html
```

---

## ⚙️ Camera Calibration & Known Limitations

> [!WARNING]
> Stop-line coordinates and speed measurement lines in `backend/road_config.json` are **fixed geometric coordinates** tied to a specific camera perspective and resolution (1080p surveillance geometry).
>
> An arbitrary uploaded video may visibly show vehicles in an intersection, but if the road geometry or camera angle does not intersect the configured lines (`[[500, 500], [500, 900]]`), **zero violations will be recorded**. This is expected geometric behavior, not a system defect. Custom camera angles require calibrating coordinates in `backend/road_config.json`.
>
> Speed estimation is a camera-calibrated research prototype based on pixel distances and frame timing. It does not replace certified radar/LiDAR enforcement hardware.

---

## 📋 Human Review & Verification Workflow

1. Processed videos stream directly inside the workspace upon completion.
2. Every violation detected is listed with an evidence screenshot, detected vehicle crop, license plate crop, and OCR reading.
3. When license plates cannot be read with high confidence, the system falls back gracefully to `"Not Detected"` (no randomized fake plate numbers).
4. An operator can review each violation and click **Approve** (`✓`) or **Reject** (`✕`), updating the record persistently in MongoDB.
5. Historical analyses and violation cards can be re-opened anytime from the **History** tab.
