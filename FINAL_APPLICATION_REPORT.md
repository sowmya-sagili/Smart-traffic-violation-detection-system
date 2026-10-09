# Final Application Integration & Architecture Report

**Project Name:** AI-Based Smart Traffic Violation Detection and Management System  
**Version:** Final Consolidated Release (v2.0)  
**System Status:** Fully Integrated, Tested & Verified  
**Date:** October 5, 2026  

---

## 1. Final Architecture

The system strictly adheres to the clean, understandable B.Tech project architecture without nested packages, microservices, or complex external frameworks:

```
Smart-Traffic-Violation-Detection/
├── backend/
│   ├── config.py                 # System paths, constants, and hyperparameters
│   ├── database.py               # PyMongo MongoDB client & CRUD queries
│   ├── detector.py               # Traffic light HSV color detection & ROI extractor
│   ├── helmet_yolov8n.pt         # Pretrained YOLOv8 helmet detection model weights
│   ├── main.py                   # FastAPI REST API & background task dispatcher
│   ├── ocr_service.py            # EasyOCR license plate localization and recognition
│   ├── requirements.txt          # Production Python dependencies
│   ├── road_config.json          # Calibrated road lines, speed limits, and thresholds
│   ├── utils.py                  # Geometric calculations & OpenCV annotation helpers
│   ├── video_processor.py        # Core computer vision detection & tracking engine
│   ├── yolov8n.pt                # Pretrained YOLOv8n vehicle & person detection weights
│   ├── uploads/                  # Storage directory for uploaded source videos
│   ├── outputs/                  # Storage directory for annotated H.264 MP4 videos
│   └── evidence/                 # Per-video violation evidence frames and crops
├── frontend/
│   ├── data.js                   # Client API helpers for FastAPI backend endpoints
│   ├── detection.js              # HTML5 canvas overlay coordinate mapper
│   ├── index.html                # Unified single-page responsive dashboard & interface
│   ├── main.js                   # Application state manager & workflow coordinator
│   ├── screenshot.js             # Client-side video snapshot utility
│   └── style.css                 # Custom styles, glow accents, and responsive layout

```

---

## 2. Three Core Detection Modules

The final application integrates exactly three core violation detection pipelines:

1. **🚦 RED SIGNAL VIOLATION (`RED_SIGNAL`):**
   - Monitors intersections for vehicles crossing configured stop lines during active red traffic signals.
2. **🏎️ SPEED VIOLATION (`SPEED`):**
   - Estimates vehicle speeds between calibrated measurement lines and flags vehicles exceeding speed thresholds.
3. **🪖 NO HELMET VIOLATION (`NO_HELMET`):**
   - Identifies motorcycles, attributes riders geometrically, and classifies protective helmet compliance.

*(Note: Lane violation is omitted as per finalized project specifications).*

---

## 3. Artificial Intelligence Models

| Component | Model Name / Framework | Purpose | Input / Target |
| :--- | :--- | :--- | :--- |
| **Vehicle & Person Detection** | Ultralytics YOLOv8n (`yolov8n.pt`) | Detects cars, buses, trucks, motorcycles, and persons | 640×640 RGB Frames |
| **Multi-Object Tracking** | ByteTrack (`bytetrack.yaml`) | Associates bounding boxes across frames with persistent Track IDs | Tracklets & Kalman filtering |
| **Helmet Detection** | YOLOv8n fine-tuned (`helmet_yolov8n.pt`) | Classifies riders as wearing or not wearing a helmet | Cropped rider head/torso regions |
| **Optical Character Recognition** | EasyOCR (`torch` + `CRAFT`) | Reads license plate alphanumeric registration numbers | Bounding box plate crops |

---

## 4. Red Signal Detection Algorithm

- **Traffic Light State:** Analyzed from the configured Traffic Light ROI (`traffic_light_roi` in `backend/road_config.json`) using dual HSV color mask thresholding (`detector.py`):
  - Red Range 1: `H: [0, 10], S: [80, 255], V: [80, 255]`
  - Red Range 2: `H: [170, 180], S: [80, 255], V: [80, 255]`
  - Mode override support: `traffic_light_mode: "auto"`, `"red"`, or `"green"`.
- **Stop Line Crossing Detection:** The stop line is defined by two Cartesian coordinates $[P_1, P_2]$. Each tracked vehicle's trajectory vector $[C_{t-1}, C_t]$ is checked for geometric segment intersection:
  $$\text{Intersect}(\overline{C_{t-1}C_t}, \overline{P_1P_2}) = \text{True} \quad \land \quad \text{Signal State} = \text{RED}$$
- **Violation Logging:** Only triggers on the first transition across the stop line during a red light. Re-entries and stationary vehicles are guarded by unique track ID tracking (`violated_ids`).

---

