import os
import re
import cv2
import numpy as np
from typing import Tuple, Optional

# Global cached EasyOCR reader instance
_ocr_reader = None


def get_ocr_reader():
    """
    Initializes or returns the cached EasyOCR reader instance.
    Runs on CPU without verbose terminal output.
    """
    global _ocr_reader
    if _ocr_reader is None:
        try:
            import easyocr
            # verbose=False suppresses character download logs that can trigger encoding issues on Windows
            _ocr_reader = easyocr.Reader(['en'], gpu=False, verbose=False)
        except Exception as e:
            print(f"Warning: Could not initialize EasyOCR reader: {e}")
            _ocr_reader = None
    return _ocr_reader


def localize_license_plate(vehicle_crop: np.ndarray) -> Tuple[Optional[np.ndarray], Optional[Tuple[int, int, int, int]]]:
    """
    Attempts to localize a plausible license plate rectangle within a vehicle crop
    using OpenCV contour and aspect ratio filtering.
    
    Returns:
        (plate_crop, (x, y, w, h)) if a plausible plate is found, else (None, None).
    """
    if vehicle_crop is None or vehicle_crop.size == 0:
        return None, None

    h_img, w_img = vehicle_crop.shape[:2]
    if h_img < 30 or w_img < 40:
        return None, None

    try:
        # Preprocessing: focus primarily on the lower 75% of the vehicle where plates reside
        y_start = int(h_img * 0.25)
        search_region = vehicle_crop[y_start:, :]
        s_h, s_w = search_region.shape[:2]
        if s_h < 15 or s_w < 30:
            return None, None

        gray = cv2.cvtColor(search_region, cv2.COLOR_BGR2GRAY)
        
        # Bilateral filter removes noise while keeping edges sharp
        filtered = cv2.bilateralFilter(gray, 9, 75, 75)
        
        # Morphological gradient / Blackhat to highlight dark/light rectangular plate regions
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (13, 5))
        blackhat = cv2.morphologyEx(filtered, cv2.MORPH_BLACKHAT, kernel)
        
        # Adaptive edge detection
        edges = cv2.Canny(blackhat, 30, 180)
        
        # Dilate horizontally to connect plate characters
        dilate_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 3))
        dilated = cv2.dilate(edges, dilate_kernel, iterations=1)

        contours, _ = cv2.findContours(dilated, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
        
        candidates = []
        for c in contours:
            x, y, w, h = cv2.boundingRect(c)
            if h <= 0 or w <= 0:
                continue

            aspect_ratio = float(w) / float(h)
            area = w * h
            area_ratio = float(area) / float(s_w * s_h)

            # Standard Indian plates typically have an aspect ratio between ~1.8 and ~5.2
            # Area should be roughly between 1.5% and 30% of the search region
            if 1.8 <= aspect_ratio <= 5.5 and 0.015 <= area_ratio <= 0.35 and w >= 35 and h >= 12:
                # Plausibility score: prefer lower half and typical aspect ratio ~3.5
                center_y = y + h / 2.0
                pos_score = center_y / float(s_h)
                aspect_score = 1.0 - abs(aspect_ratio - 3.5) / 3.5
                score = (pos_score * 0.5) + (aspect_score * 0.5)
                candidates.append((score, x, y + y_start, w, h))

        if not candidates:
            return None, None

        # Sort by score descending and take the best plausible candidate
        candidates.sort(key=lambda item: item[0], reverse=True)
        _, bx, by, bw, bh = candidates[0]

        # Add small padding if within frame bounds
        pad_x = int(bw * 0.05)
        pad_y = int(bh * 0.08)
        x1 = max(0, bx - pad_x)
        y1 = max(0, by - pad_y)
        x2 = min(w_img, bx + bw + pad_x)
        y2 = min(h_img, by + bh + pad_y)

        plate_crop = vehicle_crop[y1:y2, x1:x2].copy()
        return plate_crop, (x1, y1, x2 - x1, y2 - y1)

    except Exception as e:
        print(f"Plate localization error: {e}")
        return None, None


def clean_plate_text(raw_text: str) -> str:
    """
    Normalizes recognized plate text:
    - Converts to uppercase
    - Removes whitespace, dashes, and unsupported special characters
    - Leaves only alphanumeric characters [A-Z0-9]
    """
    if not raw_text:
        return ""
    cleaned = raw_text.upper()
    cleaned = re.sub(r'[^A-Z0-9]', '', cleaned)
    return cleaned


def is_valid_plate_structure(text: str) -> bool:
    """
    Checks if normalized text has a plausible structure for vehicle plates
    (e.g., standard Indian registration formats like MH12AB1234 or flexible 5-11 alphanumeric).
    """
    if len(text) < 4 or len(text) > 12:
        return False

    # Check for presence of both letters and numbers
    has_letters = bool(re.search(r'[A-Z]', text))
    has_numbers = bool(re.search(r'[0-9]', text))

    # A real plate almost always contains both characters and digits
    if has_letters and has_numbers:
        return True

    # If it is >= 6 digits/chars with high confidence, allow
    if len(text) >= 6:
        return True

    return False


def run_ocr(vehicle_crop: np.ndarray, plate_crop: Optional[np.ndarray] = None) -> Tuple[str, Optional[float]]:
    """
    Runs EasyOCR pipeline on the candidate plate crop (or fallback vehicle crop region).
    
    Returns:
        (plate_number, confidence)
        If plate cannot be confidently read: ("Not Detected", None).
    """
    reader = get_ocr_reader()
    if reader is None:
        return "Not Detected", None

    # Target image candidate: prefer localized plate crop, fallback to lower 40% of vehicle
    target_img = None
    if plate_crop is not None and plate_crop.size > 0:
        target_img = plate_crop
    elif vehicle_crop is not None and vehicle_crop.size > 0:
        h, w = vehicle_crop.shape[:2]
        if h > 30 and w > 40:
            target_img = vehicle_crop[int(h * 0.55):, :]

    if target_img is None or target_img.size == 0:
        return "Not Detected", None

    try:
        # Preprocessing target for OCR: normalize scale
        h_t, w_t = target_img.shape[:2]
        if w_t > 320:
            scale = 320.0 / float(w_t)
            target_img = cv2.resize(target_img, (320, max(20, int(h_t * scale))), interpolation=cv2.INTER_AREA)
            h_t, w_t = target_img.shape[:2]

        if h_t < 60:
            scale = max(1.0, 70.0 / float(h_t))
            target_img = cv2.resize(target_img, (int(w_t * scale), int(h_t * scale)), interpolation=cv2.INTER_CUBIC)

        gray = cv2.cvtColor(target_img, cv2.COLOR_BGR2GRAY)
        
        # CLAHE contrast enhancement
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(gray)

        # Run OCR with batch_size=1
        results = reader.readtext(enhanced, detail=1, paragraph=False, batch_size=1)
        if not results:
            return "Not Detected", None

        # Filter and extract highest confidence valid text
        valid_candidates = []
        for bbox, text, conf in results:
            cleaned = clean_plate_text(text)
            if cleaned and conf >= 0.20:
                valid_candidates.append((cleaned, float(conf)))

        if not valid_candidates:
            return "Not Detected", None

        # If multiple fragments detected, sort by confidence and length
        # Try joining if individual tokens look like state code + number
        if len(valid_candidates) > 1:
            joined_text = "".join(c[0] for c in valid_candidates)
            avg_conf = sum(c[1] for c in valid_candidates) / len(valid_candidates)
            if is_valid_plate_structure(joined_text):
                return joined_text, round(avg_conf, 2)

        # Pick best single candidate
        valid_candidates.sort(key=lambda x: (is_valid_plate_structure(x[0]), x[1], len(x[0])), reverse=True)
        best_text, best_conf = valid_candidates[0]

        if is_valid_plate_structure(best_text):
            return best_text, round(best_conf, 2)
        elif len(best_text) >= 4 and best_conf >= 0.40:
            return best_text, round(best_conf, 2)

        return "Not Detected", None

    except Exception as e:
        print(f"OCR execution error: {e}")
        return "Not Detected", None
