/**
 * Stream proxy routes — forward requests to the Python FastAPI AI service
 * at localhost:8000 for the MJPEG live stream and stream controls.
 *
 * Routes:
 *   GET  /api/stream            → MJPEG video stream (proxied)
 *   GET  /api/stream/status     → JSON status
 *   POST /api/stream/start      → start stream
 *   POST /api/stream/stop       → stop stream
 *   GET  /api/stream/alerts     → SSE alert feed (proxied)
 *   POST /api/stream/upload     → upload video file for streaming
 */

import http from "node:http";
import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();
const AI_HOST = "localhost";
const AI_PORT = 8000;

/** Generic JSON proxy (small responses only) */
async function proxyJson(
  method: string,
  path: string,
  body: unknown,
  res: Response
): Promise<void> {
  return new Promise((resolve) => {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: AI_HOST,
        port: AI_PORT,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
        },
      },
      (proxyRes) => {
        let data = "";
        proxyRes.on("data", (chunk) => (data += chunk));
        proxyRes.on("end", () => {
          try {
            res.status(proxyRes.statusCode ?? 200).json(JSON.parse(data));
          } catch {
            res.status(proxyRes.statusCode ?? 200).send(data);
          }
          resolve();
        });
      }
    );
    req.on("error", () => {
      if (!res.headersSent)
        res.status(502).json({ error: "AI service unavailable" });
      resolve();
    });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── MJPEG stream ─────────────────────────────────────────────────────────────

router.get("/stream", (req: Request, res: Response): void => {
  const proxyReq = http.get(
    { hostname: AI_HOST, port: AI_PORT, path: "/stream" },
    (proxyRes) => {
      // Forward all headers (content-type: multipart/x-mixed-replace)
      const headers: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        if (v !== undefined) headers[k] = v as string | string[];
      }
      res.writeHead(proxyRes.statusCode ?? 200, headers);
      proxyRes.pipe(res, { end: true });
    }
  );

  proxyReq.on("error", () => {
    if (!res.headersSent)
      res.status(502).json({ error: "Stream service unavailable" });
  });

  // Clean up when client disconnects
  req.on("close", () => proxyReq.destroy());
});

// ── SSE alert feed ────────────────────────────────────────────────────────────

router.get("/stream/alerts", (req: Request, res: Response): void => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const proxyReq = http.get(
    { hostname: AI_HOST, port: AI_PORT, path: "/stream/alerts" },
    (proxyRes) => {
      proxyRes.on("data", (chunk) => res.write(chunk));
      proxyRes.on("end", () => res.end());
    }
  );

  proxyReq.on("error", () => {
    res.write(`data: ${JSON.stringify({ error: "AI service unavailable" })}\n\n`);
    res.end();
  });

  req.on("close", () => proxyReq.destroy());
});

// ── Control endpoints ─────────────────────────────────────────────────────────

router.get("/stream/status", async (req: Request, res: Response): Promise<void> => {
  await proxyJson("GET", "/stream/status", null, res);
});

router.get("/stream/detections", async (req: Request, res: Response): Promise<void> => {
  await proxyJson("GET", "/stream/detections", null, res);
});

router.post("/stream/start", async (req: Request, res: Response): Promise<void> => {
  await proxyJson("POST", "/stream/start", req.body, res);
});

router.post("/stream/stop", async (req: Request, res: Response): Promise<void> => {
  await proxyJson("POST", "/stream/stop", null, res);
});

// ── Video upload for streaming ────────────────────────────────────────────────

router.post("/stream/upload", (req: Request, res: Response): void => {
  const proxyReq = http.request(
    {
      hostname: AI_HOST,
      port: AI_PORT,
      path: "/stream/upload",
      method: "POST",
      headers: req.headers,
    },
    (proxyRes) => {
      let data = "";
      proxyRes.on("data", (chunk) => (data += chunk));
      proxyRes.on("end", () => {
        try {
          res.status(proxyRes.statusCode ?? 200).json(JSON.parse(data));
        } catch {
          res.status(proxyRes.statusCode ?? 200).send(data);
        }
      });
    }
  );
  proxyReq.on("error", () => {
    if (!res.headersSent)
      res.status(502).json({ error: "AI service unavailable" });
  });
  req.pipe(proxyReq, { end: true });
});

export default router;
