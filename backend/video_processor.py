import os
import time
import math
import uuid
import json
import cv2
import numpy as np
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from ultralytics import YOLO

from config import (
    CONF_VEHICLE,
    IOU_VEHICLE,
    TRAFFIC_LIGHT_REFRESH,
    VEHICLE_MODEL_WEIGHTS,
    DEFAULT_HELMET_WEIGHTS,
    HELMET_MODEL_WEIGHTS,
    CONF_HELMET,
    HELMET_CONFIRMATION_FRAMES,
    TRACKER_CFG,
    VEH_OK,
    COLOR_BAD,
    COLOR_OK,
    COLOR_ROI,
    FONT,
    ROAD_CONFIG_PATH,
    EVIDENCE_DIR
)
from utils import put_text, segments_intersect, draw_stats_panel
from detector import TrafficLightDetector, crop_roi
from ocr_service import localize_license_plate, run_ocr
from database import create_violation_record


def get_video_writer(output_path: str, fps: float, width: int, height: int):
    """
    Attempts to initialize a VideoWriter that produces a browser-compatible MP4 file.
    Prefers Windows Media Foundation H264 on Windows, with fallbacks to avc1 and mp4v.
    """
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    if backend_dir not in os.environ.get("PATH", ""):
        os.environ["PATH"] = backend_dir + os.pathsep + os.environ.get("PATH", "")
    
    # Try Windows Media Foundation H264 first (Chrome / Edge / Firefox compatible)
    if os.name == 'nt':
        try:
            vw = cv2.VideoWriter(output_path, cv2.CAP_MSMF, cv2.VideoWriter_fourcc(*'H264'), fps, (width, height))
            if vw.isOpened():
                return vw
        except Exception:
            pass

    # Try standard codecs
    for codec in ['avc1', 'H264', 'mp4v']:
        try:
            vw = cv2.VideoWriter(output_path, cv2.VideoWriter_fourcc(*codec), fps, (width, height))
            if vw.isOpened():
                return vw
        except Exception:
            pass

    raise RuntimeError(f"Failed to initialize VideoWriter for '{output_path}' with available codecs.")


_MODEL_CACHE = {}


def get_vehicle_model():
    """Returns singleton cached instance of the YOLO vehicle detection model."""
    if "vehicle" not in _MODEL_CACHE:
        _MODEL_CACHE["vehicle"] = YOLO(VEHICLE_MODEL_WEIGHTS)
    return _MODEL_CACHE["vehicle"]


def get_helmet_model():
    """Returns singleton cached instance of the YOLO helmet classification model."""
    if "helmet" not in _MODEL_CACHE:
        if os.path.exists(HELMET_MODEL_WEIGHTS):
            _MODEL_CACHE["helmet"] = YOLO(HELMET_MODEL_WEIGHTS)
        elif os.path.exists(DEFAULT_HELMET_WEIGHTS):
            _MODEL_CACHE["helmet"] = YOLO(DEFAULT_HELMET_WEIGHTS)
        else:
            _MODEL_CACHE["helmet"] = None
    return _MODEL_CACHE["helmet"]


