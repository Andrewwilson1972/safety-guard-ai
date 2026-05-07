# Worker Safety Monitor

AI-powered worker surveillance and safety monitoring web application with real computer vision AI pipeline.

## Run & Operate

| Command | Description |
|---|---|
| `pnpm install --force` | Install / regenerate all workspace symlinks |
| `pnpm run typecheck` | Full typecheck (libs + leaf packages) |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate Zod schemas + React Query hooks |
| `pnpm --filter @workspace/worker-safety run build` | Build frontend static files |
| `pnpm --filter @workspace/api-server run build` | Build API server bundle |

**Required env vars:**
- `DATABASE_URL` — PostgreSQL connection (auto-provisioned on Replit)
- `SESSION_SECRET` — Session secret
- `AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY` — Auto-set by Replit AI Integrations (or set `OPENAI_BASE_URL` + `OPENAI_API_KEY` manually)

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 7, TypeScript, TailwindCSS v4, ShadCN UI, Recharts |
| API | Node.js Express 5, TypeScript, Drizzle ORM, Pino logger |
| AI Service | Python FastAPI, YOLOv8n, DeepSORT, MediaPipe Tasks API |
| Database | PostgreSQL (Drizzle schema in `lib/db/`) |
| AI Chat/Report | OpenAI GPT model via Replit AI Integrations or direct key |
| PDF | pdfkit (externalized from esbuild bundle) |

## Where Things Live

```
frontend/           # React+Vite app (@workspace/worker-safety, port 25468)
api-server/         # Express API (@workspace/api-server, port 8080)
ai-service/         # Python FastAPI AI pipeline (port 8000)
lib/
  db/               # Drizzle schema (source of truth for DB)
  api-spec/         # OpenAPI spec → openapi.yaml (source of truth for API)
  api-zod/          # Generated Zod schemas (do not edit)
  api-client-react/ # Generated React Query hooks (do not edit)
  integrations-openai-ai-server/  # OpenAI client wrapper
scripts/            # Shared utility scripts
```

## Architecture

```
React+Vite Frontend (port 25468)
    ↓ Vite dev proxy /api →
Node.js Express API (port 8080)  ←→  PostgreSQL DB
    ↓
Python FastAPI AI Service (port 8000)
    ↓
YOLOv8n + DeepSORT + MediaPipe Tasks API
```

## Pages

| Route | Description |
|---|---|
| `/` | Dashboard — live DB analytics, charts, recent unsafe detections |
| `/video` | Video Feed — 4-camera grid, drag-and-drop upload, real AI detection |
| `/alerts` | Security Alerts — unsafe detections from DB, severity badges, search |
| `/history` | Detection History — paginated audit log with filters |
| `/assistant` | AI Safety Assistant — GPT chat with live DB context, streaming SSE |
| `/reports` | Safety Reports — AI-generated PDF download |

## Architecture Decisions

- **pdfkit externalized** from esbuild bundle — fontkit/pdfkit use `@swc/helpers` which cannot be bundled; pdfkit is required at runtime from node_modules.
- **MediaPipe Tasks API only** — `mp.solutions.pose` was removed in mediapipe 0.10.33; must use `mediapipe.tasks.python.vision.PoseLandmarker`.
- **PyTorch pinned** to `torch==2.5.1+cpu` + `torchvision==0.20.1+cpu` (matching CPU pair required by ultralytics).
- **AI client reads both Replit vars and standard OPENAI_*** — `api-server/src/lib/ai-client.ts` checks `AI_INTEGRATIONS_OPENAI_*` first then falls back to `OPENAI_*`, model defaults to `gpt-4o`.
- **SSE for chat streaming** — `/api/chat` uses Server-Sent Events; raw `fetch` on the frontend (not generated hooks).
- **Video upload uses raw `fetch`** — multipart form data; generated hooks don't support file uploads.

## Product

- Real-time worker detection via YOLOv8 + DeepSORT tracking
- Pose analysis (MediaPipe) to flag safety posture violations
- Dashboard with live analytics, trends, and violation breakdown
- AI chat assistant with live database context
- Automated PDF safety reports with executive summary

## User Preferences

- GitHub-ready structure: `frontend/`, `api-server/`, `ai-service/` at root level (not under `artifacts/`)
- No Replit-specific plugins or `@replit/*` deps in frontend

## Gotchas

- **After moving directories**, always run `pnpm install --force` to regenerate pnpm symlinks (relative depth changes break them).
- **Stale processes**: After a workspace restart, kill any lingering Vite/node processes from old paths before restarting workflows.
- **Python AI workflow**: The Replit workflow command is `cd backend-ai && ...` — this path no longer exists; the directory is now `ai-service/`. The workflow config updates require the workflows skill.
- **No `temperature` param** for `gpt-4o` and newer GPT models.
- System libs required for OpenCV: `xorg.libxcb`, `xorg.libX11`, `libGL`, `glib`.

## Pointers

- DB schema: `lib/db/schema.ts`
- OpenAPI spec: `lib/api-spec/openapi.yaml`
- AI pipeline: `ai-service/main.py`, `ai-service/engine/video_processor.py`
- Build config: `api-server/build.mjs`
- Docker setup: `docker-compose.yml` + `ai-service/Dockerfile`
