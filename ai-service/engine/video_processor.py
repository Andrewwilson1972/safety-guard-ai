"""
Video Processor — continuous frame capture + AI annotation loop.

Design decisions:
  • One background thread per session; old thread is joined on stop().
  • Tracker and PoseLandmarker are created ONCE per stream session and
    kept alive for the full duration — no per-frame reinit.
  • Frame buffer holds exactly one JPEG; old frames are replaced in-place
    to prevent unbounded memory growth.
  • Configurable frame-skip and resolution (from config.py).
  • Alert cooldown delegated to alert_engine.AlertCooldownManager.
"""

import threading
import time
import logging
import os
from datetime import datetime
from typing import Callable

import cv2
import numpy as np

import config
from engine.alert_engine import process_frame_alerts, reset_cooldowns

logger = logging.getLogger("video_processor")

_SAFE_COLOR   = (34, 197, 94)
_UNSAFE_COLOR = (239,  68,  68)
_HUD_BG       = (10,   10,  20)


class VideoProcessor:
    """
    Thread-safe MJPEG frame producer.

    Usage:
        vp = VideoProcessor()
        vp.configure_models(yolo, DeepSort, pose_factory)
        vp.start("demo")
        frame_jpeg = vp.get_frame()   # called from the MJPEG route
        vp.stop()
    """

    def __init__(self):
        self._lock        = threading.RLock()
        self._stop_event  = threading.Event()
        self._thread: threading.Thread | None = None
        self._ai_thread: threading.Thread | None = None

        # ── shared state (lock-protected) ─────────────────────────────────
        self._latest_jpeg:    bytes | None = None
        self._latest_workers: list[dict]   = []
        self._alert_queue:    list[dict]   = []
        self._is_running:     bool         = False
        self._source:         str          = "demo"
        self._fps:            float        = 0.0
        self._latest_frame:   np.ndarray | None = None
        self._last_detections: list[dict] = []
        self._frame_lock = threading.Lock()

        # ── AI models (injected after load) ───────────────────────────────
        self._yolo          = None
        self._DeepSort      = None
        self._pose_factory: Callable | None = None

        # Start demo mode immediately so the stream is never blank
        self.start("demo")

    # ── public interface ──────────────────────────────────────────────────────

    def configure_models(self, yolo, deep_sort_class, pose_factory_fn: Callable):
        self._yolo         = yolo
        self._DeepSort     = deep_sort_class
        self._pose_factory = pose_factory_fn
        logger.info(
            "VideoProcessor: models configured  "
            f"yolo={'yes' if yolo else 'no'}  "
            f"deepsort={'yes' if deep_sort_class else 'no'}  "
            f"mediapipe={'yes' if pose_factory_fn else 'no'}"
        )

    def start(self, source: str = "demo", file_path: str | None = None) -> None:
        self.stop()
        reset_cooldowns()
        self._stop_event.clear()
        
        # Resolve the actual source to use
        if source == "file" and file_path:
            # File upload: use the actual file path
            resolved = file_path
            logger.info(f"📁 Starting from uploaded file: {file_path}")
        elif file_path and source != "demo" and source != "webcam":
            # Alternative: if source is a path-like string
            resolved = file_path
            logger.info(f"📁 Starting from file: {file_path}")
        else:
            # Demo or webcam mode
            resolved = source
            logger.info(f"🎥 Starting {source} mode")
        
        with self._lock:
            self._source     = resolved
            self._is_running = True
        
        # Start TWO threads: fast video playback + slow AI detection
        self._thread = threading.Thread(
            target=self._video_loop,
            args=(resolved,),
            daemon=True,
            name="video-playback",
        )
        self._thread.start()
        
        self._ai_thread = threading.Thread(
            target=self._ai_loop,
            daemon=True,
            name="ai-detection",
        )
        self._ai_thread.start()
        logger.info(f"✅ Video loop started (fast playback) — source={resolved!r}")
        logger.info(f"✅ AI loop started (slow detection) — running in parallel")

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=4)
        if self._ai_thread and self._ai_thread.is_alive():
            self._ai_thread.join(timeout=2)
        with self._lock:
            self._is_running = False
            # Keep _latest_jpeg alive so the MJPEG stream never goes blank
            # during source switching — the generator will keep serving the
            # last frame until the new source produces its first frame.

    def get_frame(self) -> bytes | None:
        with self._lock:
            return self._latest_jpeg

    def get_status(self) -> dict:
        with self._lock:
            return {
                "running":  self._is_running,
                "source":   self._source,
                "fps":      round(self._fps, 1),
                "workers":  list(self._latest_workers),
            }

    def pop_alerts(self) -> list[dict]:
        """Drain queued alerts (consumed by SSE endpoint)."""
        with self._lock:
            alerts = list(self._alert_queue)
            self._alert_queue.clear()
            return alerts

    # ── parallel video + AI loops ─────────────────────────────────────────────

    def _video_loop(self, source: str) -> None:
        """
        FAST LOOP: Reads frames continuously and encodes them for MJPEG.
        Runs at ~25 FPS independently of AI processing.
        """
        demo_mode = source == "demo"
        cap: cv2.VideoCapture | None = None

        if not demo_mode:
            # Determine if source is a file path or device index
            is_file = source != "webcam" and (source.endswith((".mp4", ".avi", ".mov", ".mkv", ".webm")) or "/" in source or "\\" in source)
            idx = source
            
            logger.info(f"🎬 Initializing stream: {'FILE' if is_file else 'WEBCAM'} → {idx!r}")
            
            # HARD DEBUG: Check file existence and properties
            if is_file:
                file_exists = os.path.exists(idx)
                logger.info(f"📁 FILE PATH: {idx}")
                logger.info(f"📏 EXISTS: {file_exists}")
                if file_exists:
                    file_size = os.path.getsize(idx)
                    logger.info(f"📊 SIZE: {file_size} bytes ({file_size / (1024*1024):.2f} MB)")

            # Retry up to 5× with a short delay — uploaded files may not be
            # fully flushed to disk when VideoCapture is first attempted.
            for attempt in range(5):
                if is_file:
                    # Use FFMPEG backend for safer codec handling
                    cap = cv2.VideoCapture(idx, cv2.CAP_FFMPEG)
                else:
                    cap = cv2.VideoCapture(idx)
                
                is_open = cap is not None and cap.isOpened()
                logger.info(f"🎥 CAP OPEN (attempt {attempt + 1}/5): {is_open}")
                
                if is_open:
                    # Try to read first frame to verify video is readable
                    ret, test_frame = cap.read()
                    logger.info(f"🧪 FIRST FRAME READABLE: {ret}")
                    if ret:
                        logger.info(f"✅ STREAMING ACTIVE: {idx!r}")
                        break
                    else:
                        logger.warning(f"❌ Cannot read frame from {idx!r} — releasing and retrying")
                        cap.release()
                        cap = None
                else:
                    logger.warning(
                        f"❌ Cannot open {idx!r} (attempt {attempt + 1}/5) — retrying…"
                    )
                    if cap:
                        cap.release()
                        cap = None
                time.sleep(0.3)

            if cap is None or not cap.isOpened():
                logger.error(
                    f"❌ FAILED TO OPEN {idx!r} after 5 retries — falling back to DEMO mode"
                )
                if cap:
                    cap.release()
                    cap = None
                demo_mode = True

        # ── create AI instances ONCE for the whole session ────────────────
        tracker    = self._DeepSort(max_age=config.DEEPSORT_MAX_AGE) \
                     if self._DeepSort else None
        landmarker = self._pose_factory() if self._pose_factory else None

        frame_num  = 0
        fps_frames = 0
        t0         = time.monotonic()
        interval   = 1.0 / config.STREAM_FPS

        # ── PRELOAD FIRST FRAME before loop starts ─────────────────────────
        # This ensures _latest_jpeg is never None when clients connect,
        # eliminating the "Connecting..." freeze at startup/switch.
        try:
            if demo_mode:
                logger.info("📺 Generating demo frame (mode=demo)")
                first_frame = self._demo_frame(0)
            else:
                logger.info(f"🖼️ Reading first frame from {source!r}...")
                ret, first_frame = cap.read()  # type: ignore[union-attr]
                logger.info(f"🧪 FIRST FRAME READABLE (preload): {ret}")
                if not ret:
                    logger.warning("❌ Cannot read first frame — falling back to demo mode.")
                    demo_mode = True
                    first_frame = self._demo_frame(0)
                else:
                    logger.info(f"✅ Frame shape: {first_frame.shape if first_frame is not None else 'None'}")

            # Run AI detection on first frame immediately
            if first_frame is not None and self._yolo is not None:
                workers = self._run_ai(first_frame, tracker, landmarker)
                alerts = process_frame_alerts(workers)
                self._persist_async(workers)
                with self._lock:
                    self._latest_workers = workers
                    self._alert_queue.extend(alerts)
                logger.info(f"🤖 AI detection on first frame: {len(workers)} workers detected")
            else:
                workers = []
                logger.info("⚠️ Skipping AI detection (YOLO not ready or no frame)")

            # Encode and store first frame
            annotated = self._annotate(first_frame.copy(), workers)
            ok, buf = cv2.imencode(
                ".jpg", annotated,
                [cv2.IMWRITE_JPEG_QUALITY, config.JPEG_QUALITY],
            )
            if ok:
                with self._lock:
                    self._latest_jpeg = buf.tobytes()
                logger.info(f"✅ FIRST FRAME PRELOADED ({len(buf.tobytes())} bytes) — STREAM READY")
            else:
                logger.warning("⚠️ Failed to encode first frame")
        except Exception as e:
            logger.error(f"❌ FIRST FRAME PRELOAD FAILED: {e}", exc_info=True)
            demo_mode = True

        try:
            while not self._stop_event.is_set():
                tick = time.monotonic()

                # ── FAST: Read frame ──────────────────────────────────────────
                frame = None
                if demo_mode:
                    frame = self._demo_frame(frame_num)
                else:
                    # Always try to read from the open video file
                    if cap and cap.isOpened():  # type: ignore[union-attr]
                        ret, frame = cap.read()  # type: ignore[union-attr]
                        if not ret:
                            # Video ended — loop back to start
                            logger.info(f"🔁 VIDEO ENDED — LOOPING FROM START (played {frame_num} frames)")
                            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)  # type: ignore
                            ret, frame = cap.read()  # type: ignore
                            if ret:
                                frame_num = 0
                                logger.info("✅ VIDEO RESTARTED — PLAYING FROM BEGINNING")
                            else:
                                logger.warning("❌ Cannot restart video — Falling back to demo.")
                                demo_mode = True
                                frame = self._demo_frame(0)
                    else:
                        logger.warning("⚠️ VideoCapture not open — falling back to demo.")
                        demo_mode = True
                        frame = self._demo_frame(frame_num)

                if frame is None:
                    logger.warning("⚠️ Frame is None — using demo frame")
                    frame = self._demo_frame(frame_num)

                with self._frame_lock:
                    self._latest_frame = frame.copy()
                    detections = list(self._last_detections)

                annotated = self._annotate(frame.copy(), detections)
                ok, buf = cv2.imencode(
                    ".jpg", annotated,
                    [cv2.IMWRITE_JPEG_QUALITY, config.JPEG_QUALITY],
                )
                if ok:
                    with self._lock:
                        self._latest_jpeg = buf.tobytes()

                # ── FPS tracking ──────────────────────────────────────────
                fps_frames += 1
                elapsed = time.monotonic() - t0
                if elapsed >= 1.0:
                    with self._lock:
                        self._fps = fps_frames / elapsed
                    fps_frames = 0
                    t0 = time.monotonic()

                frame_num += 1

                # ── PACE: Keep at ~25 FPS ────────────────────────────────────
                spent = time.monotonic() - tick
                pause = interval - spent
                if pause > 0:
                    time.sleep(pause)

        except Exception as e:
            logger.error(f"Video loop error: {e}", exc_info=True)
        finally:
            if cap and not demo_mode:
                cap.release()
            logger.info("🎬 Video loop exited.")

    def _ai_loop(self) -> None:
        """
        SLOW LOOP: Runs AI detection in background on shared frames.
        Runs independently at its own pace (~3-5 second intervals).
        """
        # ── create AI instances ONCE for the session ─────────────────────────
        tracker    = self._DeepSort(max_age=config.DEEPSORT_MAX_AGE) \
                     if self._DeepSort else None
        landmarker = self._pose_factory() if self._pose_factory else None
        
        logger.info(f"🧠 AI loop started (tracker={tracker is not None}, landmarker={landmarker is not None})")

        try:
            while not self._stop_event.is_set():
                with self._frame_lock:
                    if self._latest_frame is None:
                        frame = None
                    else:
                        frame = self._latest_frame.copy()
                if frame is None:
                    time.sleep(0.05)
                    continue

                if self._yolo is not None:
                    try:
                        workers = self._run_ai(frame, tracker, landmarker)
                        alerts = process_frame_alerts(workers)
                        self._persist_async(workers)
                        with self._lock:
                            self._latest_workers = workers
                            self._alert_queue.extend(alerts)
                        with self._frame_lock:
                            self._last_detections = workers
                    except Exception as e:
                        logger.warning(f"⚠️ AI inference error: {e}")

                time.sleep(0.12)

        except Exception as e:
            logger.error(f"AI loop error: {e}", exc_info=True)
        finally:
            if landmarker:
                try:
                    landmarker.close()
                except Exception:
                    pass
            logger.info("🧠 AI loop exited.")

    # ── AI ────────────────────────────────────────────────────────────────────

    def _run_ai(self, frame: np.ndarray, tracker, landmarker) -> list[dict]:
        try:
            from main import run_detection_on_frame, resize_frame
            frame = resize_frame(frame, max(config.STREAM_WIDTH, config.STREAM_HEIGHT))
            return run_detection_on_frame(frame, tracker, landmarker)
        except Exception as e:
            logger.debug(f"AI inference error: {e}")
            return []

    def _persist_async(self, workers: list[dict]) -> None:
        """Non-blocking SQLite write on a throwaway thread."""
        if not workers:
            return
        def _write():
            try:
                from database.sqlite_db import upsert_worker, batch_insert_detections
                for w in workers:
                    upsert_worker(int(w["id"]))
                batch_insert_detections(workers)
            except Exception as e:
                logger.debug(f"SQLite persist error: {e}")
        threading.Thread(target=_write, daemon=True).start()

    # ── annotation ────────────────────────────────────────────────────────────

    def _annotate(self, frame: np.ndarray, workers: list[dict]) -> np.ndarray:
        frame = cv2.resize(frame, (config.STREAM_WIDTH, config.STREAM_HEIGHT))
        h, w = frame.shape[:2]

        for wk in workers:
            x1, y1, x2, y2 = [int(v) for v in wk.get("bbox", [0, 0, 0, 0])]
            x1, x2 = max(0, x1), min(w, x2)
            y1, y2 = max(0, y1), min(h, y2)
            if x2 <= x1 or y2 <= y1:
                continue

            unsafe = wk["status"] == "unsafe"
            color  = _UNSAFE_COLOR if unsafe else _SAFE_COLOR
            label  = f"W#{wk['id']}  {'UNSAFE' if unsafe else 'SAFE'}  {wk['confidence']:.0%}"

            # Box
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

            # Label pill
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            lx = x1
            ly = max(y1 - th - 10, 0)
            cv2.rectangle(frame, (lx, ly), (lx + tw + 6, ly + th + 8), color, -1)
            cv2.putText(frame, label, (lx + 3, ly + th + 4),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)

            # Violations
            for j, viol in enumerate(wk.get("violations", [])[:2]):
                vy = y2 + 15 + j * 15
                if vy < h:
                    cv2.putText(frame, f"! {viol}", (x1, vy),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.38, (60, 120, 255), 1, cv2.LINE_AA)

        # HUD bar
        cv2.rectangle(frame, (0, 0), (w, 26), _HUD_BG, -1)
        unsafe_cnt = sum(1 for wk in workers if wk["status"] == "unsafe")
        safe_cnt   = len(workers) - unsafe_cnt
        ts  = datetime.now().strftime("%H:%M:%S")
        hud = (f"LIVE  |  Workers: {len(workers)}"
               f"  Safe: {safe_cnt}  Unsafe: {unsafe_cnt}"
               f"  |  {ts}  |  {self._fps:.1f} fps")
        cv2.putText(frame, hud, (8, 18),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (180, 180, 190), 1, cv2.LINE_AA)

        # Source tag
        src = str(self._source).upper()[:24]
        cv2.putText(frame, f"SRC: {src}", (8, h - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.35, (80, 80, 100), 1, cv2.LINE_AA)

        return frame

    # ── demo frame ────────────────────────────────────────────────────────────

    def _demo_frame(self, frame_num: int) -> np.ndarray:
        W, H = config.STREAM_WIDTH, config.STREAM_HEIGHT
        frame = np.full((H, W, 3), (20, 22, 32), dtype=np.uint8)

        # Subtle grid
        for x in range(0, W, 64):
            cv2.line(frame, (x, 0), (x, H), (30, 32, 45), 1)
        for y in range(0, H, 64):
            cv2.line(frame, (0, y), (W, y), (30, 32, 45), 1)

        # Center reticle
        cx, cy = W // 2, H // 2
        cv2.circle(frame, (cx, cy), 55, (0, 80, 160), 1)
        cv2.line(frame, (cx - 18, cy), (cx + 18, cy), (0, 100, 200), 1)
        cv2.line(frame, (cx, cy - 18), (cx, cy + 18), (0, 100, 200), 1)

        # Blinking DEMO badge
        if (frame_num // 15) % 2 == 0:
            badge = "DEMO MODE — NO SOURCE"
            (bw, bh), _ = cv2.getTextSize(badge, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            bx = (W - bw) // 2 - 6
            by = cy - 22
            cv2.rectangle(frame, (bx, by), (bx + bw + 12, by + bh + 10), (0, 100, 180), -1)
            cv2.putText(frame, badge, (bx + 6, by + bh + 4),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 230, 255), 1, cv2.LINE_AA)

        cv2.putText(frame, "Upload a video file or start webcam",
                    (W // 2 - 155, cy + 28),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (80, 90, 120), 1, cv2.LINE_AA)
        cv2.putText(frame, "to begin real-time AI detection",
                    (W // 2 - 130, cy + 50),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (60, 70, 100), 1, cv2.LINE_AA)

        # Corner brackets
        for bx, by, dx, dy in [(18, 18, 1, 1), (W-18, 18, -1, 1),
                                (18, H-18, 1, -1), (W-18, H-18, -1, -1)]:
            cv2.line(frame, (bx, by), (bx + dx * 14, by), (0, 140, 210), 2)
            cv2.line(frame, (bx, by), (bx, by + dy * 14), (0, 140, 210), 2)

        # Timestamp
        ts = datetime.now().strftime("%Y-%m-%d  %H:%M:%S")
        cv2.putText(frame, ts, (8, H - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.38, (60, 70, 90), 1, cv2.LINE_AA)

        return frame
