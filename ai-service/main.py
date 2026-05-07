"""
Worker Safety AI Service — v4.1 (Production / Offline-Ready)
Real-time pipeline: YOLOv8 + DeepSORT + MediaPipe  |  MJPEG + SSE + SQLite
"""

import asyncio
import json
import logging
import os
import shutil
import tempfile
import traceback
from pathlib import Path

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

import config
from config import print_config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("ai-service")

UPLOAD_DIR = config.DATA_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="Worker Safety AI Service",
    description="Real-time offline pipeline: YOLOv8 + DeepSORT + MediaPipe",
    version="4.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Singletons ────────────────────────────────────────────────────────────────

yolo_model      = None          # loaded once at startup
DeepSortTracker = None          # class reference
mp_pose_path:   str | None = None


@app.on_event("startup")
async def load_models():
    global yolo_model, DeepSortTracker, mp_pose_path

    print_config()

    # ── SQLite ────────────────────────────────────────────────────────────
    try:
        from database.sqlite_db import init_db
        init_db()
        logger.info("SQLite DB initialised.")
    except Exception as e:
        logger.warning(f"SQLite init failed (non-critical): {e}")

    # ── YOLOv8 ────────────────────────────────────────────────────────────
    try:
        from ultralytics import YOLO
        logger.info(f"Loading YOLOv8  model={config.YOLO_MODEL_PATH}  device={config.DEVICE}")
        yolo_model = YOLO(config.YOLO_MODEL_PATH)
        if config.DEVICE != "cpu":
            yolo_model.to(config.DEVICE)
        logger.info("YOLOv8 ready.")
    except Exception as e:
        logger.error(f"YOLOv8 load failed: {e}")

    # ── MediaPipe ─────────────────────────────────────────────────────────
    model_file = Path(config.MEDIAPIPE_MODEL_PATH)
    if model_file.exists():
        mp_pose_path = str(model_file)
        logger.info(f"MediaPipe model: {mp_pose_path}")
    else:
        logger.warning("pose_landmarker_lite.task not found — pose disabled.")

    # ── DeepSORT ──────────────────────────────────────────────────────────
    try:
        from deep_sort_realtime.deepsort_tracker import DeepSort as _DS
        DeepSortTracker = _DS
        logger.info("DeepSORT ready.")
    except Exception as e:
        logger.error(f"DeepSORT load failed: {e}")

    # ── Wire models into the global VideoProcessor ─────────────────────────
    video_processor.configure_models(yolo_model, DeepSortTracker, _make_pose_landmarker)
    logger.info("Startup complete.")


# ── Helpers ───────────────────────────────────────────────────────────────────

_NOSE           = 0
_LEFT_SHOULDER  = 11
_RIGHT_SHOULDER = 12
_LEFT_HIP       = 23
_RIGHT_HIP      = 24


def _make_pose_landmarker():
    """Create a single PoseLandmarker (Tasks API).  Returns None if unavailable."""
    if mp_pose_path is None:
        return None
    try:
        import mediapipe as mp
        from mediapipe.tasks.python import vision as mpv
        from mediapipe.tasks.python.core import base_options as mpb
        opts = mpv.PoseLandmarkerOptions(
            base_options=mpb.BaseOptions(model_asset_path=mp_pose_path),
            running_mode=mpv.RunningMode.IMAGE,
            num_poses=1,
            min_pose_detection_confidence=0.4,
            min_tracking_confidence=0.4,
        )
        return mpv.PoseLandmarker.create_from_options(opts)
    except Exception as e:
        logger.warning(f"PoseLandmarker init failed: {e}")
        return None


def resize_frame(frame: np.ndarray, max_size: int = 640) -> np.ndarray:
    h, w = frame.shape[:2]
    if max(h, w) <= max_size:
        return frame
    scale = max_size / max(h, w)
    return cv2.resize(frame, (int(w * scale), int(h * scale)))