## 5. Speed Measurement & Calibration Algorithm

- **Dual-Line Timing Methodology:** Two calibrated virtual measurement lines are configured across the traffic flow (`line_a` and `line_b` in `backend/road_config.json`):
  - Line A position: `(x1, y1) -> (x2, y2)`
  - Line B position: `(x3, y3) -> (x4, y4)`
  - Real-world calibrated distance: $D = 10.0\text{ meters}$
- **Speed Formulation:**
  1. Record entry frame $f_A$ when vehicle trajectory intersects Line A.
  2. Record exit frame $f_B$ when vehicle trajectory intersects Line B.
  3. Elapsed frames $\Delta f = |f_B - f_A|$.
  4. Elapsed video time $\Delta t = \frac{\Delta f}{\text{FPS}}$ (seconds).
  5. Estimated velocity $V = \left(\frac{D}{\Delta t}\right) \times 3.6\text{ km/h}$.
- **Speed Limit Evaluation:**
  $$\text{If } V > V_{\text{limit}} \ (60.0\text{ km/h}) \implies \text{SPEEDING Violation}$$
  - Excess speed: $\Delta V = V - V_{\text{limit}}$.
- **Prototype Statement:** This computer vision timing mechanism is an automated screening prototype and is not presented as radar-certified or police-grade hardware.

---

## 6. No-Helmet Detection Algorithm

- **Step 1: Vehicle & Rider Co-Detection:** YOLOv8n identifies motorcycles (`cls: 3`) and persons (`cls: 0`) in the scene.
- **Step 2: Spatial Association (`associate_riders_with_motorcycles`):**
  - Horizontal center alignment: Rider center $pc_x \in [mx_1 - 0.35\cdot mw, mx_2 + 0.35\cdot mw]$.
  - Vertical alignment: Rider base $py_2 \ge my_1 - 0.15\cdot mh \land py_1 \le my_2 + 0.15\cdot mh$.
  - Spatial overlap ratio $\ge 0.20$.
- **Step 3: Head/Torso Crop & Inference:** The upper 65% of the associated rider region is cropped and passed to `helmet_yolov8n.pt`.
- **Step 4: Temporal Confirmation:** Transient single-frame occlusions are rejected. A violation requires $\ge 3$ confirmed frames (`confirmation_frames: 3` in `backend/road_config.json`) before committing.
- **Step 5: Event Constraint:** At most one violation document is generated per tracked motorcycle (`helmet_violated_ids`).

---

## 7. License Plate Localization & EasyOCR

- **Plate Localization:** Vehicle crop is examined using multi-stage morphological operations:
  - Grayscale conversion $\rightarrow$ Bilateral filtering $\rightarrow$ Adaptive Canny edge detection $\rightarrow$ Rectangular aspect ratio filtering ($1.5 \le \text{AR} \le 5.5$).
- **Plate Recognition:** `EasyOCR` (`en` model) processes both the candidate plate crop and high-contrast vehicle crop.
- **Alphanumeric Cleaning:** Non-alphanumeric noise is stripped.
- **Realistic Fallback:** When license plates are unreadable, angled, or absent, the system records `"Not Detected"` and `ocr_confidence: null`. No synthetic or fake plates are ever generated.

---

## 8. MongoDB Persistence & Schema

All records are persisted in MongoDB `traffic_violation_db` using indexed collections:

### 8.1 `videos` Collection
```json
{
  "video_id": "UUID string (Primary Key, unique index)",
  "original_filename": "traffic_clip.mp4",
  "stored_filename": "<uuid>.mp4",
  "input_path": "backend/uploads/<uuid>.mp4",
  "output_path": "backend/outputs/processed_<uuid>.mp4",
  "analysis_type": "RED_SIGNAL | SPEED | NO_HELMET",
  "status": "UPLOADED | PROCESSING | COMPLETED | FAILED",
  "progress": 100,
  "total_frames": 100,
  "violations_count": 1,
  "created_at": "2026-10-05T09:45:00Z",
  "completed_at": "2026-10-05T09:45:16Z",
  "error": null
}
```

### 8.2 `violations` Collection
```json
{
  "violation_id": "UUID string (Primary Key, unique index)",
  "video_id": "UUID reference",
  "track_id": 12,
  "violation_type": "RED_LIGHT_JUMP | SPEEDING | NO_HELMET",
  "vehicle_class": "motorcycle",
  "detection_confidence": 0.82,
  "frame_number": 64,
  "video_timestamp_seconds": 2.13,
  "detected_at": "2026-10-05T09:45:10Z",
  "plate_number": "Not Detected",
  "ocr_confidence": null,
  "traffic_light_state": "red",
  "detected_speed_kmh": null,
  "speed_limit_kmh": null,
  "speed_excess_kmh": null,
  "helmet_status": "NO_HELMET",
  "helmet_confidence": 0.71,
  "confirmation_frames": 3,
  "reason": "Rider detected without helmet across 3 confirmed frames (confidence: 0.71).",
  "bounding_box": [512, 340, 720, 580],
  "evidence_image": "/evidence/<video_id>/evidence_<violation_id>.jpg",
  "vehicle_crop": "/evidence/<video_id>/vehicle_<violation_id>.jpg",
  "plate_crop": null,
  "status": "PENDING",
  "reviewed_at": null
}
```

