import { Shell } from "@/components/layout/shell";
import { Card, CardContent } from "@/components/ui/card";
import {
  Upload, MonitorPlay, CheckCircle, AlertTriangle, X, Loader2,
  Play, Square, Wifi, WifiOff, Radio, Camera, FileVideo, RefreshCw,
  Activity,
} from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const MAX_RETRIES = 6;
const RETRY_INTERVAL_MS = 3000;

// ── types ─────────────────────────────────────────────────────────────────────

interface StreamStatus {
  running: boolean;
  source:  string;
  fps:     number;
  workers: Worker[];
}

interface Worker {
  id:         number;
  bbox:       number[];
  status:     "safe" | "unsafe";
  confidence: number;
  violations: string[];
}

interface LiveAlert {
  worker_id:  number;
  severity:   "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  violations: string[];
  confidence: number;
  timestamp:  string;
}

interface LiveDetection {
  id:         number;
  name:       string;
  status:     "safe" | "unsafe" | "unknown";
  violation:  string;
  violations: string[];
  confidence: number;
  bbox:       number[];
}

interface DetectionsSnapshot {
  running: boolean;
  fps:     number;
  source:  string;
  workers: LiveDetection[];
  summary: { total: number; safe: number; unsafe: number };
}

interface UploadResult {
  workers: Worker[];
  summary: {
    total_workers: number; safe_workers: number;
    unsafe_workers: number; violations_detected: number;
  };
  model: string;
}

const SEV_STYLE: Record<string, string> = {
  CRITICAL: "text-red-400    border-red-500/50    bg-red-500/10",
  HIGH:     "text-orange-400 border-orange-500/50 bg-orange-500/10",
  MEDIUM:   "text-yellow-400 border-yellow-500/50 bg-yellow-500/10",
  LOW:      "text-blue-400   border-blue-500/50   bg-blue-500/10",
};

// ── component ─────────────────────────────────────────────────────────────────

