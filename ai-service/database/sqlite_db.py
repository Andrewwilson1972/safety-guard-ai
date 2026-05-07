"""
SQLite persistence layer for offline / VS Code mode.
Stores real-time stream detections locally with proper indexes.
"""

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Generator

from config import SQLITE_PATH

# One lock for all write operations
_write_lock = threading.Lock()


def _init_connection(conn: sqlite3.Connection) -> None:
    """Configure a connection with WAL mode and foreign keys."""
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.row_factory = sqlite3.Row


@contextmanager
def get_conn() -> Generator[sqlite3.Connection, None, None]:
    """Thread-safe read connection (short-lived)."""
    conn = sqlite3.connect(str(SQLITE_PATH), check_same_thread=False)
    _init_connection(conn)
    try:
        yield conn
    finally:
        conn.close()


def init_db() -> None:
    """Create tables and indexes (idempotent)."""
    SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS workers (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                track_id   INTEGER UNIQUE NOT NULL,
                first_seen TEXT NOT NULL DEFAULT (datetime('now')),
                last_seen  TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS detections (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                track_id     INTEGER NOT NULL,
                status       TEXT    NOT NULL,
                violations   TEXT    NOT NULL DEFAULT '[]',
                confidence   REAL    NOT NULL DEFAULT 0.0,
                bbox         TEXT    NOT NULL DEFAULT '[]',
                timestamp    TEXT    NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_det_timestamp  ON detections(timestamp);
            CREATE INDEX IF NOT EXISTS idx_det_track_id   ON detections(track_id);
            CREATE INDEX IF NOT EXISTS idx_det_status     ON detections(status);
        """)
        conn.commit()


def upsert_worker(track_id: int) -> None:
    """Insert worker if new; update last_seen if existing."""
    now = datetime.utcnow().isoformat()
    with _write_lock:
        with get_conn() as conn:
            conn.execute("""
                INSERT INTO workers (track_id, first_seen, last_seen)
                VALUES (?, ?, ?)
                ON CONFLICT(track_id) DO UPDATE SET last_seen = excluded.last_seen
            """, (track_id, now, now))
            conn.commit()


def batch_insert_detections(workers: list[dict]) -> None:
    """Insert a batch of detection results atomically."""
    if not workers:
        return
    now = datetime.utcnow().isoformat()
    rows = [
        (
            int(w["id"]),
            w["status"],
            json.dumps(w.get("violations", [])),
            float(w.get("confidence", 0.0)),
            json.dumps(w.get("bbox", [])),
            now,
        )
        for w in workers
    ]
    with _write_lock:
        with get_conn() as conn:
            conn.executemany("""
                INSERT INTO detections (track_id, status, violations, confidence, bbox, timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
            """, rows)
            conn.commit()


# ── Read helpers ──────────────────────────────────────────────────────────────

def get_stats() -> dict:
    with get_conn() as conn:
        total_workers = conn.execute("SELECT COUNT(*) FROM workers").fetchone()[0]
        total_det     = conn.execute("SELECT COUNT(*) FROM detections").fetchone()[0]
        safe_det      = conn.execute("SELECT COUNT(*) FROM detections WHERE status='safe'").fetchone()[0]
        unsafe_det    = conn.execute("SELECT COUNT(*) FROM detections WHERE status='unsafe'").fetchone()[0]
        safety_score  = round((safe_det / total_det) * 100) if total_det > 0 else 100
    return {
        "total_workers":  total_workers,
        "total_detections": total_det,
        "safe_count":     safe_det,
        "unsafe_count":   unsafe_det,
        "safety_score":   safety_score,
    }


def get_recent_detections(limit: int = 50) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute("""
            SELECT track_id, status, violations, confidence, timestamp
            FROM   detections
            ORDER  BY timestamp DESC
            LIMIT  ?
        """, (limit,)).fetchall()
    return [
        {
            "track_id":   r["track_id"],
            "status":     r["status"],
            "violations": json.loads(r["violations"]),
            "confidence": r["confidence"],
            "timestamp":  r["timestamp"],
        }
        for r in rows
    ]


def get_violation_breakdown() -> list[dict]:
    """Return violation frequency counts for all-time data."""
    with get_conn() as conn:
        rows = conn.execute("""
            SELECT violations FROM detections WHERE status = 'unsafe'
        """).fetchall()
    freq: dict[str, int] = {}
    for r in rows:
        for v in json.loads(r["violations"]):
            freq[v] = freq.get(v, 0) + 1
    return [{"name": k, "count": v} for k, v in sorted(freq.items(), key=lambda x: -x[1])]
