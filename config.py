import cv2

# --- File Paths ---
VIDEO_IN  = "videos\\traffic_video.mp4"
VIDEO_OUT = "output_violations.mp4"
VEHICLE_MODEL_WEIGHTS = "yolo12l.pt"
TRACKER_CFG  = "bytetrack.yaml"

# --- Detection Thresholds ---
CONF_VEHICLE = 0.35
IOU_VEHICLE  = 0.45
TRAFFIC_LIGHT_REFRESH = 5
MIN_PIX_COUNT = 50

# --- HSV Color Ranges for Traffic Lights ---
# Format: (Lower, Upper)
HSV_RED1    = ((0, 80, 80), (10, 255, 255))
HSV_RED2    = ((170, 80, 80), (180, 255, 255))
HSV_YELLOW  = ((20, 90, 100), (32, 255, 255))
HSV_GREEN   = ((40, 80, 80), (85, 255, 255))

# --- UI Colors (BGR) ---
COLOR_LINE  = (0, 0, 255) 
COLOR_TEXT  = (230, 230, 230)
COLOR_OK    = (0, 255, 0)
COLOR_BAD   = (0, 0, 255)
COLOR_ROI   = (150, 255, 150)
FONT        = cv2.FONT_HERSHEY_SIMPLEX

# --- Allowed Classes ---
VEH_OK = {"car", "bus", "truck", "motorcycle"}