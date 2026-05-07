import { Router, type IRouter, type Request, type Response } from "express";
import PDFDocument from "pdfkit";
import { getAiClient, getAiModel, getAiMode, isAiAvailable } from "../lib/ai-client";
import { db } from "@workspace/db";
import { workersTable, detectionsTable } from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";

const router: IRouter = Router();

interface ReportData {
  generatedAt: Date;
  totalWorkers: number;
  totalDetections: number;
  safeCount: number;
  unsafeCount: number;
  safetyScore: number;
  topViolations: Array<{ name: string; count: number }>;
  recentUnsafe: Array<{
    workerId: number;
    violations: string[];
    confidence: number;
    timestamp: Date;
  }>;
  aiSummary: string;
  aiIncidents: string;
  aiRecommendations: string;
}

async function gatherData() {
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
    .limit(20);

  const violationRows = await db
    .select({ violations: detectionsTable.violations })
    .from(detectionsTable)
    .where(eq(detectionsTable.status, "unsafe"))
    .limit(200);

  const violationFreq: Record<string, number> = {};
  for (const row of violationRows) {
    for (const v of (row.violations as string[]) ?? []) {
      violationFreq[v] = (violationFreq[v] ?? 0) + 1;
    }
  }
  const topViolations = Object.entries(violationFreq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));

  return {
    totalWorkers: Number(workerCount?.count ?? 0),
    totalDetections: total,
    safeCount: safe,
    unsafeCount: unsafe,
    safetyScore,
    topViolations,
    recentUnsafe: recentUnsafe.map((r) => ({
      workerId: r.workerId,
      violations: (r.violations as string[]) ?? [],
      confidence: r.confidence,
      timestamp: r.timestamp,
    })),
  };
}

async function generateAiSections(data: Awaited<ReturnType<typeof gatherData>>) {
  const ctx = `
Worker Safety System Report Data:
- Total tracked workers: ${data.totalWorkers}
- Total detection events: ${data.totalDetections}
- Safe detections: ${data.safeCount} (${data.safetyScore}%)
- Unsafe detections: ${data.unsafeCount}
- Top violations: ${data.topViolations.map((v) => `${v.name} (${v.count}x)`).join(", ") || "None"}
- Recent unsafe events: ${data.recentUnsafe.length}
`;

  const SYSTEM =
    "You are a workplace safety analyst. Write concise, professional report sections. No markdown, plain text only.";

  if (!isAiAvailable()) {
    return {
      aiSummary:
        `Safety score is ${data.safetyScore}% based on ${data.totalDetections} total detections. ` +
        `${data.unsafeCount} unsafe event(s) recorded across ${data.totalWorkers} tracked worker(s). ` +
        (data.unsafeCount > 0
          ? "Immediate review of flagged violations is recommended."
          : "No critical violations detected in the current dataset."),
      aiIncidents:
        data.recentUnsafe.length > 0
          ? `${data.recentUnsafe.length} unsafe detection(s) on record. Most recent: Worker #${data.recentUnsafe[0].workerId} — ${data.recentUnsafe[0].violations.join(", ")} at ${new Date(data.recentUnsafe[0].timestamp).toLocaleString()}.`
          : "No unsafe incidents recorded in the current dataset.",
      aiRecommendations:
        "1. Ensure all workers wear required PPE at all times.\n" +
        "2. Conduct regular safety briefings focused on posture and zone compliance.\n" +
        "3. Install additional signage at high-risk zones.\n" +
        "4. Review surveillance coverage to eliminate blind spots.\n" +
        "5. Schedule monthly safety audits and update protocols accordingly.",
    };
  }

  const client = getAiClient();
  const model = getAiModel();
  const mode = getAiMode();

  const baseParams = (prompt: string, maxTokens: number) => ({
    model,
    messages: [
      { role: "system" as const, content: SYSTEM },
      { role: "user" as const, content: prompt + "\n\n" + ctx },
    ],
    ...(mode === "ollama"
      ? { temperature: 0.4 }
      : { max_completion_tokens: maxTokens }),
  });

  const [summaryResp, incidentsResp, recsResp] = await Promise.all([
    client.chat.completions.create(
      baseParams("Write a 2-3 sentence executive safety summary for a PDF report:", 300)
    ),
    client.chat.completions.create(
      baseParams("Write a brief key incidents summary (3-5 sentences) noting the most significant safety concerns:", 400)
    ),
    client.chat.completions.create({
      ...baseParams("Provide 4-5 specific, actionable safety recommendations in numbered list format (1. 2. 3. etc):", 500),
    }),
  ]);

  return {
    aiSummary: summaryResp.choices[0]?.message?.content ?? "",
    aiIncidents: incidentsResp.choices[0]?.message?.content ?? "",
    aiRecommendations: recsResp.choices[0]?.message?.content ?? "",
  };
}

