import { Router, type IRouter } from "express";
import {
  GetDashboardStatsResponse,
  GetRecentAlertsResponse,
  GetWorkerActivityResponse,
  GetViolationBreakdownResponse,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import { workersTable, detectionsTable } from "@workspace/db";
import { eq, desc, count, sql } from "drizzle-orm";

const router: IRouter = Router();

// Severity derived from confidence score
function severityFromConfidence(confidence: number): "low" | "medium" | "high" | "critical" {
  if (confidence >= 0.9) return "critical";
  if (confidence >= 0.75) return "high";
  if (confidence >= 0.55) return "medium";
  return "low";
}

// Colors for violation categories
const VIOLATION_COLORS: Record<string, string> = {
  "Unsafe Posture Detected": "#EF4444",
  "No Hard Hat": "#F97316",
  "No Safety Vest": "#EAB308",
  "Restricted Area": "#3B82F6",
  "No Gloves": "#8B5CF6",
  "No Goggles": "#06B6D4",
  "Slip/Trip Hazard": "#EC4899",
};
const FALLBACK_COLORS = ["#EF4444", "#F97316", "#EAB308", "#3B82F6", "#8B5CF6", "#06B6D4", "#EC4899"];

router.get("/dashboard/stats", async (req, res): Promise<void> => {
  try {
    const [workerCount] = await db.select({ count: count() }).from(workersTable);
    const [totalDet] = await db.select({ count: count() }).from(detectionsTable);
    const [unsafeDet] = await db
      .select({ count: count() })
      .from(detectionsTable)
      .where(eq(detectionsTable.status, "unsafe"));
    const [safeDet] = await db
      .select({ count: count() })
      .from(detectionsTable)
      .where(eq(detectionsTable.status, "safe"));

    const total = Number(totalDet?.count ?? 0);
    const safe = Number(safeDet?.count ?? 0);
    const unsafe = Number(unsafeDet?.count ?? 0);
    const safetyScore = total > 0 ? Math.round((safe / total) * 100) : 100;

    const stats = GetDashboardStatsResponse.parse({
      totalWorkers: Number(workerCount?.count ?? 0),
      activeWorkers: Number(workerCount?.count ?? 0),
      totalViolations: unsafe,
      activeAlerts: unsafe,
      safetyScore,
      camerasOnline: 4,
    });
    res.json(stats);
  } catch (err) {
    req.log.error({ err }, "dashboard/stats failed");
    res.status(500).json({ error: "Failed to load stats" });
  }
});

router.get("/dashboard/recent-alerts", async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select({
        id: detectionsTable.id,
        workerId: detectionsTable.workerId,
        violations: detectionsTable.violations,
        confidence: detectionsTable.confidence,
        timestamp: detectionsTable.timestamp,
        workerName: workersTable.name,
      })
      .from(detectionsTable)
      .leftJoin(workersTable, eq(detectionsTable.workerId, workersTable.id))
      .where(eq(detectionsTable.status, "unsafe"))
      .orderBy(desc(detectionsTable.timestamp))
      .limit(30);

    const alerts = GetRecentAlertsResponse.parse(
      rows.map((row) => {
        const violations = (row.violations as string[]) ?? [];
        const primaryViolation = violations[0] ?? "Safety Violation";
        const workerLabel = row.workerName ?? `Worker #${row.workerId}`;
        const extraViolations = violations.length > 1 ? ` and ${violations.length - 1} more` : "";
        return {
          id: row.id,
          type: primaryViolation,
          severity: severityFromConfidence(row.confidence),
          message: `${workerLabel} — ${primaryViolation}${extraViolations} detected`,
          workerId: row.workerId,
          zone: "Active Worksite",
          timestamp: row.timestamp,
          resolved: false,
        };
      })
    );
    res.json(alerts);
  } catch (err) {
    req.log.error({ err }, "dashboard/recent-alerts failed");
    res.status(500).json({ error: "Failed to load alerts" });
  }
});

router.get("/dashboard/worker-activity", async (_req, res): Promise<void> => {
  // Generate last 12 hours of activity windows anchored to current time
  const now = new Date();
  const hours = Array.from({ length: 12 }, (_, i) => {
    const h = new Date(now.getTime() - (11 - i) * 3600000);
    return `${String(h.getHours()).padStart(2, "0")}:00`;
  });
  const activity = GetWorkerActivityResponse.parse(
    hours.map((hour, i) => ({
      hour,
      workers: [8, 18, 34, 42, 44, 45, 30, 38, 43, 44, 40, 28][i],
      violations: [0, 1, 2, 3, 2, 1, 0, 2, 3, 1, 0, 1][i],
    }))
  );
  res.json(activity);
});

router.get("/dashboard/violation-breakdown", async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select({ violations: detectionsTable.violations })
      .from(detectionsTable)
      .where(eq(detectionsTable.status, "unsafe"));

    const freq: Record<string, number> = {};
    for (const row of rows) {
      for (const v of (row.violations as string[]) ?? []) {
        freq[v] = (freq[v] ?? 0) + 1;
      }
    }

    const sorted = Object.entries(freq)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8);

    if (sorted.length === 0) {
      res.json([]);
      return;
    }

    const breakdown = GetViolationBreakdownResponse.parse(
      sorted.map(([name, cnt], i) => ({
        category: name,
        count: cnt,
        color: VIOLATION_COLORS[name] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
      }))
    );
    res.json(breakdown);
  } catch (err) {
    req.log.error({ err }, "dashboard/violation-breakdown failed");
    res.status(500).json({ error: "Failed to load violation breakdown" });
  }
});

export default router;
