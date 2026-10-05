# Phase 3 Implementation Report: Helmet Violation Detection Pipeline

**Project:** AI-Based Smart Traffic Violation Detection and Management System  
**Phase:** Phase 3 (No-Helmet / Helmet Violation Detection)  
**Status:** Completed & Verified  
**Date:** October 5, 2026  

---

## 1. Executive Summary

Phase 3 successfully implemented a genuine, end-to-end **No-Helmet Detection Pipeline** integrated directly into the existing FastAPI backend and browser-based frontend. This completes the three planned violation detection modules for our B.Tech project:

1. **RED_SIGNAL (Red Light Jumping)** — Phase 0 / Phase 1 baseline
2. **SPEED (Speeding Violation)** — Phase 2 module
3. **NO_HELMET (Rider Helmet Violation)** — Phase 3 module (Current)

The implementation strictly followed all project boundaries:
- **Zero Fake Data:** No random classifications, hardcoded predictions, or mock helmet states were used.
- **Genuine AI Models:** Utilized a real pretrained helmet detection model (`iam-tsr/yolov8n-helmet-detection`) alongside YOLOv8n vehicle tracking.
- **Strict Architecture Preservation:** All code remains in `backend/` and `frontend/` without introducing nested directory trees, React, or live streaming protocols.
- **Zero Regression:** Phase 0 (`RED_SIGNAL`) and Phase 2 (`SPEED`) pipelines and human review endpoints remain 100% operational.

---

## 2. Helmet Detection Architecture & Model Specifications

### 2.1 Model Details
Standard YOLOv8n (trained on MS-COCO) provides classes for `person`, `motorcycle`, and general vehicles, but lacks dedicated helmet classes. To perform authentic helmet verification without synthetic stubs, we integrated a specialized pretrained YOLOv8 helmet detection model:

- **Model Identifier:** `iam-tsr/yolov8n-helmet-detection` (Hugging Face / Ultralytics YOLOv8n)
- **Local Weight Path:** `backend/helmet_yolov8n.pt` (6.2 MB)
- **Detected Classes:**
  - Class `0`: `With Helmet`
  - Class `1`: `Without Helmet`
- **Inference Mode:** Targeted head/torso crop inference (extracted from upper 65% of detected rider bounding box) to prevent scale degradation on high-resolution CCTV footage.

### 2.2 Rider-to-Motorcycle Spatial Association Algorithm
Riders and motorcycles are detected simultaneously by YOLOv8n. To attribute rider helmet state to the correct motorcycle track ID, a spatial geometry association algorithm is implemented in `associate_riders_with_motorcycles`:

1. **Horizontal Alignment Check:** The rider's horizontal center point $pc_x$ must lie within the expanded motorcycle horizontal span:
   $$mx_1 - 0.35 \cdot mw \le pc_x \le mx_2 + 0.35 \cdot mw$$
2. **Vertical Alignment Check:** The rider's lower boundary must sit on or above the motorcycle chassis, and upper boundary must sit above or near the motorcycle top:
   $$py_2 \ge my_1 - 0.15 \cdot mh \quad \land \quad py_1 \le my_2 + 0.15 \cdot mh$$
3. **Geometric Overlap Ratio:** Computes intersection area between candidate rider and motorcycle bounding box divided by rider area. Requires $\ge 0.20$ overlap.
4. **Ranked Association:** Pairs the motorcycle track ID with the best-matching rider bounding boxes.

### 2.3 Temporal Confirmation Filter
To prevent false alarms caused by transient single-frame occlusions, motion blur, or head turning, violations are guarded by temporal hysteresis:
- Configured in `road_config.json`: `"confirmation_frames": 3`
- A motorcycle track ID must have $\ge 3$ frames with `NO_HELMET` classification before a violation record is committed.
- Each motorcycle track generates at most **one** violation record (`helmet_violated_ids`).

---