function buildPdf(data: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 60, size: "A4" });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = doc.page.width - 120;
    const DARK = "#0f172a";
    const ACCENT = "#3b82f6";
    const MUTED = "#64748b";
    const DANGER = "#ef4444";
    const SUCCESS = "#22c55e";

    // ── Header Banner ──
    doc.rect(0, 0, doc.page.width, 100).fill(DARK);
    doc.fontSize(24).fillColor("#ffffff").font("Helvetica-Bold")
      .text("WORKER SAFETY REPORT", 60, 28, { width: W });
    doc.fontSize(10).fillColor("#94a3b8").font("Helvetica")
      .text(
        `Generated: ${data.generatedAt.toLocaleString("en-US", {
          weekday: "long", year: "numeric", month: "long",
          day: "numeric", hour: "2-digit", minute: "2-digit",
        })}`,
        60, 62, { width: W }
      );
    doc.moveDown(4);

    // ── Safety Score Banner ──
    const scoreColor = data.safetyScore >= 80 ? SUCCESS : data.safetyScore >= 60 ? "#f59e0b" : DANGER;
    doc.roundedRect(60, 115, W, 60, 8).fill(scoreColor + "22");
    doc.roundedRect(60, 115, W, 60, 8).stroke(scoreColor);
    doc.fontSize(32).fillColor(scoreColor).font("Helvetica-Bold").text(`${data.safetyScore}%`, 80, 126);
    doc.fontSize(11).fillColor(DARK).font("Helvetica-Bold").text("OVERALL SAFETY SCORE", 160, 126);
    doc.fontSize(10).fillColor(MUTED).font("Helvetica")
      .text(`Based on ${data.totalDetections} detection events across ${data.totalWorkers} tracked workers`, 160, 142);
    doc.moveDown(5);

    // ── Stats Grid ──
    sectionTitle(doc, "DETECTION STATISTICS", 190);
    const stats = [
      { label: "Total Workers", value: String(data.totalWorkers), color: ACCENT },
      { label: "Total Detections", value: String(data.totalDetections), color: ACCENT },
      { label: "Safe Events", value: String(data.safeCount), color: SUCCESS },
      { label: "Unsafe Events", value: String(data.unsafeCount), color: DANGER },
    ];
    const colW = W / 4;
    stats.forEach((s, i) => {
      const x = 60 + i * colW;
      const y = 210;
      doc.roundedRect(x + 4, y, colW - 8, 64, 6).fill("#f8fafc");
      doc.roundedRect(x + 4, y, colW - 8, 64, 6).stroke("#e2e8f0");
      doc.fontSize(22).fillColor(s.color).font("Helvetica-Bold").text(s.value, x + 4, y + 12, { width: colW - 8, align: "center" });
      doc.fontSize(8).fillColor(MUTED).font("Helvetica").text(s.label.toUpperCase(), x + 4, y + 40, { width: colW - 8, align: "center" });
    });
    doc.moveDown(7);

    // ── AI Summary ──
    sectionTitle(doc, "EXECUTIVE SUMMARY", 295);
    textBlock(doc, data.aiSummary, 310);

    const y2 = doc.y + 10;
    sectionTitle(doc, "KEY INCIDENTS & OBSERVATIONS", y2);
    textBlock(doc, data.aiIncidents, y2 + 16);

    // ── Top Violations Table ──
    if (data.topViolations.length > 0) {
      const y3 = doc.y + 14;
      sectionTitle(doc, "TOP SAFETY VIOLATIONS", y3);
      let tableY = y3 + 16;
      doc.rect(60, tableY, W, 22).fill(DARK);
      doc.fontSize(9).fillColor("#ffffff").font("Helvetica-Bold");
      doc.text("VIOLATION TYPE", 72, tableY + 7, { width: W * 0.7 });
      doc.text("COUNT", 60 + W * 0.75, tableY + 7, { width: W * 0.2, align: "right" });
      tableY += 22;
      data.topViolations.forEach((v, i) => {
        const rowY = tableY + i * 24;
        doc.rect(60, rowY, W, 24).fill(i % 2 === 0 ? "#f8fafc" : "#ffffff");
        doc.rect(60, rowY, W, 24).stroke("#e2e8f0");
        const barW = Math.round((v.count / (data.topViolations[0]?.count || 1)) * (W * 0.4));
        doc.rect(72, rowY + 8, barW, 8).fill(DANGER + "44");
        doc.fontSize(9).fillColor(DARK).font("Helvetica").text(v.name, 72, rowY + 8, { width: W * 0.7 });
        doc.fontSize(9).fillColor(DANGER).font("Helvetica-Bold")
          .text(String(v.count), 60 + W * 0.75, rowY + 8, { width: W * 0.2, align: "right" });
      });
      doc.moveDown(data.topViolations.length * 1.1 + 2);
    }

    // ── Recent Unsafe Events ──
    if (data.recentUnsafe.length > 0) {
      const y4 = doc.y + 6;
      sectionTitle(doc, "RECENT UNSAFE DETECTIONS", y4);
      let evY = y4 + 16;
      doc.rect(60, evY, W, 22).fill(DARK);
      doc.fontSize(9).fillColor("#ffffff").font("Helvetica-Bold");
      doc.text("WORKER ID", 72, evY + 7, { width: W * 0.15 });
      doc.text("VIOLATIONS", 72 + W * 0.18, evY + 7, { width: W * 0.5 });
      doc.text("CONFIDENCE", 72 + W * 0.72, evY + 7, { width: W * 0.15 });
      doc.text("TIMESTAMP", 72 + W * 0.88, evY + 7, { width: W * 0.12 });
      evY += 22;
      data.recentUnsafe.slice(0, 12).forEach((ev, i) => {
        const rowY = evY + i * 24;
        doc.rect(60, rowY, W, 24).fill(i % 2 === 0 ? "#fff5f5" : "#ffffff");
        doc.rect(60, rowY, W, 24).stroke("#e2e8f0");
        doc.fontSize(8).fillColor(DARK).font("Helvetica");
        doc.text(`#${ev.workerId}`, 72, rowY + 8, { width: W * 0.15 });
        doc.text(ev.violations.join(", "), 72 + W * 0.18, rowY + 8, { width: W * 0.5, ellipsis: true });
        doc.fillColor(ev.confidence >= 0.7 ? DANGER : "#f59e0b").font("Helvetica-Bold")
          .text(`${Math.round(ev.confidence * 100)}%`, 72 + W * 0.72, rowY + 8, { width: W * 0.15 });
        doc.fillColor(MUTED).font("Helvetica").fontSize(7)
          .text(
            new Date(ev.timestamp).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
            72 + W * 0.88, rowY + 8, { width: W * 0.12 }
          );
      });
      doc.moveDown(Math.min(data.recentUnsafe.length, 12) * 1.1 + 2);
    }

    // ── AI Recommendations ──
    if (doc.y > doc.page.height - 200) doc.addPage();
    const y5 = doc.y + 6;
    sectionTitle(doc, "AI-GENERATED RECOMMENDATIONS", y5);
    doc.roundedRect(60, y5 + 16, W, 200, 8).fill(ACCENT + "11");
    doc.roundedRect(60, y5 + 16, W, 200, 8).stroke(ACCENT + "55");
    doc.fontSize(9).fillColor(DARK).font("Helvetica")
      .text(data.aiRecommendations, 76, y5 + 26, { width: W - 32, lineGap: 3 });
    doc.moveDown(12);

    // ── Footer ──
    doc.rect(0, doc.page.height - 40, doc.page.width, 40).fill(DARK);
    doc.fontSize(8).fillColor("#94a3b8").font("Helvetica")
      .text(
        "WORKER SAFETY MONITORING SYSTEM  //  CONFIDENTIAL  //  AI-ASSISTED ANALYSIS",
        60, doc.page.height - 26, { width: W, align: "center" }
      );

    doc.end();
  });
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string, y: number) {
  doc.fontSize(9).fillColor("#3b82f6").font("Helvetica-Bold").text(title, 60, y, { characterSpacing: 1.2 });
  doc.moveTo(60, y + 12).lineTo(doc.page.width - 60, y + 12).strokeColor("#e2e8f0").lineWidth(1).stroke();
}

function textBlock(doc: PDFKit.PDFDocument, text: string, y: number) {
  const W = doc.page.width - 120;
  doc.fontSize(10).fillColor("#1e293b").font("Helvetica").text(text, 60, y + 4, { width: W, lineGap: 3 });
  doc.moveDown(1);
}

// GET /api/report — generates and streams PDF
router.get("/report", async (req: Request, res: Response): Promise<void> => {
  try {
    const raw = await gatherData();
    const ai = await generateAiSections(raw);

    const reportData: ReportData = {
      generatedAt: new Date(),
      ...raw,
      ...ai,
    };

    const pdfBuffer = await buildPdf(reportData);
    const filename = `worker-safety-report-${new Date().toISOString().slice(0, 10)}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    req.log.error({ err }, "Report generation failed");
    res.status(502).json({ error: "Report generation failed. Please try again." });
  }
});

// GET /api/report/preview — JSON summary for frontend
router.get("/report/preview", async (req: Request, res: Response): Promise<void> => {
  try {
    const raw = await gatherData();
    res.json({ ok: true, data: raw });
  } catch (err) {
    req.log.error({ err }, "Report preview failed");
    res.status(500).json({ error: "Failed to load report preview." });
  }
});

export default router;