def check_pose_safety(lm) -> tuple[bool, list[str]]:
    if not lm:
        return False, []
    violations: list[str] = []

    def vis(i): return getattr(lm[i], "visibility", 0.0) if i < len(lm) else 0.0
    def y(i):   return lm[i].y if i < len(lm) else 0.0
    def x(i):   return lm[i].x if i < len(lm) else 0.0

    # Fall / severe lean
    if vis(_NOSE) > 0.5 and vis(_LEFT_SHOULDER) > 0.5 and vis(_RIGHT_SHOULDER) > 0.5:
        avg_sh_y = (y(_LEFT_SHOULDER) + y(_RIGHT_SHOULDER)) / 2.0
        if y(_NOSE) > avg_sh_y + 0.05:
            violations.append("Fall / Severe Lean Detected")

    # Unsafe posture (shoulder-hip misalignment)
    if all(vis(i) > 0.5 for i in [_LEFT_SHOULDER, _RIGHT_SHOULDER, _LEFT_HIP, _RIGHT_HIP]):
        avg_sh_y = (y(_LEFT_SHOULDER) + y(_RIGHT_SHOULDER)) / 2.0
        avg_sh_x = (x(_LEFT_SHOULDER) + x(_RIGHT_SHOULDER)) / 2.0
        avg_hp_y = (y(_LEFT_HIP)      + y(_RIGHT_HIP))      / 2.0
        avg_hp_x = (x(_LEFT_HIP)      + x(_RIGHT_HIP))      / 2.0
        dy = avg_hp_y - avg_sh_y
        dx = abs(avg_hp_x - avg_sh_x)
        if dy > 0.01 and (dx / dy) > 0.6:
            violations.append("Unsafe Posture Detected")

    return bool(violations), violations


def run_detection_on_frame(frame, tracker, pose_landmarker) -> list[dict]:
    """Single-frame YOLO + DeepSORT + MediaPipe.  Shared by stream and upload paths."""
    if yolo_model is None:
        return []

    frame = resize_frame(frame)
    h, w = frame.shape[:2]

    # YOLO
    results = yolo_model(
        frame, classes=[0], verbose=False,
        conf=config.YOLO_CONFIDENCE,
        device=config.DEVICE,
    )[0]
    detections = []
    for box in results.boxes:
        conf = float(box.conf[0])
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        detections.append(([x1, y1, x2 - x1, y2 - y1], conf, "person"))

    # DeepSORT
    track_boxes: list[tuple] = []
    if tracker and detections:
        tracks = tracker.update_tracks(detections, frame=frame)
        for t in tracks:
            if not t.is_confirmed():
                continue
            ltrb = t.to_ltrb()
            bx1 = max(0, int(ltrb[0])); by1 = max(0, int(ltrb[1]))
            bx2 = min(w, int(ltrb[2])); by2 = min(h, int(ltrb[3]))
            conf = next(
                (d[1] for d in detections if abs(d[0][0]-bx1) < 50 and abs(d[0][1]-by1) < 50),
                0.5,
            )
            track_boxes.append((t.track_id, [bx1, by1, bx2, by2], conf))

    if not track_boxes:
        for i, det in enumerate(detections):
            dx1, dy1, dw, dh = det[0]
            track_boxes.append(
                (i + 1, [int(dx1), int(dy1), int(dx1+dw), int(dy1+dh)], det[1])
            )

    # MediaPipe per person
    workers: list[dict] = []
    for tid, bbox, conf in track_boxes:
        x1, y1, x2, y2 = bbox
        crop = frame[y1:y2, x1:x2]
        if crop.size == 0:
            continue
        landmarks = None
        if pose_landmarker:
            try:
                import mediapipe as mp
                rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
                result = pose_landmarker.detect(
                    mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                )
                if result.pose_landmarks:
                    landmarks = result.pose_landmarks[0]
            except Exception as e:
                logger.debug(f"Pose error track {tid}: {e}")
        unsafe, violations = check_pose_safety(landmarks)
        workers.append({
            "id": int(tid), "bbox": [x1, y1, x2, y2],
            "confidence": round(conf, 3),
            "status": "unsafe" if unsafe else "safe",
            "violations": violations,
        })
    return workers


# ── VideoProcessor singleton ─────────────────────────────────────────────────

from engine.video_processor import VideoProcessor
video_processor: VideoProcessor = VideoProcessor()


# ── Upload-based detection (unchanged) ───────────────────────────────────────

