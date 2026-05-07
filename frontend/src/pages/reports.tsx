import { Shell } from "@/components/layout/shell";
import { useState, useEffect } from "react";
import {
  FileText,
  Download,
  RefreshCw,
  Shield,
  AlertTriangle,
  Users,
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface PreviewData {
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
    timestamp: string;
  }>;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function Reports() {
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastGenerated, setLastGenerated] = useState<Date | null>(null);

  async function loadPreview() {
    setLoadingPreview(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/report/preview`);
      const json = await res.json();
      if (json.ok) setPreview(json.data);
      else setError("Failed to load preview data.");
    } catch {
      setError("Could not connect to the server.");
    } finally {
      setLoadingPreview(false);
    }
  }

  useEffect(() => {
    loadPreview();
  }, []);

  async function generateReport() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/report`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as any).error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `worker-safety-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setLastGenerated(new Date());
    } catch (err: any) {
      setError(err.message ?? "Report generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  const safetyColor =
    preview && preview.safetyScore >= 80
      ? "text-green-400"
      : preview && preview.safetyScore >= 60
        ? "text-yellow-400"
        : "text-red-400";

  const safeBg =
    preview && preview.safetyScore >= 80
      ? "bg-green-500/10 border-green-500/30"
      : preview && preview.safetyScore >= 60
        ? "bg-yellow-500/10 border-yellow-500/30"
        : "bg-red-500/10 border-red-500/30";

  return (
    <Shell>
      <div className="flex flex-col gap-6 pb-8">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              <FileText className="w-8 h-8 text-primary" />
              Safety Reports
            </h1>
            <p className="text-muted-foreground font-mono text-sm mt-1">
              AI-GENERATED PDF // LIVE DATA
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadPreview}
              disabled={loadingPreview}
            >
              <RefreshCw
                className={`w-4 h-4 mr-2 ${loadingPreview ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={generateReport}
              disabled={generating || loadingPreview}
              className="min-w-[170px]"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating Report...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  Download PDF Report
                </>
              )}
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 font-mono">
            {error}
          </div>
        )}

        {lastGenerated && (
          <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400 font-mono flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Report downloaded at{" "}
            {lastGenerated.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
            . Check your downloads folder.
          </div>
        )}

        {/* Description */}
        <div className="rounded-xl border border-border/50 bg-card/50 p-5 backdrop-blur">
          <div className="flex gap-4">
            <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold mb-1">AI-Powered PDF Report</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Click "Download PDF Report" to generate a professional worker
                safety report. The AI will analyze all detection data and
                produce an executive summary, incident review, violation
                analysis, and actionable recommendations — all formatted into a
                downloadable PDF document.
              </p>
              <p className="text-xs text-muted-foreground/70 font-mono mt-2">
                Generation typically takes 10-20 seconds while the AI composes
                the report sections.
              </p>
            </div>
          </div>
        </div>

        {/* Stats Preview */}
        {loadingPreview ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="h-24 rounded-xl bg-card/30 border border-border/30 animate-pulse"
              />
            ))}
          </div>
        ) : preview ? (
          <>
            {/* Safety Score */}
            <div className={`rounded-xl border p-5 flex items-center gap-5 ${safeBg}`}>
              <div className={`text-5xl font-bold font-mono ${safetyColor}`}>
                {preview.safetyScore}%
              </div>
              <div>
                <p className="font-semibold text-lg">Overall Safety Score</p>
                <p className="text-sm text-muted-foreground">
                  {preview.safeCount} safe / {preview.unsafeCount} unsafe out
                  of {preview.totalDetections} total detections
                </p>
              </div>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                icon={<Users className="w-5 h-5 text-blue-400" />}
                label="Tracked Workers"
                value={preview.totalWorkers}
                bg="bg-blue-500/10 border-blue-500/20"
              />
              <StatCard
                icon={<Activity className="w-5 h-5 text-purple-400" />}
                label="Total Detections"
                value={preview.totalDetections}
                bg="bg-purple-500/10 border-purple-500/20"
              />
              <StatCard
                icon={<CheckCircle2 className="w-5 h-5 text-green-400" />}
                label="Safe Events"
                value={preview.safeCount}
                bg="bg-green-500/10 border-green-500/20"
              />
              <StatCard
                icon={<XCircle className="w-5 h-5 text-red-400" />}
                label="Unsafe Events"
                value={preview.unsafeCount}
                bg="bg-red-500/10 border-red-500/20"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Top violations */}
              {preview.topViolations.length > 0 && (
                <div className="rounded-xl border border-border/50 bg-card/50 p-5">
                  <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-400" />
                    Top Violations
                  </h3>
                  <div className="space-y-3">
                    {preview.topViolations.slice(0, 6).map((v) => {
                      const maxCount = preview.topViolations[0]?.count ?? 1;
                      const pct = Math.round((v.count / maxCount) * 100);
                      return (
                        <div key={v.name}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-card-foreground">
                              {v.name}
                            </span>
                            <span className="text-red-400 font-mono font-bold">
                              {v.count}
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted">
                            <div
                              className="h-1.5 rounded-full bg-red-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Recent unsafe */}
              {preview.recentUnsafe.length > 0 && (
                <div className="rounded-xl border border-border/50 bg-card/50 p-5">
                  <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-red-400" />
                    Recent Unsafe Detections
                  </h3>
                  <div className="space-y-2">
                    {preview.recentUnsafe.slice(0, 6).map((ev, i) => (
                      <div
                        key={i}
                        className="flex items-start justify-between text-xs border-b border-border/30 pb-2 last:border-0"
                      >
                        <div>
                          <span className="text-muted-foreground font-mono">
                            Worker #{ev.workerId}
                          </span>
                          <p className="text-card-foreground mt-0.5 line-clamp-1">
                            {ev.violations.join(", ")}
                          </p>
                        </div>
                        <div className="text-right shrink-0 ml-4">
                          <span className="text-red-400 font-mono font-bold">
                            {Math.round(ev.confidence * 100)}%
                          </span>
                          <p className="text-muted-foreground/60 mt-0.5">
                            {new Date(ev.timestamp).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {preview.topViolations.length === 0 &&
                preview.recentUnsafe.length === 0 && (
                  <div className="md:col-span-2 rounded-xl border border-green-500/20 bg-green-500/5 p-6 text-center">
                    <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-3" />
                    <p className="font-semibold text-green-400">
                      No safety violations recorded
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Upload video frames in the Video Feed page to generate
                      detection data.
                    </p>
                  </div>
                )}
            </div>
          </>
        ) : null}

        {/* Report contents description */}
        <div className="rounded-xl border border-border/50 bg-card/30 p-5">
          <h3 className="font-semibold text-sm mb-4">
            Report Contents
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            {[
              {
                title: "Executive Summary",
                desc: "AI-generated overview of the current safety status and overall risk level",
              },
              {
                title: "Detection Statistics",
                desc: "Safe vs unsafe event counts, safety score, worker tracking summary",
              },
              {
                title: "Violation Analysis",
                desc: "Top violation types ranked by frequency with visual severity bars",
              },
              {
                title: "Incident Timeline",
                desc: "Recent unsafe detection events with timestamps and confidence scores",
              },
              {
                title: "Key Observations",
                desc: "AI-identified patterns and notable safety incidents from the data",
              },
              {
                title: "Recommendations",
                desc: "Actionable AI-generated safety improvements tailored to detected violations",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="flex gap-3"
              >
                <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">{item.title}</p>
                  <p className="text-muted-foreground text-xs mt-0.5">
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}

function StatCard({
  icon,
  label,
  value,
  bg,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  bg: string;
}) {
  return (
    <div className={`rounded-xl border p-4 ${bg}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-muted-foreground font-mono uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p className="text-3xl font-bold font-mono">{value}</p>
    </div>
  );
}