export default function VideoFeed() {
  // stream viewer
  const imgRef = useRef<HTMLImageElement>(null);
  const [streamOk,       setStreamOk]       = useState(false);
  const [streamLoading,  setStreamLoading]  = useState(true);
  const [retryCount,     setRetryCount]     = useState(0);
  const [retryCountdown, setRetryCountdown] = useState(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cdTimerRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  // status polling
  const [streamStatus, setStreamStatus] = useState<StreamStatus | null>(null);

  // controls
  const [streamLoading2, setStreamLoading2] = useState(false);
  const [isUploading,    setIsUploading]    = useState(false);
  const streamFileRef = useRef<HTMLInputElement>(null);

  // alert feed (SSE)
  const [alerts, setAlerts]   = useState<LiveAlert[]>([]);
  const esRef = useRef<EventSource | null>(null);

  // live detections panel (1-second poll)
  const [detections,     setDetections]     = useState<DetectionsSnapshot | null>(null);
  const [detUpdatedAt,   setDetUpdatedAt]   = useState<Date | null>(null);

  // frame analysis
  const [isDragging,    setIsDragging]    = useState(false);
  const [isAnalyzing,   setIsAnalyzing]   = useState(false);
  const [uploadResult,  setUploadResult]  = useState<UploadResult | null>(null);
  const [uploadError,   setUploadError]   = useState<string | null>(null);
  const [selectedFile,  setSelectedFile]  = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── helpers ───────────────────────────────────────────────────────────────

  const streamSrc = useCallback((ts?: number) =>
    `${BASE}/api/stream${ts ? `?t=${ts}` : ""}`, []);

  function clearRetryTimers() {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    if (cdTimerRef.current)    clearInterval(cdTimerRef.current);
  }

  function startStream(src: string) {
    clearRetryTimers();
    setStreamLoading(true);
    setStreamOk(false);
    setRetryCount(0);
    setRetryCountdown(0);
    if (imgRef.current) imgRef.current.src = streamSrc(Date.now());
    logger.info(`Stream source refreshed: ${src}`);
  }

  const logger = { info: console.info }; // lightweight

  // ── auto-reconnect on stream error ───────────────────────────────────────

  function handleStreamError() {
    setStreamOk(false);
    setStreamLoading(false);
    if (retryCount >= MAX_RETRIES) return;

    let cd = Math.ceil(RETRY_INTERVAL_MS / 1000);
    setRetryCountdown(cd);

    clearRetryTimers();
    cdTimerRef.current = setInterval(() => {
      cd -= 1;
      setRetryCountdown(cd);
      if (cd <= 0 && cdTimerRef.current) clearInterval(cdTimerRef.current);
    }, 1000);

    retryTimerRef.current = setTimeout(() => {
      setRetryCount((r) => r + 1);
      setStreamLoading(true);
      if (imgRef.current) imgRef.current.src = streamSrc(Date.now());
    }, RETRY_INTERVAL_MS);
  }

  function handleStreamLoad() {
    setStreamOk(true);
    setStreamLoading(false);
    setRetryCount(0);
    setRetryCountdown(0);
    clearRetryTimers();
  }

  function manualRetry() {
    clearRetryTimers();
    setRetryCount(0);
    setRetryCountdown(0);
    setStreamLoading(true);
    if (imgRef.current) imgRef.current.src = streamSrc(Date.now());
  }

  // ── status polling (2s — for stat cards + FPS badge) ─────────────────────

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/stream/status`);
      if (r.ok) setStreamStatus(await r.json());
    } catch { /* AI service briefly down */ }
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 2000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  // ── live detections poll (1s — CCTV panel) ───────────────────────────────

  const fetchDetections = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/stream/detections`);
      if (r.ok) {
        setDetections(await r.json());
        setDetUpdatedAt(new Date());
      }
    } catch { /* service briefly down */ }
  }, []);

  useEffect(() => {
    fetchDetections();
    const id = setInterval(fetchDetections, 1000);
    return () => clearInterval(id);
  }, [fetchDetections]);

  // ── SSE alert feed ────────────────────────────────────────────────────────

  useEffect(() => {
    function connect() {
      const es = new EventSource(`${BASE}/api/stream/alerts`);
      esRef.current = es;
      es.onmessage = (e) => {
        try {
          const a: LiveAlert = JSON.parse(e.data);
          setAlerts((prev) => [a, ...prev].slice(0, 30));
        } catch { /* bad JSON */ }
      };
      es.onerror = () => {
        es.close();
        setTimeout(connect, 5000); // reconnect SSE after 5s
      };
    }
    connect();
    return () => esRef.current?.close();
  }, []);

  // ── cleanup ───────────────────────────────────────────────────────────────

  useEffect(() => () => clearRetryTimers(), []);

  // ── stream controls ───────────────────────────────────────────────────────

  async function ctrlStart(source: string) {
    setStreamLoading2(true);
    try {
      await fetch(`${BASE}/api/stream/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      startStream(source);
      await fetchStatus();
    } finally { setStreamLoading2(false); }
  }

  async function ctrlStop() {
    await fetch(`${BASE}/api/stream/stop`, { method: "POST" });
    await fetchStatus();
  }

  async function uploadForStream(file: File) {
    setIsUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await fetch(`${BASE}/api/stream/upload`, { method: "POST", body: fd });
      if (!r.ok) throw new Error(`Upload failed: ${r.status}`);

      // Poll status endpoint until the new source is confirmed running.
      // Preloaded first frame is already buffered in Python, so stream never blanks.
      const expectedFile = file.name;
      let ready = false;
      for (let i = 0; i < 20; i++) {          // poll up to 2s (20 × 100ms)
        await new Promise<void>((res) => setTimeout(res, 100));
        try {
          const s = await fetch(`${BASE}/api/stream/status`);
          if (s.ok) {
            const json = await s.json();
            if (json.running && String(json.source).includes(expectedFile)) {
              ready = true;
              break;
            }
          }
        } catch { /* keep polling */ }
      }

      // Refresh <img> src with cache buster — NO BLANK (preloaded frame prevents flicker)
      clearRetryTimers();
      setRetryCount(0);
      setRetryCountdown(0);
      setStreamOk(false);
      setStreamLoading(true);
      if (imgRef.current) {
        imgRef.current.src = `${BASE}/api/stream?t=${Date.now()}`;
      }
      await fetchStatus();

      if (!ready) {
        setUploadError("Stream started but source confirmation timed out. The video should begin shortly.");
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally { setIsUploading(false); }
  }

  // ── single-shot analysis ──────────────────────────────────────────────────

  async function analyzeFile(file: File) {
    setSelectedFile(file); setUploadResult(null);
    setUploadError(null);  setIsAnalyzing(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r  = await fetch(`${BASE}/api/detect`, { method: "POST", body: fd });
      if (!r.ok) {
        const d = await r.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(d.detail ?? `Server error ${r.status}`);
      }
      setUploadResult(await r.json());
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Analysis failed");
    } finally { setIsAnalyzing(false); }
  }

  function clearAnalysis() {
    setUploadResult(null); setUploadError(null); setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ── derived ───────────────────────────────────────────────────────────────

  const workers     = streamStatus?.workers ?? [];
  const safeCount   = workers.filter((w) => w.status === "safe").length;
  const unsafeCount = workers.filter((w) => w.status === "unsafe").length;
  const isRunning   = streamStatus?.running ?? false;
  const maxRetried  = retryCount >= MAX_RETRIES;

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <Shell>
      <div className="space-y-4 flex flex-col h-full">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex justify-between items-end shrink-0">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Video Feed</h1>
            <p className="text-muted-foreground font-mono text-sm">
              REAL-TIME STREAM // AI PIPELINE ACTIVE
            </p>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <button onClick={() => ctrlStart("demo")} disabled={streamLoading2}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-mono rounded-md border border-border/50 bg-card/50 hover:bg-card text-muted-foreground hover:text-foreground transition-all">
              <Play className="w-3.5 h-3.5" /> DEMO
            </button>
            <button onClick={() => ctrlStart("webcam")} disabled={streamLoading2}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-mono rounded-md border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-all">
              <Camera className="w-3.5 h-3.5" /> WEBCAM
            </button>
            <button onClick={() => streamFileRef.current?.click()} disabled={isUploading}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-mono rounded-md border border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 transition-all">
              {isUploading
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <FileVideo className="w-3.5 h-3.5" />}
              {isUploading ? "UPLOADING…" : "VIDEO FILE"}
            </button>
            {isRunning && (
              <button onClick={ctrlStop}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-mono rounded-md border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-all">
                <Square className="w-3.5 h-3.5" /> STOP
              </button>
            )}
            <input ref={streamFileRef} type="file" accept="video/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadForStream(f); e.target.value = ""; }} />
          </div>
        </div>

        {/* ── Main Grid ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 flex-1 min-h-0">

          {/* ── Stream area ──────────────────────────────────────────────── */}
          <div className="lg:col-span-3 flex flex-col gap-3 min-h-0">

            {/* Video viewer */}
            <Card className="border-border/50 bg-black overflow-hidden relative flex-1 min-h-[300px]">

              {/* Status badge */}
              <div className="absolute top-3 left-3 z-10 flex items-center gap-2 pointer-events-none">
                <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono backdrop-blur-sm border ${
                  isRunning && streamOk
                    ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                    : streamLoading
                    ? "bg-yellow-500/20 border-yellow-500/40 text-yellow-400"
                    : "bg-zinc-800/80 border-zinc-700/50 text-zinc-400"
                }`}>
                  {isRunning && streamOk
                    ? <><Radio className="w-3 h-3 animate-pulse" /> LIVE</>
                    : streamLoading
                    ? <><Loader2 className="w-3 h-3 animate-spin" /> CONNECTING…</>
                    : <><WifiOff className="w-3 h-3" /> OFFLINE</>}
                </span>
                {streamOk && streamStatus && (
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono backdrop-blur-sm bg-black/60 border border-white/10 text-zinc-300">
                    <Wifi className="w-3 h-3 text-blue-400" />
                    {streamStatus.fps} fps · {streamStatus.source}
                  </span>
                )}
              </div>

              {/* Stream <img> — always mounted so auto-reconnect works */}
              <img
                ref={imgRef}
                src={streamSrc()}
                alt="Live AI stream"
                className={`w-full h-full object-contain transition-opacity duration-300 ${
                  streamOk ? "opacity-100" : "opacity-0"
                }`}
                style={{ minHeight: "300px" }}
                onLoad={handleStreamLoad}
                onError={handleStreamError}
              />

              {/* Loading overlay */}
              {streamLoading && !streamOk && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-950/90">
                  <Loader2 className="w-10 h-10 text-blue-400 animate-spin" />
                  <p className="font-mono text-sm text-zinc-400">Connecting to stream…</p>
                  {retryCount > 0 && (
                    <p className="font-mono text-xs text-zinc-600">
                      Retry {retryCount}/{MAX_RETRIES}
                    </p>
                  )}
                </div>
              )}

              {/* Error overlay — shown only when not loading */}
              {!streamLoading && !streamOk && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-zinc-950/90">
                  <WifiOff className="w-10 h-10 text-zinc-600" />
                  {maxRetried ? (
                    <>
                      <p className="font-mono text-sm text-zinc-400">Stream unavailable</p>
                      <p className="font-mono text-xs text-zinc-600 max-w-xs text-center">
                        Make sure the AI service is running and click retry.
                      </p>
                      <button onClick={manualRetry}
                        className="flex items-center gap-2 px-4 py-2 text-xs font-mono rounded-md border border-zinc-700 hover:bg-zinc-800 text-zinc-300 transition-colors">
                        <RefreshCw className="w-3.5 h-3.5" /> RETRY
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="font-mono text-sm text-zinc-400">
                        Reconnecting in {retryCountdown}s…
                      </p>
                      <p className="font-mono text-xs text-zinc-600">
                        Attempt {retryCount + 1} of {MAX_RETRIES}
                      </p>
                      <button onClick={manualRetry}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono rounded border border-zinc-700 hover:bg-zinc-800 text-zinc-400 transition-colors">
                        <RefreshCw className="w-3 h-3" /> Retry now
                      </button>
                    </>
                  )}
                </div>
              )}
            </Card>

            {/* Live stat cards */}
            <div className="grid grid-cols-4 gap-3 shrink-0">
              {[
                { label: "WORKERS", value: workers.length, cls: "text-foreground" },
                { label: "SAFE",    value: safeCount,      cls: "text-emerald-400" },
                { label: "UNSAFE",  value: unsafeCount,    cls: unsafeCount > 0 ? "text-red-400" : "text-muted-foreground" },
                { label: "FPS",     value: streamStatus?.fps ?? 0, cls: "text-blue-400" },
              ].map(({ label, value, cls }) => (
                <Card key={label} className={`border-border/50 ${label === "UNSAFE" && unsafeCount > 0 ? "bg-red-500/5 border-red-500/20" : "bg-card/50"}`}>
                  <CardContent className="p-4 text-center">
                    <p className={`text-2xl font-bold ${cls}`}>{value}</p>
                    <p className="text-xs font-mono text-muted-foreground mt-1">{label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* ── Live Detections Panel ──────────────────────────────── */}
            <Card className="border-border/50 bg-card/50 shrink-0">
              <CardContent className="p-0">
                {/* Panel header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
                  <div className="flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5 text-blue-400" />
                    <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      Live Detections Panel
                    </span>
                    {detections && detections.summary.total > 0 && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/20">
                        {detections.summary.total} tracked
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {detections && detections.summary.unsafe > 0 && (
                      <span className="text-[10px] font-mono text-red-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse inline-block" />
                        {detections.summary.unsafe} UNSAFE
                      </span>
                    )}
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {detUpdatedAt ? detUpdatedAt.toLocaleTimeString() : "—"}
                    </span>
                  </div>
                </div>

                {/* Table */}
                {!detections || detections.workers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 gap-2">
                    <Radio className="w-6 h-6 text-muted-foreground/30" />
                    <p className="text-xs font-mono text-muted-foreground">
                      {detections?.running === false
                        ? "Stream not running — press DEMO or upload a video"
                        : "Waiting for workers in frame…"}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    {/* Table header */}
                    <div className="grid grid-cols-[48px_1fr_80px_1fr_72px] gap-px bg-border/20 text-[10px] font-mono uppercase tracking-wider text-muted-foreground px-4 py-2 border-b border-border/30">
                      <span>ID</span>
                      <span>Name</span>
                      <span>Status</span>
                      <span>Violation</span>
                      <span className="text-right">Conf.</span>
                    </div>
                    {/* Table rows */}
                    <div className="divide-y divide-border/20">
                      {detections.workers.map((w) => {
                        const isSafe   = w.status === "safe";
                        const isUnsafe = w.status === "unsafe";
                        return (
                          <div
                            key={w.id}
                            className={`grid grid-cols-[48px_1fr_80px_1fr_72px] gap-px items-center px-4 py-2.5 text-xs font-mono transition-colors ${
                              isUnsafe
                                ? "bg-red-500/5 hover:bg-red-500/10"
                                : isSafe
                                ? "bg-emerald-500/5 hover:bg-emerald-500/8"
                                : "hover:bg-muted/10"
                            }`}
                          >
                            {/* ID */}
                            <span className="text-muted-foreground">
                              #{String(w.id).padStart(2, "0")}
                            </span>

                            {/* Name */}
                            <span className="text-foreground font-medium truncate pr-2">
                              {w.name}
                            </span>

                            {/* Status pill */}
                            <span>
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                isUnsafe
                                  ? "bg-red-500/20 text-red-400 border border-red-500/30"
                                  : isSafe
                                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                  : "bg-zinc-500/20 text-zinc-400 border border-zinc-500/30"
                              }`}>
                                {isUnsafe
                                  ? <><AlertTriangle className="w-2.5 h-2.5" /> UNSAFE</>
                                  : isSafe
                                  ? <><CheckCircle className="w-2.5 h-2.5" /> SAFE</>
                                  : "?"}
                              </span>
                            </span>

                            {/* Violation */}
                            <span className={`truncate pr-2 ${
                              isUnsafe ? "text-red-300" : "text-muted-foreground"
                            }`}>
                              {isUnsafe && w.violation !== "none"
                                ? w.violation
                                : <span className="text-muted-foreground/50">—</span>}
                            </span>

                            {/* Confidence */}
                            <span className={`text-right tabular-nums ${
                              w.confidence >= 0.7
                                ? "text-foreground"
                                : "text-muted-foreground"
                            }`}>
                              {(w.confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Sidebar ───────────────────────────────────────────────────── */}
          <div className="lg:col-span-1 flex flex-col gap-4 overflow-y-auto">

            {/* Live alert feed */}
            <Card className="border-border/50 bg-card/50 shrink-0">
              <CardContent className="p-4">
                <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                  <Radio className="w-3.5 h-3.5 text-red-400 animate-pulse" />
                  Live Alerts
                  {alerts.length > 0 && (
                    <span className="ml-auto text-xs bg-red-500/20 text-red-400 rounded-full px-1.5 py-0.5">
                      {alerts.length}
                    </span>
                  )}
                </h3>

                {alerts.length === 0 ? (
                  <p className="text-xs text-muted-foreground font-mono text-center py-4">No alerts yet</p>
                ) : (
                  <div className="space-y-2 max-h-52 overflow-y-auto">
                    {alerts.slice(0, 12).map((a, i) => (
                      <div key={i} className={`rounded-md border p-2.5 text-xs ${SEV_STYLE[a.severity] ?? SEV_STYLE.LOW}`}>
                        <div className="flex justify-between items-center mb-0.5">
                          <span className="font-mono font-bold">W#{a.worker_id}</span>
                          <span className="font-mono opacity-70 text-[10px]">{a.severity}</span>
                        </div>
                        {(a.violations ?? []).map((v) => (
                          <p key={v} className="font-mono opacity-80 text-[10px]">· {v}</p>
                        ))}
                        <p className="text-muted-foreground font-mono mt-1 text-[10px]">
                          {new Date(a.timestamp).toLocaleTimeString()}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                {alerts.length > 0 && (
                  <button onClick={() => setAlerts([])}
                    className="mt-2 w-full text-xs font-mono text-muted-foreground hover:text-foreground text-center">
                    Clear all
                  </button>
                )}
              </CardContent>
            </Card>

            {/* Frame analysis */}
            <Card className="border-border/50 bg-card/50">
              <CardContent className="p-4">
                <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                  <Upload className="w-3.5 h-3.5" /> Frame Analysis
                </h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Single-shot AI detection on image or video.
                </p>

                <div
                  className={`border-2 border-dashed rounded-lg p-5 flex flex-col items-center gap-2 text-center transition-colors cursor-pointer ${
                    isDragging ? "border-primary bg-primary/10" : "border-border/50 hover:bg-muted/10 hover:border-border"
                  } ${isAnalyzing ? "pointer-events-none opacity-60" : ""}`}
                  onClick={() => !isAnalyzing && fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files?.[0]; if (f) analyzeFile(f); }}>
                  {isAnalyzing
                    ? <><Loader2 className="w-7 h-7 text-primary animate-spin" /><p className="text-xs font-mono text-muted-foreground">Analyzing…</p></>
                    : <><div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center"><MonitorPlay className="w-4.5 h-4.5 text-primary" /></div>
                       <p className="text-xs text-card-foreground font-medium">Drop or click to upload</p>
                       <p className="text-[10px] font-mono text-muted-foreground">MP4 · AVI · JPG · PNG</p></>}
                </div>

                <input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) analyzeFile(f); }} />

                {uploadError && (
                  <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
                      <p className="text-xs text-destructive flex-1">{uploadError}</p>
                      <button onClick={clearAnalysis}><X className="w-3 h-3 text-muted-foreground hover:text-foreground" /></button>
                    </div>
                  </div>
                )}

                {uploadResult && !uploadError && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-muted-foreground uppercase">Results</span>
                      <button onClick={clearAnalysis}><X className="w-3 h-3 text-muted-foreground hover:text-foreground" /></button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 p-2 text-center">
                        <p className="text-lg font-bold text-emerald-400">{uploadResult.summary.safe_workers}</p>
                        <p className="text-[10px] font-mono text-muted-foreground">SAFE</p>
                      </div>
                      <div className={`rounded-md border p-2 text-center ${uploadResult.summary.unsafe_workers > 0 ? "bg-red-500/10 border-red-500/20" : "bg-muted/10 border-border/40"}`}>
                        <p className={`text-lg font-bold ${uploadResult.summary.unsafe_workers > 0 ? "text-red-400" : "text-muted-foreground"}`}>
                          {uploadResult.summary.unsafe_workers}
                        </p>
                        <p className="text-[10px] font-mono text-muted-foreground">UNSAFE</p>
                      </div>
                    </div>
                    <div className="rounded-md bg-muted/10 border border-border/30 p-2 text-[10px] font-mono text-muted-foreground space-y-1">
                      <div className="flex justify-between"><span>FILE</span><span className="text-foreground truncate ml-2 max-w-[100px]">{selectedFile?.name ?? "—"}</span></div>
                      <div className="flex justify-between"><span>VIOLATIONS</span><span className="text-foreground">{uploadResult.summary.violations_detected}</span></div>
                      <div className="flex justify-between"><span>MODEL</span><span className="text-foreground truncate ml-1 max-w-[100px]">{uploadResult.model}</span></div>
                    </div>
                    <div className="space-y-1.5">
                      {uploadResult.workers.map((w) => (
                        <div key={w.id} className={`rounded-md border p-2 flex items-start gap-2 ${
                          w.status === "safe" ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5"}`}>
                          {w.status === "safe"
                            ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                            : <AlertTriangle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />}
                          <div className="min-w-0 flex-1">
                            <div className="flex justify-between">
                              <span className="text-xs font-mono">W#{w.id}</span>
                              <span className={`text-xs font-mono font-bold uppercase ${w.status === "safe" ? "text-emerald-400" : "text-red-400"}`}>{w.status}</span>
                            </div>
                            {w.violations.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {(w.violations ?? []).map((v) => (
                                  <span key={v} className="text-[10px] bg-red-500/20 text-red-300 rounded px-1 py-0.5 font-mono">{v}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </Shell>
  );
}