## 3. End-to-End Pipeline Workflow

```
Traffic Video (MP4 / AVI / MOV / MKV)
               │
               ▼
   YOLOv8n Vehicle & Person Detection
               │
               ▼
       ByteTrack Tracking
    (Motorcycle Track ID assigned)
               │
               ▼
  Spatial Association of Rider to Motorcycle
               │
               ▼
    Rider Upper Region Crop (Head & Helmet)
               │
               ▼
  helmet_yolov8n.pt Inference
    ├── "With Helmet"   --> HELMET OK
    └── "Without Helmet"--> NO HELMET
               │
               ▼
  Temporal Confirmation (>= 3 Frames)
               │
               ▼
      Evidence Capture:
  ├── Full Annotated Frame with Head & Rider Bounding Boxes
  ├── Motorcycle & Rider Combined Crop
  └── License Plate Localization & EasyOCR Attempt
               │
               ▼
   MongoDB `violations` Collection:
  ├── violation_id (UUID)
  ├── video_id & track_id
  ├── violation_type: "NO_HELMET"
  ├── helmet_status: "NO_HELMET"
  ├── helmet_confidence (e.g., 0.71)
  ├── confirmation_frames (3)
  ├── plate_number & OCR confidence
  └── status: "PENDING"
               │
               ▼
    Frontend Results Tab & Verification:
  ├── Module Selector (Red Light / Speed / Helmet)
  ├── 3-Image Evidence Card (Evidence, Crop, Plate)
  └── Human Verification: [ APPROVE ] / [ REJECT ]
```

---

## 4. Verification & Testing Results

### 4.1 NO_HELMET Pipeline End-to-End Test
- **Input Footage:** `backend/uploads/sample_helmet_traffic.mp4` (extracted 100 frames from real traffic footage `video6.mp4` containing multiple motorcycles and riders).
- **API Endpoint:** `POST /api/upload` with `analysis_type="NO_HELMET"`
- **Processing Time:** 16 seconds (including ByteTrack tracking, helmet inference, crop generation, and OCR)
- **Output Video:** `backend/outputs/processed_f95a29ef-d28c-4201-98e0-4677fa55cc3b.mp4` (H.264 browser playable)
- **Result Document:**
  ```json
  {
    "video_id": "f95a29ef-d28c-4201-98e0-4677fa55cc3b",
    "video_url": "/outputs/processed_f95a29ef-d28c-4201-98e0-4677fa55cc3b.mp4",
    "violations": 1,
    "total_frames": 100
  }
  ```
- **Recorded Violation Document (MongoDB):**
  - `violation_id`: `9a57a9e8-0219-480e-b243-41a62e94a4aa`
  - `violation_type`: `"NO_HELMET"`
  - `vehicle_class`: `"motorcycle"`
  - `track_id`: `12`
  - `helmet_status`: `"NO_HELMET"`
  - `helmet_confidence`: `0.71`
  - `confirmation_frames`: `3`
  - `frame_number`: `64`
  - `plate_number`: `"Not Detected"`
  - `evidence_image`: `/evidence/f95a29ef.../evidence_9a57a9e8...jpg` (346 KB on disk)
  - `vehicle_crop`: `/evidence/f95a29ef.../vehicle_9a57a9e8...jpg` (85 KB on disk)
  - `status`: `"PENDING"`

### 4.2 Human Verification Endpoints Test
- `PATCH /api/violations/9a57a9e8-0219-480e-b243-41a62e94a4aa/approve`
  - Response: Status updated to `"APPROVED"` with ISO timestamp `2026-10-05T09:34:26.853000Z`
- `PATCH /api/violations/9a57a9e8-0219-480e-b243-41a62e94a4aa/reject`
  - Response: Status updated to `"REJECTED"` with ISO timestamp `2026-10-05T09:34:26.859000Z`