---

## 9. Evidence Management & Storage

When a violation triggers, high-resolution evidence is captured and written to `backend/evidence/<video_id>/`:
1. **Full Evidence Frame (`evidence_<id>.jpg`):** Annotated full-frame capture displaying tracking bounding boxes, rider boxes, and violation text banners.
2. **Vehicle Crop (`vehicle_<id>.jpg`):** High-resolution cropped image of the violating vehicle (or motorcycle + rider).
3. **Plate Candidate Crop (`plate_<id>.jpg`):** Localized bounding region of the vehicle registration plate when found.

All evidence images are served directly by FastAPI via `/evidence/{video_id}/{filename}` and rendered in responsive cards and modal viewers.

---

## 10. Human Verification Workflow

- **Default Review State:** All new violations default to `status: "PENDING"`.
- **Review Actions:**
  - `PATCH /api/violations/{violation_id}/approve` $\rightarrow$ transitions status to `APPROVED` and records `reviewed_at`.
  - `PATCH /api/violations/{violation_id}/reject` $\rightarrow$ transitions status to `REJECTED` and records `reviewed_at`.
- **Immediate Frontend Sync:** Verification actions update MongoDB, change card badges from amber to green/red, lock action buttons, and automatically recalculate system dashboard metrics.

---

## 11. Frontend Structure & Architecture

The frontend is implemented with modular HTML5, Tailwind CSS, and vanilla ES modules:

- **`index.html`:** Responsive layout with fixed glassmorphic sidebar, top mobile header, and five primary tab sections:
  1. `#dashboard-tab` — Executive landing overview with 3 prominent module cards & live counters.
  2. `#detection-tab` — Reusable upload & analysis workspace displaying module-specific rules, video preview, progress bar, video player, and violation evidence cards.
  3. `#violations-tab` — Comprehensive searchable and filterable database of all recorded violations.
  4. `#history-tab` — Interactive video processing log table with direct playback triggers.
  5. `#statistics-tab` — Visual analytics with CSS distribution meters and metric breakdown.
  - `#violation-detail-modal` — Modal inspection drawer displaying 3 image crops, vehicle metadata, and human verification controls.
- **`main.js`:** Single application controller managing tab transitions, unified video uploads, progress polling, evidence card rendering, filter management, and modal interactions.
- **`data.js`:** Clean asynchronous client calling FastAPI REST endpoints.
- **`style.css`:** Custom styling, custom scrollbars, glassmorphism filters, and color palettes.

---

## 12. Complete API Endpoint Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Health check verifying API status and MongoDB connection |
| `GET` | `/api/config` | Returns active road config, speed limit, and helmet thresholds |
| `POST` | `/api/upload` | Uploads traffic video (`analysis_type: RED_SIGNAL \| SPEED \| NO_HELMET`) |
| `POST` | `/api/process/{video_id}` | Triggers asynchronous background computer vision processing |
| `GET` | `/api/status/{video_id}` | Returns real-time processing percentage, status, and violation count |
| `GET` | `/api/result/{video_id}` | Returns processed H.264 video URL and completion statistics |
| `GET` | `/api/violations` | Retrieves violation documents (filters: `video_id`, `status`, `violation_type`) |
| `GET` | `/api/violations/{violation_id}` | Retrieves single detailed violation record |
| `PATCH`| `/api/violations/{violation_id}/approve` | Marks violation as `APPROVED` with ISO timestamp |
| `PATCH`| `/api/violations/{violation_id}/reject` | Marks violation as `REJECTED` with ISO timestamp |
| `GET` | `/api/history` | Retrieves list of all processed video documents from MongoDB |
| `GET` | `/api/statistics` | Returns aggregated metrics across the database |

---

## 13. End-to-End Processing Workflow

