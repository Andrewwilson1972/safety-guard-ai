# Worker Safety Monitor

**AI-powered real-time worker surveillance and safety monitoring.**

Live MJPEG video stream with YOLOv8 person detection, DeepSORT multi-person tracking, and MediaPipe pose analysis. Detects unsafe posture and violations, pushes live alerts, and generates AI-written PDF safety reports — all fully offline-capable.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript, TailwindCSS, ShadCN UI, Recharts |
| API Server | Node.js, Express 5, TypeScript, Drizzle ORM |
| AI Service | Python, FastAPI, YOLOv8n, DeepSORT, MediaPipe Tasks API |
| Database | PostgreSQL (Drizzle schema) + SQLite (local AI detections) |
| AI Chat / Reports | OpenAI GPT-4o **or** Ollama llama3 (fully offline) |

---

## Architecture

```
Browser  (React + Vite — dark theme, ShadCN UI, Recharts)
    │
    ▼  REST / SSE / MJPEG  →  /api/*
Express API  (Node.js — port 3001)
  dashboard · alerts · history · chat · PDF report · stream proxy
    │
    ▼  HTTP proxy  →  port 8000
FastAPI AI Service  (Python)
  YOLOv8n → DeepSORT → MediaPipe → MJPEG /stream → SQLite → alerts
    │
    ▼
PostgreSQL  +  SQLite (ai-service/data/safety.db)
```

---

## Quick Start

### Prerequisites

