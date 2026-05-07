"""
Central configuration for the Worker Safety AI Service.
All values can be overridden via environment variables.
"""

import os
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────────
BASE_DIR    = Path(__file__).parent
DATA_DIR    = BASE_DIR / "data"
MODELS_DIR  = BASE_DIR          # yolov8n.pt lives here by default
REPORTS_DIR = BASE_DIR / "reports"
SQLITE_PATH = DATA_DIR / "safety.db"

DATA_DIR.mkdir(parents=True, exist_ok=True)
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

# ── Device auto-detection ─────────────────────────────────────────────────────
def _detect_device() -> str:
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
        # Apple Silicon
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
    except ImportError:
        pass
    return "cpu"

DEVICE = os.getenv("DEVICE", _detect_device())

# ── Model paths ───────────────────────────────────────────────────────────────
YOLO_MODEL_PATH      = os.getenv("YOLO_MODEL",       str(MODELS_DIR / "yolov8n.pt"))
MEDIAPIPE_MODEL_PATH = os.getenv("MEDIAPIPE_MODEL",  str(BASE_DIR   / "pose_landmarker_lite.task"))

# ── Stream settings ───────────────────────────────────────────────────────────
FRAME_SKIP     = int(  os.getenv("FRAME_SKIP",     "3"))    # process every N-th frame
STREAM_WIDTH   = int(  os.getenv("STREAM_WIDTH",   "640"))
STREAM_HEIGHT  = int(  os.getenv("STREAM_HEIGHT",  "480"))
STREAM_FPS     = int(  os.getenv("STREAM_FPS",     "25"))
JPEG_QUALITY   = int(  os.getenv("JPEG_QUALITY",   "75"))

# ── Detection settings ────────────────────────────────────────────────────────
YOLO_CONFIDENCE  = float(os.getenv("YOLO_CONFIDENCE",  "0.35"))
DEEPSORT_MAX_AGE = int(  os.getenv("DEEPSORT_MAX_AGE", "30"))

# ── Alert settings ────────────────────────────────────────────────────────────
ALERT_COOLDOWN_SECONDS = int(os.getenv("ALERT_COOLDOWN", "10"))

# ── Ollama (offline AI) ───────────────────────────────────────────────────────
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "")
OLLAMA_MODEL    = os.getenv("OLLAMA_MODEL", "llama3")

# ── Summary ───────────────────────────────────────────────────────────────────
def print_config():
    print(f"[config] device={DEVICE}  frame_skip={FRAME_SKIP}  "
          f"resolution={STREAM_WIDTH}x{STREAM_HEIGHT}  fps={STREAM_FPS}")
    print(f"[config] yolo={YOLO_MODEL_PATH}  confidence={YOLO_CONFIDENCE}")
    print(f"[config] alert_cooldown={ALERT_COOLDOWN_SECONDS}s  "
          f"deepsort_max_age={DEEPSORT_MAX_AGE}")
    ollama_status = OLLAMA_BASE_URL or "not configured"
    print(f"[config] ollama={ollama_status}  model={OLLAMA_MODEL}")