def process_image(image_bytes: bytes) -> list[dict]:
    nparr = np.frombuffer(image_bytes, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("Cannot decode image.")
    tracker    = DeepSortTracker(max_age=5) if DeepSortTracker else None
    landmarker = _make_pose_landmarker()
    workers    = run_detection_on_frame(frame, tracker, landmarker)
    if landmarker:
        landmarker.close()
    return workers


def process_video(video_path: str, max_frames: int = 25) -> list[dict]:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError("Cannot open video file.")
    total   = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    step    = max(1, total // max_frames)
    tracker = DeepSortTracker(max_age=30) if DeepSortTracker else None
    lm      = _make_pose_landmarker()
    seen: dict[int, dict] = {}
    idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if idx % step == 0:
            for w in run_detection_on_frame(frame, tracker, lm):
                ex = seen.get(w["id"])
                if ex and ex["status"] == "unsafe":
                    w["status"]     = "unsafe"
                    w["violations"] = list(set(ex["violations"] + w["violations"]))
                seen[w["id"]] = w
        idx += 1
    cap.release()
    if lm:
        lm.close()
    return list(seen.values())


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "version": "4.1.0",
        "device": config.DEVICE,
        "models": {
            "yolo":     yolo_model is not None,
            "mediapipe": mp_pose_path is not None,
            "deepsort": DeepSortTracker is not None,
        },
        "stream": video_processor.get_status(),
    }


@app.post("/detect")
async def detect_workers(file: UploadFile = File(...)):
    ct = (file.content_type or "").lower()
    fn = (file.filename or "").lower()
    is_image = ct.startswith("image/") or fn.endswith((".jpg",".jpeg",".png",".webp",".bmp"))
    is_video = ct.startswith("video/") or fn.endswith((".mp4",".avi",".mov",".mkv",".webm"))
    if not is_image and not is_video:
        raise HTTPException(status_code=400, detail=f"Unsupported type: {ct}")

    raw  = await file.read()
    size = round(len(raw) / 1024, 2)

    if yolo_model is None:
        return {
            "workers": [],
            "summary": {"total_workers": 0, "safe_workers": 0,
                        "unsafe_workers": 0, "violations_detected": 0},
            "model": "unavailable",
            "note": "AI models not loaded.",
        }

    try:
        if is_image:
            workers = process_image(raw)
        else:
            sfx = os.path.splitext(fn)[1] or ".mp4"
            with tempfile.NamedTemporaryFile(suffix=sfx, delete=False) as tmp:
                tmp.write(raw); tmp_path = tmp.name
            try:
                workers = process_video(tmp_path)
            finally:
                os.unlink(tmp_path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Detection pipeline failed.")

    return {
        "file_name": file.filename, "file_size_kb": size, "content_type": ct,
        "workers": workers,
        "summary": {
            "total_workers": len(workers),
            "safe_workers":  sum(1 for w in workers if w["status"] == "safe"),
            "unsafe_workers": sum(1 for w in workers if w["status"] == "unsafe"),
            "violations_detected": sum(len(w["violations"]) for w in workers),
        },
        "model": f"yolov8n + deepsort + mediapipe  device={config.DEVICE}",
    }


# ── Stream routes ─────────────────────────────────────────────────────────────

def _mjpeg_generator():
    """Yields MJPEG multipart frames; never crashes — falls back to last frame."""
    import time as _time
    while True:
        frame = video_processor.get_frame()
        if frame:
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n"
                + frame +
                b"\r\n"
            )
        else:
            _time.sleep(0.05)


@app.get("/stream")
async def stream_video():
    """MJPEG real-time stream."""
    return StreamingResponse(
        _mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache, no-store"},
    )


@app.get("/stream/status")
async def stream_status():
    return video_processor.get_status()


@app.post("/stream/start")
async def stream_start(body: dict = None):
    body   = body or {}
    source = body.get("source", "demo")
    fpath  = body.get("file_path")
    video_processor.start(source=source, file_path=fpath)
    return {"started": True, "source": fpath or source}


@app.post("/stream/stop")
async def stream_stop():
    video_processor.stop()
    return {"stopped": True}


@app.post("/stream/upload")
async def stream_upload(file: UploadFile = File(...)):
    fn  = Path(file.filename or "upload.mp4").name
    dst = UPLOAD_DIR / fn
    
    # Write file and flush to disk
    with dst.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    
    # Verify file was actually written
    if not dst.exists():
        logger.error(f"❌ UPLOAD FAILED: File not written to {dst}")
        raise HTTPException(status_code=500, detail="File write failed")
    
    file_size = dst.stat().st_size
    logger.info(f"✅ UPLOADED: {fn} ({file_size} bytes) → {dst}")
    
    # Start streaming from the saved file
    video_processor.start(source="file", file_path=str(dst))
    return {"uploaded": True, "file": fn, "stream_started": True, "path": str(dst)}


@app.get("/stream/detections")
async def stream_detections():
    """
    Real-time snapshot of all currently tracked workers.
    Clients poll this at ~1s interval for the live detections panel.
    """
    status  = video_processor.get_status()
    workers = status.get("workers", [])
    enriched = []
    for w in workers:
        wid = w.get("id", 0)
        enriched.append({
            "id":         wid,
            "name":       f"Worker {wid:02d}",
            "status":     w.get("status", "unknown"),
            "violations": w.get("violations", []),
            "violation":  ", ".join(w.get("violations", [])) or "none",
            "confidence": w.get("confidence", 0.0),
            "bbox":       w.get("bbox", []),
        })
    return {
        "running":  status.get("running", False),
        "fps":      status.get("fps",     0.0),
        "source":   status.get("source",  "demo"),
        "workers":  enriched,
        "summary":  {
            "total":  len(enriched),
            "safe":   sum(1 for w in enriched if w["status"] == "safe"),
            "unsafe": sum(1 for w in enriched if w["status"] == "unsafe"),
        },
    }


@app.get("/stream/alerts")
async def stream_alerts():
    """SSE: push alert events as they are detected."""
    async def gen():
        while True:
            for alert in video_processor.pop_alerts():
                yield f"data: {json.dumps(alert)}\n\n"
            await asyncio.sleep(0.5)
    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


# ── Offline analytics (SQLite) ────────────────────────────────────────────────

@app.get("/analytics")
async def offline_analytics():
    """Local stats from SQLite (offline dashboard data)."""
    try:
        from database.sqlite_db import get_stats, get_violation_breakdown
        return {**get_stats(), "violations": get_violation_breakdown()}
    except Exception as e:
        return {"error": str(e), "note": "SQLite not available"}


@app.get("/history")
async def offline_history():
    """Recent detections from local SQLite store."""
    try:
        from database.sqlite_db import get_recent_detections
        return {"detections": get_recent_detections(50)}
    except Exception as e:
        return {"detections": [], "error": str(e)}


# ── Ollama chat (offline) ─────────────────────────────────────────────────────

@app.post("/chat")
async def ollama_chat(body: dict):
    """
    Offline AI chat via Ollama.
    Falls back gracefully when Ollama is not running.
    """
    message = (body.get("message") or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="message required")

    if not config.OLLAMA_BASE_URL:
        return {
            "response": (
                "Offline AI is not configured. "
                "Set OLLAMA_BASE_URL=http://localhost:11434 and run Ollama locally."
            ),
            "model": None,
        }

    # Gather context from SQLite
    context = ""
    try:
        from database.sqlite_db import get_stats, get_violation_breakdown
        stats  = get_stats()
        viols  = get_violation_breakdown()[:5]
        top_v  = ", ".join(f"{v['name']} ({v['count']}x)" for v in viols) or "none"
        context = (
            f"System stats: {stats['total_workers']} workers tracked, "
            f"{stats['total_detections']} detections, "
            f"safety score {stats['safety_score']}%, "
            f"top violations: {top_v}."
        )
    except Exception:
        context = "No local stats available."

    system_prompt = (
        "You are a workplace safety AI assistant for a real-time worker surveillance system. "
        "Be concise and professional. Use the provided stats when answering. "
        "No markdown formatting."
    )

    try:
        import requests as _req
        payload = {
            "model": config.OLLAMA_MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": f"Context: {context}\n\nQuestion: {message}"},
            ],
            "stream": False,
            "options": {"temperature": 0.4},
        }
        resp = _req.post(
            f"{config.OLLAMA_BASE_URL.rstrip('/')}/api/chat",
            json=payload,
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "response": data["message"]["content"],
            "model": config.OLLAMA_MODEL,
        }
    except Exception as e:
        logger.warning(f"Ollama request failed: {e}")
        return {
            "response": (
                "Ollama is not reachable. Make sure it is running: "
                "`ollama serve` then `ollama pull llama3`."
            ),
            "model": None,
            "error": str(e),
        }


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