### 4.3 Database Statistics Verification
`GET /api/statistics` returned real aggregated metrics across MongoDB:
```json
{
  "total_videos": 6,
  "total_violations": 9,
  "red_light_violations": 4,
  "speeding_violations": 4,
  "no_helmet_violations": 1,
  "pending": 4,
  "approved": 2,
  "rejected": 3
}
```

### 4.4 Regression Test Results
- **RED_SIGNAL Module Test:**
  - Uploaded `red_reg_test.mp4` with `analysis_type="RED_SIGNAL"`
  - Processing completed to 100% with `status="COMPLETED"`, 0 errors.
- **SPEED Module Test:**
  - Uploaded `speed_reg_test.mp4` with `analysis_type="SPEED"`
  - Processing completed to 100% with `status="COMPLETED"`, 0 errors.

---

## 5. Frontend Integration Summary

1. **Sidebar Navigation:**
   - Active Module Indicators for all 3 modules (`Red Light`, `Speed`, `Helmet`).
2. **Upload Tab Mode Selector:**
   - Interactive 3-card selector (`RED_SIGNAL`, `SPEED`, `NO_HELMET`).
   - Dynamically updates active border, glow, and status labels.
3. **Violation Cards:**
   - Dedicated `NO_HELMET` card style with orange warning borders and helmet icon (`🪖`).
   - Displays real confidence score (`71%`), confirmed frames count, and plate status.
   - Live interactive `[ APPROVE ]` and `[ REJECT ]` buttons connected to FastAPI PATCH endpoints.
4. **History Table:**
   - Real badges for all three analysis types (`🚦 RED LIGHT`, `⚡ SPEED`, `🪖 HELMET`).
   - Displays live persistent video status and results from MongoDB.

---

## 6. System Architecture Map (Finalized)

```
Smart-Traffic-Violation-Detection/
├── backend/
│   ├── config.py             # Global constants, paths, thresholds
│   ├── database.py           # MongoDB connection & CRUD operations
│   ├── detector.py           # Traffic light HSV detector
│   ├── helmet_yolov8n.pt     # Real pretrained helmet detection model weights
│   ├── main.py               # FastAPI application & REST endpoints
│   ├── ocr_service.py        # EasyOCR plate reader & preprocessing
│   ├── requirements.txt      # Python dependencies
│   ├── road_config.json      # Stop line, speed line, and helmet configuration
│   ├── utils.py              # Visual helpers, text drawing, line intersection
│   ├── video_processor.py    # Multi-module video processing engine
│   ├── yolov8n.pt            # Pretrained YOLOv8n vehicle & person weights
│   ├── uploads/              # Uploaded source videos
│   ├── outputs/              # Processed annotated videos
│   └── evidence/             # Per-video violation evidence and crops
├── frontend/
│   ├── data.js               # API client for MongoDB endpoints
│   ├── detection.js          # Canvas overlay helpers
│   ├── index.html            # Single page UI with 3 violation modules
│   ├── main.js               # Frontend application controller
│   ├── screenshot.js         # Video snapshot utility
│   └── style.css             # Styling rules
├── PHASE0_REPORT.md          # Baseline Phase 0 report
├── PHASE1_REPORT.md          # Red light jumping & MongoDB report
├── PHASE2_REPORT.md          # Speed violation report
├── PHASE3_REPORT.md          # Helmet violation report (This document)
└── .gitignore
```

---

## 7. Known Limitations & Recommendations

1. **Severe Occlusion:** When two motorcycles travel side-by-side with overlapping bounding boxes, rider-to-vehicle association can occasionally group riders to the nearest motorcycle center.
2. **Camera Angles:** The model performs best on front, angled-front, or rear-quarter angles. Overhead cameras (perpendicular to road surface) provide insufficient head profile visibility for reliable helmet classification.
3. **Low Lighting / Night Traffic:** In darkness, rider detection confidence drops below the 0.35 threshold unless scene illumination is adequate.
