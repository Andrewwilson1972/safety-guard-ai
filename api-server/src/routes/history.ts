import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { workersTable, detectionsTable } from "@workspace/db";
import { sql, eq, desc, and, gte, lte, ilike } from "drizzle-orm";

const router: IRouter = Router();

// GET /api/history
// Query params: page, limit, workerId, status, dateFrom, dateTo
router.get("/history", async (req, res): Promise<void> => {
  try {
    const page   = Math.max(1, parseInt(String(req.query.page   ?? "1"),  10));
    const limit  = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)));
    const offset = (page - 1) * limit;

    const filters: ReturnType<typeof eq>[] = [];

    if (req.query.workerId) {
      const wid = parseInt(String(req.query.workerId), 10);
      if (!isNaN(wid)) filters.push(eq(detectionsTable.workerId, wid));
    }
    if (req.query.status === "safe" || req.query.status === "unsafe") {
      filters.push(eq(detectionsTable.status, req.query.status));
    }
    if (req.query.dateFrom) {
      filters.push(gte(detectionsTable.timestamp, new Date(String(req.query.dateFrom))));
    }
    if (req.query.dateTo) {
      filters.push(lte(detectionsTable.timestamp, new Date(String(req.query.dateTo))));
    }

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          id:         detectionsTable.id,
          workerId:   detectionsTable.workerId,
          workerName: workersTable.name,
          trackId:    workersTable.trackId,
          uploadId:   detectionsTable.uploadId,
          status:     detectionsTable.status,
          violations: detectionsTable.violations,
          confidence: detectionsTable.confidence,
          bbox:       detectionsTable.bbox,
          timestamp:  detectionsTable.timestamp,
        })
        .from(detectionsTable)
        .leftJoin(workersTable, eq(detectionsTable.workerId, workersTable.id))
        .where(whereClause)
        .orderBy(desc(detectionsTable.timestamp))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`COUNT(*)` })
        .from(detectionsTable)
        .where(whereClause),
    ]);

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch detection history" });
  }
});

export default router;
