import cv2
import numpy as np
from config import (
    HSV_RED1, HSV_RED2, HSV_YELLOW, HSV_GREEN, 
    MIN_PIX_COUNT, TRAFFIC_LIGHT_REFRESH
)

class TrafficLightDetector:
    def __init__(self):
        self.kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        self.clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))

    def detect_color(self, bgr_patch):
        """Analyzes a cropped ROI to determine the active traffic light color."""
        if bgr_patch is None or bgr_patch.size == 0:
            return "unknown"

        # 1. Preprocessing & Normalization
        h, w = bgr_patch.shape[:2]
        if h * w > 160 * 160:
            scale = min(1.0, np.sqrt((160 * 160) / (h * w)))
            bgr_patch = cv2.resize(bgr_patch, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        
        bgr = cv2.GaussianBlur(bgr_patch, (5, 5), 0)
        hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
        h_ch, s_ch, v_ch = cv2.split(hsv)
        v_ch = self.clahe.apply(v_ch)
        hsv = cv2.merge([h_ch, s_ch, v_ch])

        # 2. Color Masking
        red1 = cv2.inRange(hsv, HSV_RED1[0], HSV_RED1[1])
        red2 = cv2.inRange(hsv, HSV_RED2[0], HSV_RED2[1])
        red_mask = red1 + red2
        yellow_mask = cv2.inRange(hsv, HSV_YELLOW[0], HSV_YELLOW[1])
        green_mask = cv2.inRange(hsv, HSV_GREEN[0], HSV_GREEN[1])

        # 3. Noise Removal (Morphology)
        masks = []
        for m in [red_mask, yellow_mask, green_mask]:
            m = cv2.morphologyEx(m, cv2.MORPH_OPEN, self.kernel, iterations=1)
            masks.append(cv2.morphologyEx(m, cv2.MORPH_CLOSE, self.kernel, iterations=1))
        
        r_mask, y_mask, g_mask = masks

        # 4. Scoring based on pixel intensity
        v_norm = v_ch.astype(np.float32) / 255.0
        scores = {
            'red': float((r_mask / 255.0 * v_norm).sum()),
            'yellow': float((y_mask / 255.0 * v_norm).sum()),
            'green': float((g_mask / 255.0 * v_norm).sum())
        }

        # 5. Validation Logic
        total_px = bgr.shape[0] * bgr.shape[1]
        best_color = max(scores, key=scores.get)
        max_score = scores[best_color]
        
        # Check if any color is strong enough to be valid
        if max_score < MIN_PIX_COUNT and (max_score / total_px) < 0.002:
            return "unknown"

        # Check for ambiguity (if two colors are too close in score)
        sorted_scores = sorted(scores.values(), reverse=True)
        if sorted_scores[1] > 0 and (max_score / (sorted_scores[1] + 1e-6)) < 1.15:
            return "unknown"

        return best_color

def crop_roi(frame, roi_pts):
    """Helper to safely crop a rectangle from a frame."""
    (x1, y1), (x2, y2) = roi_pts
    xa, ya = max(0, min(x1, x2)), max(0, min(y1, y2))
    xb, yb = min(frame.shape[1] - 1, max(x1, x2)), min(frame.shape[0] - 1, max(y1, y2))
    if xb <= xa or yb <= ya:
        return None
    return frame[ya:yb, xa:xb].copy()