- **Node.js 20+** and **pnpm** (`npm install -g pnpm`)
- **Python 3.11+**
- **PostgreSQL 15+** — or use Docker (see below)
- For offline AI: **[Ollama](https://ollama.ai)** installed locally

---

### 1 — Clone and install

```bash
git clone https://github.com/your-username/worker-safety-monitor.git
cd worker-safety-monitor

# Node dependencies
pnpm install

# Python dependencies (CPU-only PyTorch — works everywhere)
cd ai-service
pip install -r requirements.txt \
  --extra-index-url https://download.pytorch.org/whl/cpu
cd ..
```

---

### 2 — Start PostgreSQL

Using Docker (easiest):

```bash
docker-compose up -d postgres
```

Or connect to your own PostgreSQL instance and create a database named `worker_safety`.

---

### 3 — Configure environment

```bash
cp .env.example .env
# Edit .env — at minimum set DATABASE_URL and SESSION_SECRET
```

**Offline AI (recommended):**

```bash
ollama pull llama3   # one-time ~4 GB download
ollama serve         # keep this running
```

Then in `.env`:
```
OLLAMA_BASE_URL=http://localhost:11434
```

**OpenAI cloud AI (alternative):**
```
OPENAI_API_KEY=sk-...
```

---

### 4 — Run database migrations

```bash
pnpm --filter @workspace/db run migrate
```

---

### 5 — Start all three services

Open three terminals:

```bash
# Terminal 1 — Python AI service (port 8000)
cd ai-service
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 — Node.js API server (port 3001)
PORT=3001 pnpm --filter @workspace/api-server run dev

# Terminal 3 — React frontend (port 5173)
pnpm --filter @workspace/worker-safety run dev
```

Open **http://localhost:5173**

---

## Pages

| Route | Description |
|---|---|
| `/` | Dashboard — live charts, safety score, recent alerts |
| `/video` | Video Feed — MJPEG stream with live bounding boxes, upload & webcam |
| `/alerts` | Security Alerts — real detections from DB, severity badges, search |
| `/history` | Detection History — paginated audit log with filters |
| `/assistant` | AI Safety Assistant — GPT-4o or llama3 chat with live DB context |
| `/reports` | Safety Reports — AI-generated PDF download |

---

## AI Detection Pipeline

Frames flow through three models in sequence:

1. **YOLOv8n** — detects persons in each frame
2. **DeepSORT** — assigns persistent tracking IDs across frames  
3. **MediaPipe PoseLandmarker** — estimates body pose, flags unsafe posture

> **Note:** Uses MediaPipe Tasks API (`mediapipe.tasks.python.vision.PoseLandmarker`).  
> The deprecated `mp.solutions.pose` was removed in mediapipe 0.10.33.

Model weights:
- `ai-service/pose_landmarker_lite.task` — included in repo (5.6 MB)
- `ai-service/yolov8n.pt` — auto-downloaded by Ultralytics on first run

---

## Project Structure

```
worker-safety-monitor/
├── frontend/                    # React + Vite frontend
│   └── src/
│       ├── pages/
│       │   ├── dashboard.tsx
│       │   ├── video-feed.tsx
│       │   ├── alerts.tsx
│       │   ├── history.tsx
│       │   ├── assistant.tsx
│       │   └── reports.tsx
│       └── components/
├── api-server/                  # Node.js Express API
│   └── src/
│       ├── routes/
│       │   ├── stream.ts        # MJPEG proxy + upload
│       │   ├── chat.ts          # Streaming SSE AI chat
│       │   ├── report.ts        # PDF report generation
│       │   ├── analytics.ts
│       │   ├── dashboard.ts
│       │   └── history.ts
│       └── lib/
│           └── ai-client.ts     # Ollama / OpenAI auto-detection
├── ai-service/                  # Python FastAPI AI service
│   ├── main.py                  # Routes + model singletons
│   ├── config.py                # Central config + GPU detection
│   ├── engine/
│   │   ├── video_processor.py   # Parallel MJPEG + AI loops
│   │   └── alert_engine.py      # Severity scoring + cooldowns
│   ├── database/
│   │   └── sqlite_db.py         # Local SQLite store
│   ├── pose_landmarker_lite.task
│   └── requirements.txt
├── lib/                         # Shared TypeScript libraries
│   ├── db/                      # Drizzle ORM schema + client
│   ├── api-spec/                # OpenAPI specification
│   ├── api-zod/                 # Generated Zod validators
│   └── api-client-react/        # Generated React Query hooks
├── docker-compose.yml           # PostgreSQL + Ollama
├── .env.example
└── README.md
```

---

## API Reference

### Express API (`/api/*`, port 3001)

| Method | Path | Description |
|---|---|---|
| GET | `/api/healthz` | Health check |
| POST | `/api/detect` | Upload image/video → detection result |
| GET | `/api/analytics/summary` | Safety stats from PostgreSQL |
| GET | `/api/analytics/trends` | 30-day daily detection trends |
| GET | `/api/history` | Paginated detection history |
| GET | `/api/dashboard/stats` | Dashboard summary |
| GET | `/api/dashboard/recent-alerts` | Recent unsafe detections |
| GET | `/api/dashboard/violation-breakdown` | Violation frequency by type |
| GET | `/api/ai-mode` | Active AI backend (`openai` or `ollama`) |
| POST | `/api/chat` | Streaming SSE AI chat |
| GET | `/api/report` | Download AI PDF report |
| GET | `/api/stream` | MJPEG live stream (proxied) |
| POST | `/api/stream/upload` | Upload video → start streaming |
| GET | `/api/stream/status` | Stream status + tracked workers |
| GET | `/api/stream/alerts` | SSE live alert feed |

### FastAPI AI Service (port 8000)

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Models status |
| POST | `/detect` | Single-shot image/video detection |
| GET | `/stream` | Raw MJPEG stream |
| POST | `/stream/upload` | Upload + auto-start streaming |
| GET | `/analytics` | SQLite offline stats |
| GET | `/history` | Recent detections from SQLite |

---

## Configuration Reference

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string (required) |
| `SESSION_SECRET` | — | API server session secret (required) |
| `OLLAMA_BASE_URL` | — | Ollama server URL (offline AI) |
| `OLLAMA_MODEL` | `llama3` | Ollama model name |
| `OPENAI_API_KEY` | — | OpenAI API key (cloud AI) |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI model name |
| `DEVICE` | auto | `cpu` / `cuda` / `mps` |
| `FRAME_SKIP` | `3` | Process every N-th frame |
| `STREAM_WIDTH` | `640` | Output frame width |
| `STREAM_HEIGHT` | `480` | Output frame height |
| `STREAM_FPS` | `25` | Target frames per second |
| `YOLO_CONFIDENCE` | `0.35` | Min YOLO detection confidence |
| `DEEPSORT_MAX_AGE` | `30` | Frames before track is dropped |
| `ALERT_COOLDOWN` | `10` | Seconds between alerts per worker |

---

## Database Schema

```sql
workers    (id, track_id UNIQUE, name, created_at)
detections (id, worker_id FK, upload_id, status, violations JSONB,
            confidence, bbox JSONB, timestamp)
```

Managed with Drizzle ORM:

```bash
pnpm --filter @workspace/db run generate   # generate migration
pnpm --filter @workspace/db run migrate    # apply migrations
```

---

## GPU Acceleration

CPU is used by default. To enable GPU:

```bash
# NVIDIA CUDA
pip install torch torchvision
# set DEVICE=cuda in .env

# Apple Silicon (MPS)
pip install torch torchvision
# set DEVICE=mps in .env (or leave blank — auto-detected)
```

---

## Troubleshooting

**Stream shows "DEMO MODE"**  
→ Go to `/video`, click **Video File** and upload an `.mp4`, or click **Webcam**.

**`YOLO_MODEL not found` on first run**  
→ Ultralytics auto-downloads `yolov8n.pt` on first run. Ensure internet access or place the file manually in `ai-service/`.

**Slow PyTorch install**  
```bash
pip install torch==2.5.1+cpu torchvision==0.20.1+cpu \
  --extra-index-url https://download.pytorch.org/whl/cpu
```

**Ollama returns connection refused**  
→ Run `ollama serve` in a separate terminal and ensure `OLLAMA_BASE_URL` is set.

**`Cannot read properties of undefined`**  
→ Ensure all three services are running and the frontend is proxying `/api` to the correct port.

---

## License

MIT
