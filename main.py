import os
import cv2
import numpy as np
from ultralytics import YOLO

# Import our custom modules
from config import *
from utils import put_text, segments_intersect, draw_stats_panel, auto_open_video
from detector import TrafficLightDetector, crop_roi

# --- Global UI Variables ---
line_pts = []
roi_pts_list = []
drawing_mode = None

def setup_mouse_cb(event, x, y, flags, param):
    global drawing_mode
    if event != cv2.EVENT_LBUTTONDOWN:
        return
    H, W = param['img_shape']
    if not (0 <= x < W and 0 <= y < H):
        return
    
    if drawing_mode == 'line':
        if len(line_pts) < 2:
            line_pts.append((x, y))
        if len(line_pts) == 2:
            drawing_mode = None
    elif drawing_mode == 'roi':
        if not roi_pts_list or len(roi_pts_list[-1]) == 2:
            roi_pts_list.append([])
        roi_pts_list[-1].append((x, y))
        if len(roi_pts_list[-1]) == 2:
            drawing_mode = None

def draw_setup_hud(disp):
    put_text(disp, "L: Draw LINE | R: Add TL ROI | U: Undo | C: Clear", (18, 28), (200,200,200), 0.6)
    put_text(disp, "SPACE: Start | Q: Quit", (18, 56), (200,200,200), 0.6)
    
    if len(line_pts) == 2:
        cv2.line(disp, line_pts[0], line_pts[1], COLOR_LINE, 2)
    for roi in roi_pts_list:
        if len(roi) == 2:
            cv2.rectangle(disp, roi[0], roi[1], COLOR_ROI, 2)

def main():
    global drawing_mode
    if not os.path.exists(VIDEO_IN):
        print(f"Error: {VIDEO_IN} not found.")
        return

    cap = cv2.VideoCapture(VIDEO_IN)
    ok, first_frame = cap.read()
    if not ok: return
    H, W = first_frame.shape[:2]

    # --- Interaction Phase ---
    cv2.namedWindow("Setup")
    cv2.setMouseCallback("Setup", setup_mouse_cb, param={'img_shape': (H, W)})
    
    while True:
        disp = first_frame.copy()
        draw_setup_hud(disp)
        cv2.imshow("Setup", disp)
        k = cv2.waitKey(20) & 0xFF
        if k == ord('l'): drawing_mode = 'line'; line_pts.clear()
        elif k == ord('r'): drawing_mode = 'roi'
        elif k == ord('u') and roi_pts_list: roi_pts_list.pop()
        elif k == ord('c'): roi_pts_list.clear(); line_pts.clear()
        elif k == ord(' ') and len(line_pts) == 2: break
        elif k == ord('q'): cap.release(); cv2.destroyAllWindows(); return

    cv2.destroyWindow("Setup")

    # --- Processing Phase ---
    detector = TrafficLightDetector()
    model = YOLO(VEHICLE_MODEL_WEIGHTS)
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(VIDEO_OUT, fourcc, cap.get(cv2.CAP_PROP_FPS), (W, H))
    
    stream = model.track(source=VIDEO_IN, conf=CONF_VEHICLE, iou=IOU_VEHICLE, 
                         tracker=TRACKER_CFG, stream=True, persist=True)

    violated_ids = set()
    prev_centers = {}
    roi_colors = []
    
    for f_idx, res in enumerate(stream):
        frame = res.orig_img.copy()
        
        # Update Traffic Light Colors periodically
        if f_idx % TRAFFIC_LIGHT_REFRESH == 0 or not roi_colors:
            roi_colors = [detector.detect_color(crop_roi(frame, r)) for r in roi_pts_list if len(r)==2]

        is_red = any(c == 'red' for c in roi_colors)

        # Drawing ROIs and Line
        cv2.line(frame, line_pts[0], line_pts[1], COLOR_LINE, 2)
        for i, roi in enumerate([r for r in roi_pts_list if len(r)==2]):
            cv2.rectangle(frame, roi[0], roi[1], COLOR_ROI, 1)
            put_text(frame, roi_colors[i].upper(), (roi[0][0], roi[0][1]-5), COLOR_ROI, 0.5)

        # Vehicle Tracking Logic
        if res.boxes is not None and res.boxes.id is not None:
            boxes = res.boxes.xyxy.cpu().numpy()
            ids = res.boxes.id.cpu().numpy().astype(int)
            clss = res.boxes.cls.cpu().numpy().astype(int)
            names = res.names

            for box, tid, cls_idx in zip(boxes, ids, clss):
                if names[cls_idx] not in VEH_OK: continue
                
                x1, y1, x2, y2 = map(int, box)
                curr_center = ((x1 + x2) // 2, (y1 + y2) // 2)
                
                if tid in prev_centers:
                    if is_red and segments_intersect(prev_centers[tid], curr_center, line_pts[0], line_pts[1]):
                        violated_ids.add(tid)
                
                prev_centers[tid] = curr_center
                
                color = COLOR_BAD if tid in violated_ids else (0, 255, 0)
                label = "VIOLATION" if tid in violated_ids else f"{names[cls_idx]} {tid}"
                cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                put_text(frame, label, (x1, y1 - 10), color, 0.6)

        draw_stats_panel(frame, len(violated_ids))
        out.write(frame)
        cv2.imshow("Processing", frame)
        if cv2.waitKey(1) == ord('q'): break

    cap.release()
    out.release()
    cv2.destroyAllWindows()
    auto_open_video(VIDEO_OUT)

if __name__ == "__main__":
    main()