```
1. User Selects Module (Red Signal / Speed / Helmet)
   │
2. User Selects / Drops Traffic Video (MP4 / AVI / MOV / MKV)
   │
3. POST /api/upload
   ├── Validates file extension
   ├── Assigns UUID
   └── Creates MongoDB video record (status: UPLOADED)
   │
4. POST /api/process/{video_id}
   ├── Launches background task
   └── Sets status: PROCESSING
   │
5. Frontend Polls GET /api/status/{video_id}
   └── Displays dynamic progress percentage (0% -> 100%)
   │
6. Headless Vision Engine (backend/video_processor.py)
   ├── Decodes frames via OpenCV
   ├── Executes YOLOv8n object detection & ByteTrack tracking
   ├── Evaluates Module-Specific Violations:
   │   ├── RED_SIGNAL: Stop line crossing + Red signal state
   │   ├── SPEED: Dual-line timing (Line A -> Line B) + Speed limit check
   │   └── NO_HELMET: Rider association + Head crop helmet inference + 3-frame confirmation
   ├── Captures Evidence on disk (Evidence Frame, Vehicle Crop, Plate Crop)
   ├── Executes EasyOCR for vehicle registration
   ├── Writes Violation Documents to MongoDB (status: PENDING)
   └── Encodes H.264 MP4 video output with HUD annotations
   │
7. Completion & Display
   ├── Sets MongoDB video record status: COMPLETED
   ├── Frontend fetches GET /api/result/{video_id}
   ├── Loads video into HTML5 player
   ├── Renders violation evidence cards
   └── Updates system statistics
   │
8. Human Verification
   └── Operator clicks [ APPROVE ] or [ REJECT ] -> DB updated in real-time
```

---

## 14. Testing & Verification Summary

The complete test suite was executed via `full_app_regression_test.py`:

- **Health & Configuration Check:** Passed (API healthy, DB ping responsive, road config served).
- **Frontend Server Check:** Passed (`index.html`, `main.js`, `data.js`, `style.css` served on port 5500 with HTTP 200).
- **Red Signal Pipeline Test:** Uploaded `red_final_test.mp4` $\rightarrow$ processed to 100% `COMPLETED` $\rightarrow$ verified output.
- **Speed Pipeline Test:** Uploaded `speed_final_test.mp4` $\rightarrow$ processed to 100% `COMPLETED` $\rightarrow$ verified output.
- **No-Helmet Pipeline Test:** Uploaded `helmet_final_test.mp4` $\rightarrow$ processed to 100% `COMPLETED` $\rightarrow$ identified genuine rider without helmet $\rightarrow$ verified crop and evidence generation.
- **Verification Actions Test:** Executed `approve` and `reject` transitions on test records $\rightarrow$ verified real database persistence.
- **Filtering Test:** Verified `violation_type` and `status` query parameters on `GET /api/violations`.

---

## 15. Real Results & Operational Metrics

From the live MongoDB `traffic_violation_db`:

- **Total Videos Processed:** `9`
- **Total Violations Recorded:** `10`
  - Red Light Jumping Violations: `4`
  - Speeding Violations: `4`
  - No Helmet Violations: `2`
- **Verification Status:**
  - Pending Review: `4`
  - Approved: `2`
  - Rejected: `4`

---

## 16. Known System Limitations

1. **Occlusion & Congestion:** Heavy bumper-to-bumper traffic can temporarily obstruct stop lines or vehicle license plates, lowering OCR localization accuracy.
2. **Camera Perspective:** Speed timing and stop-line intersection rely on pre-calibrated camera positions. Moving or panning the camera requires updating line coordinates in `road_config.json`.
3. **Nighttime Conditions:** Poor ambient illumination reduces rider and helmet detection confidence unless street lighting is adequate.
4. **License Plate Variation:** The localization algorithm is optimized for standard rectangular plates; highly customized or dirty plates may fail recognition and default to `"Not Detected"`.

---

## 17. Helmet Model Provenance & Verification

In accordance with strict verification guidelines:

- **Source / Repository:** Hugging Face Model Hub repository `iam-tsr/yolov8n-helmet-detection` (`best.pt`).
- **Base Architecture:** Ultralytics YOLOv8n (`detect` task, 6.2 MB).
- **Class Labels:**
  - Index `0`: `With Helmet`
  - Index `1`: `Without Helmet`
- **Training Dataset Configuration:** Checkpoint metadata confirms fine-tuning against Roboflow dataset `Helmet-Detection_YOLOv8-3/data.yaml` over 25 epochs.
- **License Information:** The Hugging Face repository does not declare a formal proprietary license; it is hosted as a public open-source checkpoint derived from public Roboflow annotations.

---

## 18. Exact Commands to Run Application

### Prerequisites
- Python 3.10+ (tested on Python 3.12 64-bit on Windows)
- Local MongoDB running on `mongodb://localhost:27017`

### Step 1: Install Dependencies
```bash
pip install -r backend/requirements.txt
```

### Step 2: Start FastAPI Backend (Port 8000)
```bash
py -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000
```

### Step 3: Start Frontend HTTP Server (Port 5500)
```bash
py -m http.server 5500 --directory frontend
```

### Step 4: Open Dashboard in Browser
Navigate to:
```
http://127.0.0.1:5500/index.html
```