def load_road_config(config_dict=None):
    """Loads road configuration from dict or backend/road_config.json."""
    if config_dict is not None and isinstance(config_dict, dict) and config_dict:
        cfg = dict(config_dict)
    elif os.path.exists(ROAD_CONFIG_PATH):
        try:
            with open(ROAD_CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg = json.load(f)
        except Exception as e:
            print(f"Warning: Could not read road config from {ROAD_CONFIG_PATH}: {e}")
            cfg = {}
    else:
        cfg = {}

    stop_line = cfg.get("stop_line", [[500, 500], [500, 900]])
    traffic_light_roi = cfg.get("traffic_light_roi", [[50, 50], [150, 200]])
    traffic_light_mode = cfg.get("traffic_light_mode", "red")

    cfg["stop_line"] = stop_line
    cfg["traffic_light_roi"] = traffic_light_roi
    cfg["traffic_light_mode"] = traffic_light_mode
    cfg["red_signal"] = {
        "stop_line": stop_line,
        "traffic_light_roi": traffic_light_roi,
        "traffic_light_mode": traffic_light_mode
    }
    return cfg


def associate_riders_with_motorcycles(motorcycles, persons):
    """
    Associates detected persons with detected motorcycles based on spatial geometry.
    Ensures each person is assigned only to the single highest-affinity motorcycle
    to prevent cross-contamination when multiple motorcycles appear in the same frame.
    motorcycles: list of (box, tid, conf)
    persons: list of (box, conf)
    Returns: dict mapping mtid -> list of person boxes
    """
    associations = {mtid: [] for _, mtid, _ in motorcycles}
    if not motorcycles or not persons:
        return associations

    pair_scores = []
    for p_idx, (pbox, pconf) in enumerate(persons):
        px1, py1, px2, py2 = pbox
        pcx = (px1 + px2) / 2.0
        p_area = max(1.0, float((px2 - px1) * (py2 - py1)))
        for mbox, mtid, mconf in motorcycles:
            mx1, my1, mx2, my2 = mbox
            mw = mx2 - mx1
            mh = my2 - my1
            # Rider horizontal alignment: center inside or near motorcycle horizontal span
            if (mx1 - 0.35 * mw) <= pcx <= (mx2 + 0.35 * mw):
                # Rider vertical position: bottom is near or inside motorcycle, top is above or near motorcycle top
                if py2 >= (my1 - 0.15 * mh) and py1 <= (my2 + 0.15 * mh):
                    inter_x1 = max(px1, mx1 - 0.20 * mw)
                    inter_x2 = min(px2, mx2 + 0.20 * mw)
                    inter_y1 = max(py1, my1 - 0.85 * mh)
                    inter_y2 = min(py2, my2)
                    inter_area = max(0, inter_x2 - inter_x1) * max(0, inter_y2 - inter_y1)
                    score = inter_area / p_area
                    if score >= 0.20:
                        pair_scores.append((score, mtid, p_idx))

    # Sort candidates by spatial score descending
    pair_scores.sort(key=lambda x: x[0], reverse=True)
    assigned_persons = set()

    for score, mtid, p_idx in pair_scores:
        if p_idx not in assigned_persons:
            if len(associations[mtid]) < 2:
                associations[mtid].append(persons[p_idx][0])
                assigned_persons.add(p_idx)

    return associations


def classify_rider_helmet(frame, rider_box, helmet_model, conf_thresh=0.35):
    """
    Extracts rider upper head region, executes helmet_model, and returns
    (status, confidence, head_box) where status is HELMET, NO_HELMET, or UNKNOWN.
    """
    if helmet_model is None or rider_box is None:
        return "UNKNOWN", 0.0, None

    h_f, w_f = frame.shape[:2]
    px1, py1, px2, py2 = rider_box
    pw = px2 - px1
    ph = py2 - py1

    if pw < 16 or ph < 20:
        return "UNKNOWN", 0.0, None

    # Conservative head/torso crop: top 65% of rider with slight horizontal margin
    rx1 = max(0, int(px1 - 0.10 * pw))
    ry1 = max(0, int(py1 - 0.05 * ph))
    rx2 = min(w_f, int(px2 + 0.10 * pw))
    ry2 = min(h_f, int(py1 + 0.65 * ph))

    crop = frame[ry1:ry2, rx1:rx2]
    if crop.shape[0] < 15 or crop.shape[1] < 15:
        return "UNKNOWN", 0.0, None

    try:
        res = helmet_model(crop, conf=0.18, verbose=False)[0]
    except Exception:
        return "UNKNOWN", 0.0, None

    if len(res.boxes) == 0:
        return "UNKNOWN", 0.0, None

    best_no_helmet_conf = 0.0
    best_helmet_conf = 0.0
    best_hb = None

    for hb, hc, hconf in zip(res.boxes.xyxy.cpu().numpy(), res.boxes.cls.cpu().numpy(), res.boxes.conf.cpu().numpy()):
        cname = str(res.names.get(int(hc), "")).lower()
        abs_hb = [int(hb[0] + rx1), int(hb[1] + ry1), int(hb[2] + rx1), int(hb[3] + ry1)]

        if "without" in cname or "no" in cname:
            if hconf > best_no_helmet_conf:
                best_no_helmet_conf = float(hconf)
                best_hb = abs_hb
        elif "with" in cname or "helmet" in cname:
            if hconf > best_helmet_conf:
                best_helmet_conf = float(hconf)
                best_hb = abs_hb

    if best_no_helmet_conf >= conf_thresh and best_no_helmet_conf >= best_helmet_conf:
        return "NO_HELMET", round(best_no_helmet_conf, 2), best_hb
    elif best_helmet_conf >= conf_thresh:
        return "HELMET", round(best_helmet_conf, 2), best_hb
    else:
        return "UNKNOWN", 0.0, None


def process_video(
    input_path: str,
    output_path: str,
    road_config: dict = None,
    progress_callback = None,
    video_id: Optional[str] = None,
    analysis_type: str = "RED_SIGNAL"
) -> dict:
    """
    Headless video processing pipeline for vehicle detection, ByteTrack tracking,
    violation detection (RED_SIGNAL and/or SPEED), evidence capture, license plate OCR,
    and MongoDB record persistence.
    """
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input video not found: {input_path}")

    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {input_path}")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()

    if width <= 0 or height <= 0:
        raise ValueError("Invalid video dimensions detected.")

    analysis_mode = str(analysis_type or "RED_SIGNAL").upper().strip()
    if analysis_mode not in ("RED_SIGNAL", "SPEED", "NO_HELMET", "ALL"):
        analysis_mode = "RED_SIGNAL"

    cfg = load_road_config(road_config)

    # --- Stop Line & Traffic Light Configuration (for RED_SIGNAL) ---
    raw_line = cfg.get("stop_line", [])
    if len(raw_line) == 2:
        line_pts = [
            (max(0, min(width - 1, int(raw_line[0][0]))), max(0, min(height - 1, int(raw_line[0][1])))),
            (max(0, min(width - 1, int(raw_line[1][0]))), max(0, min(height - 1, int(raw_line[1][1]))))
        ]
    else:
        line_pts = [(int(width * 0.1), int(height * 0.65)), (int(width * 0.9), int(height * 0.65))]

    raw_roi = cfg.get("traffic_light_roi", [])
    if raw_roi and isinstance(raw_roi, (list, tuple)):
        if len(raw_roi) == 4 and all(isinstance(x, (int, float)) for x in raw_roi):
            roi_pts_list = [[(int(raw_roi[0]), int(raw_roi[1])), (int(raw_roi[2]), int(raw_roi[3]))]]
        elif len(raw_roi) == 2 and isinstance(raw_roi[0], (list, tuple)) and len(raw_roi[0]) == 2:
            roi_pts_list = [raw_roi]
        elif len(raw_roi) > 0 and isinstance(raw_roi[0], (list, tuple)):
            roi_pts_list = raw_roi
        else:
            roi_pts_list = []
    else:
        roi_pts_list = []

    tl_mode = str(cfg.get("traffic_light_mode", "auto")).lower()

    # --- Speed Configuration (for SPEED) ---
    speed_cfg = cfg.get("speed", {})
    raw_line_a = speed_cfg.get("line_a", [])
    raw_line_b = speed_cfg.get("line_b", [])
    distance_meters = float(speed_cfg.get("distance_meters", 10.0))
    speed_limit_kmh = float(speed_cfg.get("speed_limit_kmh", 60.0))

    if len(raw_line_a) == 2:
        speed_line_a = [
            (max(0, min(width - 1, int(raw_line_a[0][0]))), max(0, min(height - 1, int(raw_line_a[0][1])))),
            (max(0, min(width - 1, int(raw_line_a[1][0]))), max(0, min(height - 1, int(raw_line_a[1][1]))))
        ]
    else:
        speed_line_a = [(int(width * 0.28), int(height * 0.45)), (int(width * 0.28), int(height * 0.90))]

    if len(raw_line_b) == 2:
        speed_line_b = [
            (max(0, min(width - 1, int(raw_line_b[0][0]))), max(0, min(height - 1, int(raw_line_b[0][1])))),
            (max(0, min(width - 1, int(raw_line_b[1][0]))), max(0, min(height - 1, int(raw_line_b[1][1]))))
        ]
    else:
        speed_line_b = [(int(width * 0.40), int(height * 0.45)), (int(width * 0.40), int(height * 0.90))]

    # --- Helmet Configuration (for NO_HELMET) ---
    helmet_cfg = cfg.get("helmet", {})
    helmet_conf_thresh = float(helmet_cfg.get("helmet_confidence_threshold", CONF_HELMET))
    confirm_frames = int(helmet_cfg.get("confirmation_frames", HELMET_CONFIRMATION_FRAMES))

    helmet_model = get_helmet_model() if analysis_mode in ("NO_HELMET", "ALL") else None
    detector = TrafficLightDetector()
    model = get_vehicle_model()

    proc_mode = str(cfg.get("processing_mode", "FAST")).upper().strip()
    interval = int(cfg.get("detection_interval", 2 if proc_mode == "FAST" else 1))
    if interval < 1:
        interval = 1

    out_fps = max(1.0, fps / float(interval))
    out_writer = get_video_writer(output_path, out_fps, width, height)

    stream = model.track(
        source=input_path,
        conf=CONF_VEHICLE,
        iou=IOU_VEHICLE,
        tracker=TRACKER_CFG,
        stream=True,
        persist=True,
        verbose=False,
        vid_stride=interval
    )

    violated_ids = set()
    speed_violated_ids = set()
    helmet_violated_ids = set()
    no_helmet_tracker: Dict[int, Dict[str, Any]] = {}
    prev_centers = {}
    roi_colors = []
    line_a_crossings = {}   # track_id -> frame_idx
    line_b_crossings = {}   # track_id -> frame_idx
    measured_speeds = {}    # track_id -> speed_kmh
    processed_frames = 0
    created_violations: List[Dict[str, Any]] = []

    # Ensure evidence subfolder for this video
    video_evidence_dir = None
    if video_id:
        video_evidence_dir = os.path.join(EVIDENCE_DIR, video_id)
        os.makedirs(video_evidence_dir, exist_ok=True)

    t_loop_start = time.perf_counter()
    last_reported_pct = -1
    last_reported_time = 0.0

    try:
        for s_idx, res in enumerate(stream):
            f_idx = s_idx * interval
            frame = res.orig_img.copy()

            # --- RED SIGNAL VISUALS ---
            is_red = False
            if analysis_mode in ("RED_SIGNAL", "ALL"):
                if tl_mode == "red":
                    is_red = True
                    roi_colors = ["red" for _ in roi_pts_list]
                elif tl_mode == "green":
                    is_red = False
                    roi_colors = ["green" for _ in roi_pts_list]
                else:  # "auto"
                    if (f_idx % TRAFFIC_LIGHT_REFRESH == 0 or not roi_colors) and roi_pts_list:
                        roi_colors = [detector.detect_color(crop_roi(frame, r)) for r in roi_pts_list if len(r) == 2]
                    is_red = any(c == 'red' for c in roi_colors)

                if len(line_pts) == 2:
                    p1, p2 = line_pts[0], line_pts[1]
                    line_color = COLOR_BAD if is_red else COLOR_OK
                    cv2.line(frame, p1, p2, line_color, 3)
                    state_label = "RED - STOP" if is_red else "GREEN - GO"
                    put_text(frame, f"STOP LINE [{state_label}]", (p1[0], max(25, p1[1] - 10)), line_color, 0.6, 2)

                for i, roi in enumerate([r for r in roi_pts_list if len(r) == 2]):
                    r1 = (int(roi[0][0]), int(roi[0][1]))
                    r2 = (int(roi[1][0]), int(roi[1][1]))
                    c_name = roi_colors[i] if i < len(roi_colors) else "UNKNOWN"
                    roi_box_color = (0, 0, 255) if c_name == 'red' else ((0, 255, 0) if c_name == 'green' else COLOR_ROI)
                    cv2.rectangle(frame, r1, r2, roi_box_color, 2)
                    put_text(frame, f"TRAFFIC LIGHT ROI: {c_name.upper()}", (r1[0], max(18, r1[1] - 6)), roi_box_color, 0.5, 2)

            # --- SPEED LINES VISUALS ---
            if analysis_mode in ("SPEED", "ALL"):
                # Line A (Cyan / Light Blue)
                cv2.line(frame, speed_line_a[0], speed_line_a[1], (255, 220, 0), 3)
                put_text(frame, "SPEED LINE A", (speed_line_a[0][0], max(25, speed_line_a[0][1] - 10)), (255, 220, 0), 0.6, 2)

                # Line B (Orange)
                cv2.line(frame, speed_line_b[0], speed_line_b[1], (0, 165, 255), 3)
                put_text(frame, f"SPEED LINE B [Limit: {speed_limit_kmh:.0f} km/h]", (speed_line_b[0][0], max(25, speed_line_b[0][1] - 10)), (0, 165, 255), 0.6, 2)

            # --- VEHICLE TRACKING & VIOLATION LOGIC ---
            # Extract detected persons for rider association in NO_HELMET mode
            persons = []
            if res.boxes is not None and analysis_mode in ("NO_HELMET", "ALL"):
                raw_boxes = res.boxes.xyxy.cpu().numpy()
                raw_clss = res.boxes.cls.cpu().numpy().astype(int)
                raw_confs = res.boxes.conf.cpu().numpy() if res.boxes.conf is not None else [0.8] * len(raw_boxes)
                for rb, rc, rcf in zip(raw_boxes, raw_clss, raw_confs):
                    if res.names.get(rc, str(rc)) == "person":
                        persons.append((list(map(int, rb)), float(rcf)))

            if res.boxes is not None and res.boxes.id is not None:
                boxes = res.boxes.xyxy.cpu().numpy()
                ids = res.boxes.id.cpu().numpy().astype(int)
                clss = res.boxes.cls.cpu().numpy().astype(int)
                confs = res.boxes.conf.cpu().numpy() if res.boxes.conf is not None else [0.8] * len(ids)
                names = res.names

                # Helmet & Rider Association for NO_HELMET mode
                if analysis_mode in ("NO_HELMET", "ALL"):
                    motorcycles_in_frame = []
                    for box, tid, cls_idx, conf_score in zip(boxes, ids, clss, confs):
                        c_name = names.get(cls_idx, str(cls_idx))
                        if c_name == "motorcycle":
                            motorcycles_in_frame.append((list(map(int, box)), int(tid), float(conf_score)))

                    rider_assocs = associate_riders_with_motorcycles(motorcycles_in_frame, persons)

                    for mbox, mtid, mconf in motorcycles_in_frame:
                        if mtid in helmet_violated_ids:
                            continue

                        riders = rider_assocs.get(mtid, [])
                        if mtid not in no_helmet_tracker:
                            no_helmet_tracker[mtid] = {
                                "no_helmet_frames": 0,
                                "helmet_frames": 0,
                                "status": "UNKNOWN",
                                "conf": 0.0,
                                "head_box": None,
                                "rider_box": None
                            }
                        m_tracker = no_helmet_tracker[mtid]

                        frame_has_no_helmet = False
                        frame_has_helmet = False
                        best_nh_conf = 0.0
                        best_nh_head = None
                        best_nh_rider = None

                        for rbox in riders:
                            h_status, h_conf, head_box = classify_rider_helmet(
                                frame, rbox, helmet_model, conf_thresh=helmet_conf_thresh
                            )
                            if h_status == "NO_HELMET":
                                frame_has_no_helmet = True
                                if h_conf > best_nh_conf:
                                    best_nh_conf = h_conf
                                    best_nh_head = head_box
                                    best_nh_rider = rbox
                            elif h_status == "HELMET":
                                frame_has_helmet = True

                        req_confirm = confirm_frames

                        if frame_has_no_helmet:
                            m_tracker["no_helmet_frames"] += 1
                            m_tracker["status"] = "NO_HELMET"
                            m_tracker["conf"] = max(m_tracker["conf"], best_nh_conf)
                            m_tracker["head_box"] = best_nh_head
                            m_tracker["rider_box"] = best_nh_rider
                            print(f"[HELMET DEBUG] Track: {mtid} | Frame: {f_idx} | Prediction: WITHOUT_HELMET | Confidence: {best_nh_conf:.2f} | Confirmation: {m_tracker['no_helmet_frames']}/{confirm_frames}")
                        elif frame_has_helmet:
                            m_tracker["helmet_frames"] += 1
                            if m_tracker["status"] != "NO_HELMET":
                                m_tracker["status"] = "HELMET"
                            print(f"[HELMET DEBUG] Track: {mtid} | Frame: {f_idx} | Prediction: WITH_HELMET | Confidence: {h_conf:.2f} | Confirmation: 0/{confirm_frames}")

                        # Violation trigger: temporal confirmation >= confirm_frames (strictly 3 frames)
                        if m_tracker["no_helmet_frames"] >= confirm_frames and mtid not in helmet_violated_ids:
                            helmet_violated_ids.add(mtid)
                            violated_ids.add(mtid)
                            print(f"[NO_HELMET EVENT] Track: {mtid} | NO_HELMET violation created")

                            if video_id and video_evidence_dir:
                                try:
                                    violation_id = str(uuid.uuid4())
                                    h_f, w_f = frame.shape[:2]

                                    r_b = m_tracker.get("rider_box") or mbox
                                    vx1 = max(0, min(w_f - 1, min(mbox[0], r_b[0])))
                                    vy1 = max(0, min(h_f - 1, min(mbox[1], r_b[1])))
                                    vx2 = max(0, min(w_f, max(mbox[2], r_b[2])))
                                    vy2 = max(0, min(h_f, max(mbox[3], r_b[3])))

                                    vehicle_crop = frame[vy1:vy2, vx1:vx2].copy() if (vx2 > vx1 and vy2 > vy1) else None

                                    evidence_frame = frame.copy()
                                    cv2.rectangle(evidence_frame, (mbox[0], mbox[1]), (mbox[2], mbox[3]), COLOR_BAD, 3)
                                    if m_tracker.get("rider_box"):
                                        rbx = m_tracker["rider_box"]
                                        cv2.rectangle(evidence_frame, (rbx[0], rbx[1]), (rbx[2], rbx[3]), (0, 140, 255), 2)
                                    if m_tracker.get("head_box"):
                                        hbx = m_tracker["head_box"]
                                        cv2.rectangle(evidence_frame, (hbx[0], hbx[1]), (hbx[2], hbx[3]), COLOR_BAD, 2)

                                    put_text(
                                        evidence_frame,
                                        f"NO HELMET VIOLATION #{mtid} ({m_tracker['conf']:.2f})",
                                        (vx1, max(30, vy1 - 10)),
                                        COLOR_BAD,
                                        0.7,
                                        2
                                    )
                                    put_text(
                                        evidence_frame,
                                        f"EVIDENCE | NO HELMET VIOLATION | Track #{mtid} | Conf: {m_tracker['conf']:.2f}",
                                        (20, max(40, h_f - 25)),
                                        (0, 0, 255),
                                        0.75,
                                        2
                                    )

                                    evidence_fname = f"evidence_{violation_id}.jpg"
                                    vehicle_fname = f"vehicle_{violation_id}.jpg"
                                    plate_fname = f"plate_{violation_id}.jpg"

                                    evidence_fpath = os.path.join(video_evidence_dir, evidence_fname)
                                    vehicle_fpath = os.path.join(video_evidence_dir, vehicle_fname)
                                    plate_fpath = os.path.join(video_evidence_dir, plate_fname)

                                    cv2.imwrite(evidence_fpath, evidence_frame)
                                    if vehicle_crop is not None and vehicle_crop.size > 0:
                                        cv2.imwrite(vehicle_fpath, vehicle_crop)

                                    plate_crop, _ = localize_license_plate(vehicle_crop) if vehicle_crop is not None else (None, None)
                                    plate_crop_url = None
                                    if plate_crop is not None and plate_crop.size > 0:
                                        cv2.imwrite(plate_fpath, plate_crop)
                                        plate_crop_url = f"/evidence/{video_id}/{plate_fname}"

                                    plate_number, ocr_conf = run_ocr(vehicle_crop, plate_crop)
                                    video_ts_sec = round(float(f_idx) / float(fps), 2)
                                    det_conf = round(float(mconf), 2)

                                    violation_doc = {
                                        "violation_id": violation_id,
                                        "video_id": video_id,
                                        "track_id": int(mtid),
                                        "violation_type": "NO_HELMET",
                                        "vehicle_class": "motorcycle",
                                        "detection_confidence": det_conf,
                                        "helmet_status": "NO_HELMET",
                                        "helmet_confidence": float(m_tracker["conf"]),
                                        "confirmation_frames": int(m_tracker["no_helmet_frames"]),
                                        "frame_number": int(f_idx),
                                        "video_timestamp_seconds": video_ts_sec,
                                        "detected_at": datetime.now(timezone.utc),
                                        "reason": f"Rider detected without helmet across {m_tracker['no_helmet_frames']} confirmed frames (confidence: {m_tracker['conf']:.2f}).",
                                        "plate_number": str(plate_number),
                                        "ocr_confidence": float(ocr_conf) if ocr_conf is not None else None,
                                        "bounding_box": [int(mbox[0]), int(mbox[1]), int(mbox[2]), int(mbox[3])],
                                        "evidence_image": f"/evidence/{video_id}/{evidence_fname}",
                                        "vehicle_crop": f"/evidence/{video_id}/{vehicle_fname}",
                                        "plate_crop": plate_crop_url,
                                        "status": "PENDING",
                                        "reviewed_at": None
                                    }

                                    create_violation_record(violation_doc)
                                    created_violations.append(violation_doc)
                                except Exception as exc:
                                    print(f"Non-fatal error creating no helmet violation record for track {mtid}: {exc}")

                for i_box, (box, tid, cls_idx, conf_score) in enumerate(zip(boxes, ids, clss, confs)):
                    cls_name = names.get(cls_idx, str(cls_idx))
                    if cls_name not in VEH_OK:
                        continue

                    x1, y1, x2, y2 = map(int, box)
                    curr_center = ((x1 + x2) // 2, (y1 + y2) // 2)

                    if tid in prev_centers:
                        # 1. Red Light Violation Checking
                        if analysis_mode in ("RED_SIGNAL", "ALL") and len(line_pts) == 2:
                            p1, p2 = line_pts[0], line_pts[1]
                            if is_red and segments_intersect(prev_centers[tid], curr_center, p1, p2):
                                if tid not in violated_ids:
                                    violated_ids.add(tid)
                                    signal_str = "RED" if is_red else "GREEN"
                                    print(f"[RED_SIGNAL EVENT] Track: {tid} | Signal: {signal_str} | Previous centroid: {prev_centers[tid]} | Current centroid: {curr_center} | Stop line: [{p1}, {p2}] | Intersection: TRUE | RED_LIGHT_JUMP created")
                                    if video_id and video_evidence_dir:
                                        try:
                                            violation_id = str(uuid.uuid4())
                                            h_f, w_f = frame.shape[:2]
                                            vx1 = max(0, min(w_f - 1, x1))
                                            vy1 = max(0, min(h_f - 1, y1))
                                            vx2 = max(0, min(w_f, x2))
                                            vy2 = max(0, min(h_f, y2))

                                            vehicle_crop = frame[vy1:vy2, vx1:vx2].copy() if (vx2 > vx1 and vy2 > vy1) else None

                                            evidence_frame = frame.copy()
                                            cv2.line(evidence_frame, p1, p2, COLOR_BAD, 4)
                                            cv2.rectangle(evidence_frame, (vx1, vy1), (vx2, vy2), COLOR_BAD, 3)
                                            put_text(evidence_frame, f"VIOLATION: RED LIGHT JUMP | Track #{tid}", (vx1, max(30, vy1 - 10)), COLOR_BAD, 0.7, 2)
                                            put_text(evidence_frame, f"EVIDENCE | SIGNAL: RED | STOP LINE CROSSING | Track #{tid}", (20, max(40, height - 25)), (0, 0, 255), 0.75, 2)

                                            evidence_fname = f"evidence_{violation_id}.jpg"
                                            vehicle_fname = f"vehicle_{violation_id}.jpg"
                                            plate_fname = f"plate_{violation_id}.jpg"

                                            evidence_fpath = os.path.join(video_evidence_dir, evidence_fname)
                                            vehicle_fpath = os.path.join(video_evidence_dir, vehicle_fname)
                                            plate_fpath = os.path.join(video_evidence_dir, plate_fname)

                                            cv2.imwrite(evidence_fpath, evidence_frame)
                                            if vehicle_crop is not None and vehicle_crop.size > 0:
                                                cv2.imwrite(vehicle_fpath, vehicle_crop)

                                            plate_crop, _ = localize_license_plate(vehicle_crop) if vehicle_crop is not None else (None, None)
                                            plate_crop_url = None
                                            if plate_crop is not None and plate_crop.size > 0:
                                                cv2.imwrite(plate_fpath, plate_crop)
                                                plate_crop_url = f"/evidence/{video_id}/{plate_fname}"

                                            plate_number, ocr_conf = run_ocr(vehicle_crop, plate_crop)
                                            video_ts_sec = round(float(f_idx) / float(fps), 2)
                                            det_conf = round(float(conf_score), 2)

                                            violation_doc = {
                                                "violation_id": violation_id,
                                                "video_id": video_id,
                                                "track_id": int(tid),
                                                "violation_type": "RED_LIGHT_JUMP",
                                                "vehicle_class": str(cls_name),
                                                "detection_confidence": det_conf,
                                                "frame_number": int(f_idx),
                                                "video_timestamp_seconds": video_ts_sec,
                                                "detected_at": datetime.now(timezone.utc),
                                                "traffic_light_state": "red",
                                                "reason": "Vehicle crossed the configured stop line while the traffic signal was RED.",
                                                "plate_number": str(plate_number),
                                                "ocr_confidence": float(ocr_conf) if ocr_conf is not None else None,
                                                "bounding_box": [vx1, vy1, vx2, vy2],
                                                "evidence_image": f"/evidence/{video_id}/{evidence_fname}",
                                                "vehicle_crop": f"/evidence/{video_id}/{vehicle_fname}",
                                                "plate_crop": plate_crop_url,
                                                "status": "PENDING",
                                                "reviewed_at": None
                                            }

                                            create_violation_record(violation_doc)
                                            created_violations.append(violation_doc)
                                        except Exception as exc:
                                            print(f"Non-fatal error creating red light violation record for track {tid}: {exc}")

                        # 2. Speed Violation Checking
                        if analysis_mode in ("SPEED", "ALL"):
                            # Check crossing Line A (record first crossing frame)
                            if tid not in line_a_crossings and len(speed_line_a) == 2:
                                if segments_intersect(prev_centers[tid], curr_center, speed_line_a[0], speed_line_a[1]):
                                    line_a_crossings[tid] = f_idx
                                    print(f"[SPEED CROSSING] Track: {tid} | Line: A | Frame: {f_idx}")

                            # Check crossing Line B (record first crossing frame)
                            if tid not in line_b_crossings and len(speed_line_b) == 2:
                                if segments_intersect(prev_centers[tid], curr_center, speed_line_b[0], speed_line_b[1]):
                                    line_b_crossings[tid] = f_idx
                                    print(f"[SPEED CROSSING] Track: {tid} | Line: B | Frame: {f_idx}")

                            # When both lines crossed and speed has not been computed yet
                            if tid in line_a_crossings and tid in line_b_crossings and tid not in measured_speeds:
                                f_a = line_a_crossings[tid]
                                f_b = line_b_crossings[tid]
                                delta_f = abs(f_b - f_a)
                                if delta_f > 0:
                                    delta_t = delta_f / float(fps)
                                    if 0.04 <= delta_t <= 30.0:
                                        raw_speed = (distance_meters / delta_t) * 3.6
                                        if 1.0 <= raw_speed <= 250.0:
                                            speed_kmh = round(raw_speed, 1)
                                            measured_speeds[tid] = speed_kmh
                                            print(f"[SPEED CALCULATION] Track: {tid} | Distance: {distance_meters:.1f} m | FPS: {fps:.0f} | Frame A: {f_a} | Frame B: {f_b} | Delta Time: {delta_t:.3f} s | Speed: {speed_kmh:.1f} km/h | Limit: {speed_limit_kmh:.1f} km/h")

                                            # Check speed limit excess
                                            if speed_kmh > speed_limit_kmh and tid not in speed_violated_ids:
                                                speed_violated_ids.add(tid)
                                                violated_ids.add(tid)
                                                print(f"[SPEED EVENT] Track: {tid} | SPEEDING created")

                                                if video_id and video_evidence_dir:
                                                    try:
                                                        violation_id = str(uuid.uuid4())
                                                        h_f, w_f = frame.shape[:2]
                                                        vx1 = max(0, min(w_f - 1, x1))
                                                        vy1 = max(0, min(h_f - 1, y1))
                                                        vx2 = max(0, min(w_f, x2))
                                                        vy2 = max(0, min(h_f, y2))

                                                        vehicle_crop = frame[vy1:vy2, vx1:vx2].copy() if (vx2 > vx1 and vy2 > vy1) else None

                                                        # Annotated speed evidence frame
                                                        evidence_frame = frame.copy()
                                                        cv2.line(evidence_frame, speed_line_a[0], speed_line_a[1], (255, 220, 0), 2)
                                                        cv2.line(evidence_frame, speed_line_b[0], speed_line_b[1], (0, 165, 255), 2)
                                                        cv2.rectangle(evidence_frame, (vx1, vy1), (vx2, vy2), COLOR_BAD, 3)
                                                        put_text(evidence_frame, f"SPEEDING #{tid}: {speed_kmh:.1f} km/h (Limit: {speed_limit_kmh:.0f} km/h)", (vx1, max(30, vy1 - 10)), COLOR_BAD, 0.7, 2)
                                                        put_text(evidence_frame, f"EVIDENCE | SPEED LIMIT EXCEEDED | Track #{tid}", (20, max(40, height - 25)), (0, 165, 255), 0.75, 2)

                                                        evidence_fname = f"evidence_{violation_id}.jpg"
                                                        vehicle_fname = f"vehicle_{violation_id}.jpg"
                                                        plate_fname = f"plate_{violation_id}.jpg"

                                                        evidence_fpath = os.path.join(video_evidence_dir, evidence_fname)
                                                        vehicle_fpath = os.path.join(video_evidence_dir, vehicle_fname)
                                                        plate_fpath = os.path.join(video_evidence_dir, plate_fname)

                                                        cv2.imwrite(evidence_fpath, evidence_frame)
                                                        if vehicle_crop is not None and vehicle_crop.size > 0:
                                                            cv2.imwrite(vehicle_fpath, vehicle_crop)

                                                        plate_crop, _ = localize_license_plate(vehicle_crop) if vehicle_crop is not None else (None, None)
                                                        plate_crop_url = None
                                                        if plate_crop is not None and plate_crop.size > 0:
                                                            cv2.imwrite(plate_fpath, plate_crop)
                                                            plate_crop_url = f"/evidence/{video_id}/{plate_fname}"

                                                        plate_number, ocr_conf = run_ocr(vehicle_crop, plate_crop)
                                                        video_ts_sec = round(float(f_idx) / float(fps), 2)
                                                        det_conf = round(float(conf_score), 2)
                                                        excess_speed = round(speed_kmh - speed_limit_kmh, 1)

                                                        violation_doc = {
                                                            "violation_id": violation_id,
                                                            "video_id": video_id,
                                                            "track_id": int(tid),
                                                            "violation_type": "SPEEDING",
                                                            "vehicle_class": str(cls_name),
                                                            "detection_confidence": det_conf,
                                                            "frame_number": int(f_idx),
                                                            "video_timestamp_seconds": video_ts_sec,
                                                            "detected_at": datetime.now(timezone.utc),
                                                            "detected_speed_kmh": float(speed_kmh),
                                                            "speed_limit_kmh": float(speed_limit_kmh),
                                                            "speed_excess_kmh": float(excess_speed),
                                                            "reason": f"Vehicle exceeded configured speed limit of {speed_limit_kmh:.1f} km/h. Detected speed: {speed_kmh:.1f} km/h.",
                                                            "plate_number": str(plate_number),
                                                            "ocr_confidence": float(ocr_conf) if ocr_conf is not None else None,
                                                            "bounding_box": [vx1, vy1, vx2, vy2],
                                                            "evidence_image": f"/evidence/{video_id}/{evidence_fname}",
                                                            "vehicle_crop": f"/evidence/{video_id}/{vehicle_fname}",
                                                            "plate_crop": plate_crop_url,
                                                            "status": "PENDING",
                                                            "reviewed_at": None
                                                        }

                                                        create_violation_record(violation_doc)
                                                        created_violations.append(violation_doc)
                                                    except Exception as exc:
                                                        print(f"Non-fatal error creating speed violation record for track {tid}: {exc}")

                    prev_centers[tid] = curr_center

                    # Determine visual bounding box and label
                    if analysis_mode == "SPEED":
                        is_viol = (tid in speed_violated_ids)
                        box_color = COLOR_BAD if is_viol else COLOR_OK
                        cls_cap = cls_name.capitalize()
                        if is_viol:
                            sp_val = measured_speeds.get(tid, 0.0)
                            label = f"Track {tid} | {cls_cap} | {sp_val:.1f} km/h | SPEEDING"
                        elif tid in measured_speeds:
                            label = f"Track {tid} | {cls_cap} | {measured_speeds[tid]:.1f} km/h"
                        else:
                            label = f"Track {tid} | {cls_cap}"
                    elif analysis_mode == "RED_SIGNAL":
                        is_viol = (tid in violated_ids)
                        box_color = COLOR_BAD if is_viol else COLOR_OK
                        label = f"VIOLATION: RED LIGHT JUMP | Track #{tid}" if is_viol else f"{cls_name.upper()} | Track #{tid}"
                    elif analysis_mode == "NO_HELMET":
                        is_viol = (tid in helmet_violated_ids)
                        if cls_name == "motorcycle":
                            h_info = no_helmet_tracker.get(tid, {})
                            if is_viol or h_info.get("status") == "NO_HELMET":
                                box_color = COLOR_BAD
                                label = f"NO HELMET #{tid}"
                            elif h_info.get("status") == "HELMET":
                                box_color = COLOR_OK
                                label = f"HELMET OK #{tid}"
                            else:
                                box_color = COLOR_OK
                                label = f"motorcycle #{tid}"
                        else:
                            box_color = COLOR_OK
                            label = f"{cls_name} #{tid}"
                    else:  # ALL
                        is_viol = (tid in violated_ids)
                        box_color = COLOR_BAD if is_viol else COLOR_OK
                        sp_tag = f" {measured_speeds[tid]:.0f}km/h" if tid in measured_speeds else ""
                        label = f"VIOLATION #{tid}{sp_tag}" if is_viol else f"{cls_name} #{tid}{sp_tag}"

                    cv2.rectangle(frame, (x1, y1), (x2, y2), box_color, 2)
                    cv2.circle(frame, curr_center, 4, box_color, -1)

                    if analysis_mode in ("NO_HELMET", "ALL") and cls_name == "motorcycle":
                        h_info = no_helmet_tracker.get(tid, {})
                        if h_info.get("head_box"):
                            hbx = h_info["head_box"]
                            cv2.rectangle(frame, (hbx[0], hbx[1]), (hbx[2], hbx[3]), box_color, 2)

                    # Label pill background
                    label_size, _ = cv2.getTextSize(label, FONT, 0.5, 2)
                    label_y = max(label_size[1] + 6, y1)
                    cv2.rectangle(frame, (x1, label_y - label_size[1] - 6), (x1 + label_size[0] + 6, label_y + 2), box_color, -1)
                    cv2.putText(frame, label, (x1 + 3, label_y - 2), FONT, 0.5, (255, 255, 255), 2, cv2.LINE_AA)

            # Draw semi-transparent stats HUD
            if analysis_mode == "SPEED":
                hud_label = "Speed Violations:"
                # Draw Speed parameters HUD badge on top-right of processed video
                hud_text = f"Dist: {distance_meters:.1f}m | Limit: {speed_limit_kmh:.0f} km/h"
                hud_w, hud_h = 320, 50
                hx0, hy0 = max(10, width - hud_w - 20), 15
                cv2.rectangle(frame, (hx0, hy0), (hx0 + hud_w, hy0 + hud_h), (20, 20, 20), -1)
                cv2.rectangle(frame, (hx0, hy0), (hx0 + hud_w, hy0 + hud_h), (0, 165, 255), 2)
                put_text(frame, hud_text, (hx0 + 16, hy0 + 34), (0, 165, 255), 0.70, 2)
            elif analysis_mode == "RED_SIGNAL":
                hud_label = "Red Violations:"
                # Draw Signal state HUD badge on top-right of processed video
                sig_text = "SIGNAL: RED" if is_red else "SIGNAL: GREEN"
                sig_color = (0, 0, 255) if is_red else (0, 255, 0)
                sig_w, sig_h = 220, 50
                sx0, sy0 = max(10, width - sig_w - 20), 15
                cv2.rectangle(frame, (sx0, sy0), (sx0 + sig_w, sy0 + sig_h), (20, 20, 20), -1)
                cv2.rectangle(frame, (sx0, sy0), (sx0 + sig_w, sy0 + sig_h), sig_color, 2)
                put_text(frame, sig_text, (sx0 + 16, sy0 + 34), sig_color, 0.75, 2)
            elif analysis_mode == "NO_HELMET":
                hud_label = "Helmet Violations:"
            else:
                hud_label = "Violations:"
            draw_stats_panel(frame, len(violated_ids), label=hud_label)

            out_writer.write(frame)
            processed_frames += interval

            if progress_callback and total_frames > 0:
                pct = int(min(99, (processed_frames / total_frames) * 100))
                t_now = time.perf_counter()
                if (pct != last_reported_pct and (pct - last_reported_pct >= 2 or pct >= 99)) or (t_now - last_reported_time >= 0.5):
                    cur_fps = (s_idx + 1) / max(0.001, t_now - t_loop_start)
                    try:
                        progress_callback(pct, current_frame=min(total_frames, f_idx + interval), total_frames=total_frames, fps=cur_fps)
                    except TypeError:
                        progress_callback(pct)
                    last_reported_pct = pct
                    last_reported_time = t_now

    finally:
        out_writer.release()

    if progress_callback:
        try:
            progress_callback(100, current_frame=total_frames, total_frames=total_frames, fps=0.0)
        except TypeError:
            progress_callback(100)

    return {
        "total_frames": int(processed_frames),
        "violations": int(len(violated_ids)),
        "violated_ids": [int(x) for x in violated_ids],
        "created_violations": created_violations,
        "output_path": output_path
    }
