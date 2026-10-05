import os
import cv2

# --- Base Directory Paths ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
OUTPUTS_DIR = os.path.join(BASE_DIR, "outputs")
EVIDENCE_DIR = os.path.join(BASE_DIR, "evidence")
ROAD_CONFIG_PATH = os.path.join(BASE_DIR, "road_config.json")

# Ensure required storage directories exist inside backend/
os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(OUTPUTS_DIR, exist_ok=True)
os.makedirs(EVIDENCE_DIR, exist_ok=True)

# --- MongoDB Configuration ---
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "traffic_violation_db")

# --- File Paths ---
VIDEO_IN = os.path.join(BASE_DIR, "videos", "traffic_video.mp4")
VIDEO_OUT = os.path.join(OUTPUTS_DIR, "output_violations.mp4")
DEFAULT_WEIGHTS_FILE = os.path.join(BASE_DIR, "yolov8n.pt")
VEHICLE_MODEL_WEIGHTS = DEFAULT_WEIGHTS_FILE if os.path.exists(DEFAULT_WEIGHTS_FILE) else "yolov8n.pt"
DEFAULT_HELMET_WEIGHTS = os.path.join(BASE_DIR, "helmet_yolov8n.pt")
HELMET_MODEL_WEIGHTS = DEFAULT_HELMET_WEIGHTS if os.path.exists(DEFAULT_HELMET_WEIGHTS) else "helmet_yolov8n.pt"
TRACKER_CFG = "bytetrack.yaml"

# --- Detection Thresholds ---
CONF_VEHICLE = 0.35
IOU_VEHICLE = 0.45
CONF_HELMET = 0.35
HELMET_CONFIRMATION_FRAMES = 3
TRAFFIC_LIGHT_REFRESH = 5
MIN_PIX_COUNT = 50

# --- HSV Color Ranges for Traffic Lights ---
# Format: (Lower, Upper)
HSV_RED1 = ((0, 80, 80), (10, 255, 255))
HSV_RED2 = ((170, 80, 80), (180, 255, 255))
HSV_YELLOW = ((20, 90, 100), (32, 255, 255))
HSV_GREEN = ((40, 80, 80), (85, 255, 255))

# --- UI Colors (BGR) ---
COLOR_LINE = (0, 0, 255) 
COLOR_TEXT = (230, 230, 230)
COLOR_OK = (0, 255, 0)
COLOR_BAD = (0, 0, 255)
COLOR_ROI = (150, 255, 150)
FONT = cv2.FONT_HERSHEY_SIMPLEX

# --- Allowed Classes ---
VEH_OK = {"car", "bus", "truck", "motorcycle"}