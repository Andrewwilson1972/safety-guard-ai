import { Router, type IRouter } from "express";
import { getAiClient, getAiModel, getAiMode, isAiAvailable } from "../lib/ai-client";
import { db } from "@workspace/db";
import { workersTable, detectionsTable } from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";

const router: IRouter = Router();

async function buildSystemContext(): Promise<string> {
  const [workerCount] = await db.select({ count: count() }).from(workersTable);
  const [totalDet] = await db.select({ count: count() }).from(detectionsTable);
  const [safeDet] = await db
    .select({ count: count() })
    .from(detectionsTable)
    .where(eq(detectionsTable.status, "safe"));
  const [unsafeDet] = await db
    .select({ count: count() })
    .from(detectionsTable)
    .where(eq(detectionsTable.status, "unsafe"));

  const total = Number(totalDet?.count ?? 0);
  const safe = Number(safeDet?.count ?? 0);
  const unsafe = Number(unsafeDet?.count ?? 0);
  const safetyScore = total > 0 ? Math.round((safe / total) * 100) : 100;

  const recentUnsafe = await db
    .select({
      workerId: detectionsTable.workerId,
      violations: detectionsTable.violations,
      confidence: detectionsTable.confidence,
      timestamp: detectionsTable.timestamp,
    })
    .from(detectionsTable)
    .where(eq(detectionsTable.status, "unsafe"))
    .orderBy(desc(detectionsTable.timestamp))
    .limit(10);

  const violationRows = await db
    .select({ violations: detectionsTable.violations })
    .from(detectionsTable)
    .where(eq(detectionsTable.status, "unsafe"))
    .limit(100);

  const violationFreq: Record<string, number> = {};
  for (const row of violationRows) {
    for (const v of (row.violations as string[]) ?? []) {
      violationFreq[v] = (violationFreq[v] ?? 0) + 1;
    }
  }
  const topViolations = Object.entries(violationFreq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name, cnt]) => `  - ${name}: ${cnt} occurrences`)
    .join("\n");

  const recentUnsafeText = recentUnsafe
    .map(
      (d) =>
        `  - Worker ${d.workerId}: ${(d.violations as string[]).join(", ")} (confidence ${Math.round(d.confidence * 100)}%) at ${new Date(d.timestamp).toLocaleString()}`
    )
    .join("\n");

  return `You are an AI safety assistant for a Worker Surveillance and Safety Monitoring system.
You have access to real-time worker detection data from computer vision AI (YOLOv8 + MediaPipe).

CURRENT SYSTEM DATA:
- Total tracked workers: ${Number(workerCount?.count ?? 0)}
- Total detection events: ${total}
- Safe detections: ${safe}
- Unsafe detections: ${unsafe}
- Overall safety score: ${safetyScore}%

TOP SAFETY VIOLATIONS:
${topViolations || "  - No violations recorded yet"}

RECENT UNSAFE DETECTIONS:
${recentUnsafeText || "  - No unsafe detections recorded yet"}

INSTRUCTIONS:
- Answer questions clearly and concisely based on the real data above
- Provide specific numbers when asked
- Give actionable safety recommendations when relevant
- If asked something outside worker safety, politely redirect to safety topics
- Use a professional but approachable tone
- Keep responses focused and under 300 words unless a detailed breakdown is requested`;
}

// GET /api/ai-mode — returns current AI backend info
router.get("/ai-mode", (_req, res): void => {
  if (!isAiAvailable()) {
    res.json({ available: false, mode: null, model: null });
    return;
  }
  res.json({ available: true, mode: getAiMode(), model: getAiModel() });
});

// POST /api/chat — streaming SSE
router.post("/chat", async (req, res): Promise<void> => {
  const { message } = req.body as { message?: string };

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    res.status(400).json({ error: "message field is required and must be a non-empty string" });
    return;
  }

  if (!isAiAvailable()) {
    res.status(503).json({
      error:
        "No AI backend configured. Set OLLAMA_BASE_URL=http://localhost:11434 for offline mode.",
    });
    return;
  }

  try {
    const systemContext = await buildSystemContext();
    const client = getAiClient();
    const model = getAiModel();

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const completionParams: any = {
      model,
      stream: true,
      messages: [
        { role: "system", content: systemContext },
        { role: "user", content: message.trim() },
      ],
    };

    // gpt-5+ doesn't support temperature; Ollama/llama3 does
    if (getAiMode() === "ollama") {
      completionParams.temperature = 0.7;
    } else {
      completionParams.max_completion_tokens = 8192;
    }

    const stream = await client.chat.completions.create(completionParams);

    for await (const chunk of stream) {
      const content = (chunk as any).choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    req.log.error({ err }, "Chat completion failed");
    if (!res.headersSent) {
      res.status(502).json({ error: "AI service error. Please try again." });
    } else {
      res.write(`data: ${JSON.stringify({ error: "AI service error. Please try again." })}\n\n`);
      res.end();
    }
  }
});

export default router;
