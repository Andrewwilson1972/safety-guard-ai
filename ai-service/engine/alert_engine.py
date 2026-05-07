"""
Alert Engine — classifies worker detections into safety alerts with
cooldown support to prevent duplicate-alert spam.

Severity: LOW | MEDIUM | HIGH | CRITICAL
"""

import time
import threading
from datetime import datetime, timezone

from config import ALERT_COOLDOWN_SECONDS


# ── Severity mapping ─────────────────────────────────────────────────────────

VIOLATION_SEVERITY: dict[str, str] = {
    "Fall / Severe Lean Detected":  "CRITICAL",
    "Unsafe Posture Detected":      "HIGH",
    "Restricted Zone Entry":        "HIGH",
    "No Hard Hat":                  "HIGH",
    "No Safety Vest":               "MEDIUM",
    "No Gloves":                    "MEDIUM",
    "No Goggles":                   "MEDIUM",
    "Obstructed Vision":            "LOW",
}

_SEVERITY_RANK = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1}


def classify_severity(violations: list[str]) -> str:
    """Return the highest severity among the given violations."""
    best = "LOW"
    for v in violations:
        sev = VIOLATION_SEVERITY.get(v, "LOW")
        if _SEVERITY_RANK.get(sev, 1) > _SEVERITY_RANK.get(best, 1):
            best = sev
    return best


def build_alert(worker: dict) -> dict | None:
    """
    Build an alert dict from a detection result.
    Returns None if the worker is safe.
    """
    if worker.get("status") != "unsafe":
        return None
    violations: list[str] = worker.get("violations") or ["Unsafe Posture Detected"]
    return {
        "worker_id":  worker.get("id"),
        "severity":   classify_severity(violations),
        "violations": violations,
        "confidence": round(worker.get("confidence", 0.0), 3),
        "bbox":       worker.get("bbox", []),
        "timestamp":  datetime.now(timezone.utc).isoformat(),
        "resolved":   False,
    }


# ── Cooldown manager ─────────────────────────────────────────────────────────

class AlertCooldownManager:
    """
    Thread-safe per-worker cooldown.
    Suppresses repeated alerts for the same worker within the cooldown window.
    """

    def __init__(self, cooldown_seconds: int = ALERT_COOLDOWN_SECONDS):
        self._cooldown = cooldown_seconds
        self._last_times: dict[int, float] = {}
        self._lock = threading.Lock()

    def should_emit(self, worker_id: int) -> bool:
        now = time.monotonic()
        with self._lock:
            last = self._last_times.get(worker_id, 0.0)
            if now - last >= self._cooldown:
                self._last_times[worker_id] = now
                return True
            return False

    def reset(self, worker_id: int | None = None) -> None:
        """Reset cooldown for one worker, or all workers if None."""
        with self._lock:
            if worker_id is None:
                self._last_times.clear()
            else:
                self._last_times.pop(worker_id, None)

    def set_cooldown(self, seconds: int) -> None:
        self._cooldown = seconds


# Module-level singleton used by VideoProcessor
_cooldown_manager = AlertCooldownManager()


def process_frame_alerts(workers: list[dict]) -> list[dict]:
    """
    Build alerts for all unsafe workers, honouring cooldowns.
    Returns only the alerts that should be emitted.
    """
    alerts = []
    for w in workers:
        alert = build_alert(w)
        if alert is None:
            continue
        wid = alert.get("worker_id")
        if wid is not None and _cooldown_manager.should_emit(wid):
            alerts.append(alert)
    return alerts


def reset_cooldowns() -> None:
    """Call this when the stream source changes."""
    _cooldown_manager.reset()
