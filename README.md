# AI-Based Smart Traffic Violation Detection and Management System

An intelligent, end-to-end traffic violation detection and video analytics application powered by **YOLOv8**, **ByteTrack**, **EasyOCR**, **FastAPI**, and **MongoDB**. The platform automatically processes video feeds, detects vehicles and motorcycles, calibrates virtual roadway boundaries, measures speeds, identifies safety violations, crops high-resolution evidence, extracts license plates via OCR, and provides an interactive web interface for human review and violation management.

---

## Table of Contents
1. [Project Overview](#project-overview)
2. [Problem Statement](#problem-statement)
3. [Key Features](#key-features)
4. [Detection Modules](#detection-modules)
5. [Technology Stack](#technology-stack)
6. [System Architecture](#system-architecture)
7. [Installation & Requirements](#installation--requirements)
8. [MongoDB Setup](#mongodb-setup)
9. [Environment Configuration](#environment-configuration)
10. [AI Models & Dependencies](#ai-models--dependencies)
11. [Backend Startup](#backend-startup)
12. [Frontend Startup](#frontend-startup)
13. [How to Use the Modules](#how-to-use-the-modules)
14. [Processing Modes: FAST vs. ACCURATE](#processing-modes-fast-vs-accurate)
15. [Evidence Generation & Human Verification Workflow](#evidence-generation--human-verification-workflow)
16. [Project Limitations & Disclaimer](#project-limitations--disclaimer)

---

## 1. Project Overview

Traffic violations such as red-light jumping, speeding, and riding motorcycles without helmets significantly increase road fatalities and strain urban traffic law enforcement. Manual monitoring via traditional CCTV requires constant human surveillance and is prone to oversight.

This system offers an automated, vision-based computer solution that processes video recordings in real time or batch mode. It detects vehicles, tracks their trajectories across frame sequences, evaluates violation thresholds based on interactive road calibration, captures cropped evidence images, performs OCR on license plates, and stores structured violation records in MongoDB for reviewer approval or rejection.

---

## 2. Problem Statement

Modern traffic management requires scalable automation capable of handling diverse camera perspectives, fluctuating traffic densities, and multiple violation types simultaneously:
- **Red Signal Jumping:** Detecting when a vehicle crosses a designated stop line while a traffic light displays RED.
- **Over-Speeding:** Calculating real-world vehicle speed across calibrated distance markers without expensive radar equipment.
- **No-Helmet Detection:** Identifying motorcycle riders traveling without protective helmets using spatial rider association and multi-frame temporal confirmation.
- **Evidence Traceability:** Capturing full evidence frames, cropped vehicle shots, and license plate crops with confidence scoring to support human verification before fine issuance.

---

## 3. Key Features

- 🚦 **Red Signal Violation Detection:** Interactive visual stop-line placement and automatic traffic signal state detection (RED / GREEN / YELLOW) via HSV color masking & intensity scoring.
- 🏎️ **Speed Violation Detection:** Calibrated dual-line speed measurement (`Line A` to `Line B`) converting pixel displacement and frame rates into real-world speed ($\text{km/h}$).
- 🪖 **No-Helmet Detection:** Spatial rider-to-motorcycle pairing and 3-frame temporal confirmation to eliminate transient false positives.
- 🎯 **Vehicle Tracking:** Multi-object tracking powered by ByteTrack for persistent ID tracking across frames.
- 🔤 **Automated License Plate Recognition (ALPR):** License plate localization and EasyOCR text extraction.
- 📸 **Tri-Crop Evidence Storage:** Automatic saving of full annotated evidence frames, vehicle crops, and localized license plate crops.
- ⚡ **Dual Processing Modes:** **FAST** mode (frame skipping for high-throughput screening) and **ACCURATE** mode (every-frame evaluation).
- 🧑‍⚖️ **Review & Verification Dashboard:** Interactive web GUI to search, view evidence images, and **Approve** or **Reject** pending violation records in MongoDB.
- 🎥 **Browser-Compatible H.264 MP4 Playback:** Automatic conversion to web-playable video format.

---

## 4. Detection Modules

### A. RED_SIGNAL Module
- **Mechanism:** User draws a stop line across the roadway canvas and optionally selects a Traffic Light Region of Interest (ROI).
- **Signal Recognition:** Evaluates color intensity in HSV space (`RED1`: $0-10^\circ$, `RED2`: $170-180^\circ$).
- **Violation Trigger:** Centroid tracking detects when a vehicle intersects the stop line segment while the signal is red.

### B. SPEED Module
- **Mechanism:** User configures two parallel measurement lines (`Line A` and `Line B`) and inputs the real-world distance between them (default: $10.0\text{ meters}$) and speed limit (default: $60.0\text{ km/h}$).
- **Speed Formula:**
  $$\text{Speed (km/h)} = \left(\frac{\text{Distance (meters)}}{\Delta t \text{ (seconds)}}\right) \times 3.6$$
  where $\Delta t = \frac{| \text{Frame}_B - \text{Frame}_A |}{\text{Video FPS}}$.
- **Violation Trigger:** Triggers when calculated speed exceeds the configured speed limit.

### C. NO_HELMET Module
- **Mechanism:** Detects motorcycles and riders (`person` class), pairs riders with their motorcycle based on bounding box geometry, and analyzes head crops using a specialized YOLO classification model.
- **Temporal Confirmation:** Requires $\ge 3$ consecutive frames of confirmed "without helmet" status to trigger a violation.

---

## 5. Technology Stack

- **Backend Framework:** Python 3.10+ / FastAPI, Uvicorn
- **Computer Vision & AI:** OpenCV, Ultralytics YOLOv8, ByteTrack, EasyOCR, NumPy
- **Database:** MongoDB / PyMongo
- **Frontend UI:** HTML5, CSS3 (Tailwind CSS, FontAwesome), Vanilla JavaScript (ES6 Modules)
- **Video Encoders:** OpenH264 / Windows Media Foundation (`cv2.CAP_MSMF`)

---

## 6. System Architecture

```
[ Video Input (.mp4) ] ──> [ FastAPI /api/upload ]
                                   │
                                   ▼
                      [ Video Processing Engine ]
                    ┌──────────────┴──────────────┐
                    │  YOLOv8 + ByteTrack Tracker │
                    └──────────────┬──────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         ▼                         ▼                         ▼
  [ RED_SIGNAL ]                [ SPEED ]              [ NO_HELMET ]
  - Stop Line Cross            - Line A -> Line B      - Rider Association
  - HSV Signal Detection       - Δt Speed Math          - Temporal Confirmation
         │                         │                         │
         └─────────────────────────┼─────────────────────────┘
                                   │
                                   ▼
                 [ Evidence Generator & EasyOCR ALPR ]
                                   │
                                   ▼
                    [ MongoDB (violation_db) ]
                                   │
                                   ▼
                 [ Frontend Web Verification Dashboard ]
```

---

## 7. Installation & Requirements

### System Requirements
- **OS:** Windows 10/11, macOS, or Linux
- **Python:** Python 3.10 or higher
- **Database:** MongoDB Community Server (Running locally on `localhost:27017` or remote URI)

### Backend Dependencies Setup
Clone the repository and set up a virtual environment:

```bash
git clone https.github.com/sowmya-sagili/Smart-traffic-violation-detection-system.git
cd Smart-traffic-violation-detection-system

# Create virtual environment
python -m venv venv

# Activate virtual environment (Windows)
venv\Scripts\activate
# Activate virtual environment (Linux/macOS)
# source venv/bin/activate

# Install required Python dependencies
pip install -r backend/requirements.txt
```

---

## 8. MongoDB Setup

Ensure MongoDB is installed and running:

1. **Download & Install:** [MongoDB Community Server](https://www.mongodb.com/try/download/community)
2. **Start Service:**
   - **Windows:** Ensure `MongoDB` service is running in Windows Services, or execute `mongod` in terminal.
   - **Linux:** `sudo systemctl start mongod`
3. Default connection string: `mongodb://localhost:27017/traffic_violation_db`

---

## 9. Environment Configuration

Copy `.env.example` to `.env` inside the project root:

```bash
cp .env.example .env
```

**.env contents:**
```env
MONGO_URI=mongodb://localhost:27017
MONGO_DB_NAME=traffic_violation_db
```

---

## 10. AI Models & Dependencies

The repository includes pre-packaged weights inside `backend/`:
- `backend/yolov8n.pt`: Vehicle detection model (YOLOv8 Nano).
- `backend/helmet_yolov8n.pt`: Fine-tuned helmet classification model.

### Note on OpenH264 / Codec Setup:
- On Windows systems, OpenCV utilizes native Windows Media Foundation (`cv2.CAP_MSMF`) to encode browser-compatible H.264 MP4 output.
- If running on a non-Windows OS or minimal Linux server, ensure `ffmpeg` or OpenH264 libraries are installed (`sudo apt-get install ffmpeg libopenh264-dev`).

---

## 11. Backend Startup

To launch the FastAPI backend server:

```bash
# Navigate to backend directory
cd backend

# Start server using Uvicorn
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

The API server will run at `http://127.0.0.1:8000`. You can inspect interactive OpenAPI documentation at `http://127.0.0.1:8000/docs`.

---

## 12. Frontend Startup

The web interface is composed of modern static HTML5/JS files.

Option A: Python HTTP Server
```bash
# From the project root directory
python -m http.server 3000 --directory frontend
```
Open `http://localhost:3000` in your web browser.

Option B: VS Code Live Server
Open `frontend/index.html` in VS Code and click **Go Live**.

---

## 13. How to Use the Modules

1. **Open Dashboard:** Navigate to `http://localhost:3000`.
2. **Select Module:** Choose **Red Signal Detection**, **Speed Detection**, or **No-Helmet Detection**.
3. **Upload or Sample Video:**
   - Click **"Load Sample Video"** to test with verified pre-configured sample videos.
   - Or upload your custom `.mp4` video.
4. **Interactive Calibration:**
   - **Red Signal:** Click "Draw Stop Line" and click two points on the roadway. Optionally select Traffic Light ROI.
   - **Speed:** Click "Draw Line A" and "Draw Line B" across the traffic flow. Adjust distance (meters) and speed limit ($\text{km/h}$).
5. **Start Processing:** Click **START DETECTION**. Monitor progress bar and FPS counter.
6. **Review Results:** View the generated H.264 video with AI overlay and examine the detected violation cards below.

---

## 14. Processing Modes: FAST vs. ACCURATE

The system supports two processing modes configured in `backend/road_config.json` or via API:
- ⚡ **FAST Mode (Default):** Processes every 2nd frame (`vid_stride=2`). Reduces execution time by ~50% with minimal loss in tracking stability. Ideal for rapid screening.
- 🎯 **ACCURATE Mode:** Processes every frame (`vid_stride=1`). Maximum precision for license plate OCR and tight temporal helmet verification.

---

## 15. Evidence Generation & Human Verification Workflow

To prevent false penalties, all AI-detected violations are flagged as `PENDING` and saved to MongoDB.

Each violation generates:
- **Full Evidence Frame:** Complete camera view showing violation bounding boxes, stop lines/speed lines, and timestamps.
- **Vehicle Crop Image:** Zoomed crop of the offending vehicle.
- **License Plate Crop:** Localized crop of the vehicle's registration plate.
- **OCR Text & Confidence:** Automatic license plate string extraction.

### Verification Dashboard Flow:
1. Open **History / View Analysis** tab in the frontend.
2. Filter violations by status (`PENDING`, `APPROVED`, `REJECTED`) or violation type.
3. Inspect evidence images and plate OCR.
4. Click **Approve** (confirms violation for processing) or **Reject** (marks false positive and archives).

---

## 16. Project Limitations & Disclaimer

- ⚠️ **Research Prototype:** This application is developed as a computer vision research prototype for traffic analytics and is **not** certified for legal-grade law enforcement or automated ticketing.
- 📏 **Speed Estimation Accuracy:** Speed calculations rely on perspective line calibration. Camera shake, steep tilt angles, or inaccurate real-world distance inputs will introduce measurement errors.
- 🌧️ **Environmental Factors:** Extreme weather, severe night time illumination, or heavy optical occlusion can affect YOLO vehicle detection and OCR accuracy.
- 🪖 **Helmet Model Scope:** No-helmet detection performance depends on rider visibility, camera resolution, and angle.

---

## License & Attribution

- **YOLOv8:** [Ultralytics AGPL-3.0 License](https://github.com/ultralytics/ultralytics)
- **ByteTrack:** [ByteTrack Repository](https://github.com/ifzhang/ByteTrack)
- **EasyOCR:** [JaidedAI Apache 2.0 License](https://github.com/JaidedAI/EasyOCR)
