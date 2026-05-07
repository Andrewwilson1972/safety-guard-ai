import { Router, type IRouter } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger";
import { db } from "@workspace/db";
import { workersTable, detectionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? "http://localhost:8000";

interface DetectedWorker {
  id: number;
  bbox: number[];
  status: "safe" | "unsafe";
  confidence: number;
  violations: string[];
}

interface DetectionResponse {
  workers: DetectedWorker[];
  summary: {
    total_workers: number;
    safe_workers: number;
    unsafe_workers: number;
    violations_detected: number;
  };
  file_name?: string;
  file_size_kb: number;
  content_type: string;
  model: string;
  note: string;
}

async function persistDetections(
  workers: DetectedWorker[],
  uploadId: string
): Promise<void> {
  for (const w of workers) {
    // Upsert worker by track_id
    let worker = await db.query.workersTable.findFirst({
      where: eq(workersTable.trackId, w.id),
    });

    if (!worker) {
      const [created] = await db
        .insert(workersTable)
        .values({ trackId: w.id, name: `Worker-${w.id}` })
        .returning();
      worker = created;
    }

    if (!worker) continue;

    await db.insert(detectionsTable).values({
      workerId: worker.id,
      uploadId,
      status: w.status,
      violations: w.violations,
      confidence: w.confidence,
      bbox: w.bbox,
    });
  }
}

router.post(
  "/detect",
  upload.single("file"),
  async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded. Send a file field named 'file'." });
      return;
    }

    req.log.info(
      { filename: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype },
      "Forwarding file to AI service"
    );

    try {
      const nativeForm = new FormData();
      const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
      nativeForm.append("file", blob, req.file.originalname || "upload");

      const response = await fetch(`${AI_SERVICE_URL}/detect`, {
        method: "POST",
        body: nativeForm,
      });

      if (!response.ok) {
        const text = await response.text();
        req.log.warn({ status: response.status, body: text }, "AI service returned non-OK status");
        res.status(502).json({
          error: `AI service error: ${response.status} ${response.statusText}`,
        });
        return;
      }

      const data: DetectionResponse = await response.json();

      // Persist to database (fire-and-forget style, don't block response)
      if (data.workers?.length > 0) {
        const uploadId = randomUUID();
        persistDetections(data.workers, uploadId).catch((err) => {
          logger.error({ err }, "Failed to persist detections");
        });
      }

      res.json(data);
    } catch (err) {
      req.log.error({ err }, "Failed to reach AI service");
      res.status(502).json({
        error: "AI service is unavailable. Make sure it is running on port 8000.",
      });
    }
  }
);

export default router;
