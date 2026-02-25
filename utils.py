import cv2
import os
import sys
import subprocess
from config import FONT, COLOR_TEXT, COLOR_BAD

def put_text(img, txt, org, color=(255, 255, 255), scale=0.7, thick=2):
    """Standardized text drawing for the HUD and labels."""
    cv2.putText(img, txt, org, FONT, scale, color, thick, cv2.LINE_AA)

def ccw(a, b, c):
    """Helper for intersection math."""
    return (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0])

def segments_intersect(a, b, c, d):
    """Checks if the path of a vehicle (a->b) crosses the violation line (c->d)."""
    return ccw(a, c, d) != ccw(b, c, d) and ccw(a, b, c) != ccw(a, b, d)

def draw_stats_panel(frame, violations_count):
    """Draws the semi-transparent violation counter in the top-left corner."""
    panel_w, panel_h = 260, 70
    x0, y0 = 15, 15
    overlay = frame.copy()
    cv2.rectangle(overlay, (x0, y0), (x0 + panel_w, y0 + panel_h), (25, 25, 25), -1)
    frame[y0:y0 + panel_h, x0:x0 + panel_h] = cv2.addWeighted(
        overlay[y0:y0 + panel_h, x0:x0 + panel_h], 0.45,
        frame[y0:y0 + panel_h, x0:x0 + panel_h], 0.55, 0
    )
    put_text(frame, "Violations:", (x0 + 12, y0 + 28), COLOR_TEXT, 0.7, 2)
    put_text(frame, f"{violations_count}", (x0 + 12, y0 + 58), COLOR_BAD, 0.95, 2)

def auto_open_video(path):
    """Opens the resulting video file automatically based on the OS."""
    try:
        if os.name == 'nt':
            os.startfile(path)
        elif sys.platform == 'darwin':
            subprocess.Popen(['open', path])
        else:
            subprocess.Popen(['xdg-open', path])
    except Exception as e:
        print(f"Note: Could not open video automatically: {e}")