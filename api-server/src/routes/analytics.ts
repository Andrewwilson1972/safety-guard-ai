import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { workersTable, detectionsTable } from "@workspace/db";
import { sql, eq, desc, count, and, gte } from "drizzle-orm";

const router: IRouter = Router();

// GET /api/analytics/summary
router.get("/analytics/summary", async (_req, res): Promise<void> => {
  try {
    const [workerCount] = await db
      .select({ count: count() })
      .from(workersTable);

    const [detectionCount] = await db
      .select({ count: count() })
      .from(detectionsTable);

    const [safeCount] = await db
      .select({ count: count() })
      .from(detectionsTable)
      .where(eq(detectionsTable.status, "safe"));

    const [unsafeCount] = await db
      .select({ count: count() })
      .from(detectionsTable)
      .where(eq(detectionsTable.status, "unsafe"));

    const total = Number(detectionCount?.count ?? 0);
    const safe = Number(safeCount?.count ?? 0);
    const unsafe = Number(unsafeCount?.count ?? 0);
    const safetyScore = total > 0 ? Math.round((safe / total) * 100) : 100;

    res.json({
      totalWorkers: Number(workerCount?.count ?? 0),
      totalDetections: total,
      safeDetections: safe,
      unsafeDetections: unsafe,
      safetyScore,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch analytics summary" });
  }
});

// GET /api/analytics/trends
router.get("/analytics/trends", async (_req, res): Promise<void> => {
  try {
    const rows = await db
      .select({
        day: sql<string>`DATE(${detectionsTable.timestamp})`,
        total: count(),
        unsafe: sql<number>`SUM(CASE WHEN ${detectionsTable.status} = 'unsafe' THEN 1 ELSE 0 END)`,
        violations: sql<number>`SUM(jsonb_array_length(${detectionsTable.violations}))`,
      })
      .from(detectionsTable)
      .where(gte(detectionsTable.timestamp, sql`NOW() - INTERVAL '30 days'`))
      .groupBy(sql`DATE(${detectionsTable.timestamp})`)
      .orderBy(sql`DATE(${detectionsTable.timestamp})`);

    res.json(
      rows.map((r) => ({
        day: r.day,
        total: Number(r.total),
        unsafe: Number(r.unsafe ?? 0),
        violations: Number(r.violations ?? 0),
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch analytics trends" });
  }
});

// GET /api/analytics/worker/:id
router.get("/analytics/worker/:id", async (req, res): Promise<void> => {
  const workerId = parseInt(req.params.id, 10);
  if (isNaN(workerId)) {
    res.status(400).json({ error: "Invalid worker id" });
    return;
  }

  try {
    const [worker] = await db
      .select()
      .from(workersTable)
      .where(eq(workersTable.id, workerId));

    if (!worker) {
      res.status(404).json({ error: "Worker not found" });
      return;
    }

    const detections = await db
      .select()
      .from(detectionsTable)
      .where(eq(detectionsTable.workerId, workerId))
      .orderBy(desc(detectionsTable.timestamp))
      .limit(50);

    const safeCount = detections.filter((d) => d.status === "safe").length;
    const unsafeCount = detections.filter((d) => d.status === "unsafe").length;
    const allViolations = detections.flatMap((d) => (d.violations as string[]) ?? []);
    const violationFreq: Record<string, number> = {};
    for (const v of allViolations) {
      violationFreq[v] = (violationFreq[v] ?? 0) + 1;
    }

    res.json({
      worker,
      stats: {
        totalDetections: detections.length,
        safeDetections: safeCount,
        unsafeDetections: unsafeCount,
        safetyScore:
          detections.length > 0
            ? Math.round((safeCount / detections.length) * 100)
            : 100,
        topViolations: Object.entries(violationFreq)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([name, count]) => ({ name, count })),
      },
      recentDetections: detections.slice(0, 10),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch worker analytics" });
  }
});

export default router;
