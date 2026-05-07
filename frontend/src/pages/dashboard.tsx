import { Shell } from "@/components/layout/shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useGetAnalyticsSummary,
  useGetAnalyticsTrends,
  useGetDetectionHistory,
  useGetViolationBreakdown,
} from "@workspace/api-client-react";
import { Users, AlertTriangle, ShieldCheck, Activity, Database, TrendingUp } from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const CHART_STYLE = {
  contentStyle: {
    backgroundColor: "#0f172a",
    border: "1px solid #1e293b",
    borderRadius: "8px",
  },
  itemStyle: { color: "#e2e8f0" },
};

const SAFE_COLOR = "#22c55e";
const UNSAFE_COLOR = "#ef4444";

export default function Dashboard() {
  const { data: summary, isLoading: summaryLoading } = useGetAnalyticsSummary();
  const { data: trends, isLoading: trendsLoading } = useGetAnalyticsTrends();
  const { data: violations, isLoading: violationsLoading } = useGetViolationBreakdown();
  const { data: history, isLoading: historyLoading } = useGetDetectionHistory({
    limit: 8,
    status: "unsafe",
  });

  const safeUnsafeData =
    summary && (summary.totalDetections ?? 0) > 0
      ? [
          { name: "Safe", value: summary.safeDetections, fill: SAFE_COLOR },
          { name: "Unsafe", value: summary.unsafeDetections, fill: UNSAFE_COLOR },
        ]
      : [];

  const formattedTrends = (trends ?? []).map((t) => ({
    ...t,
    day: new Date(t.day).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  }));

  return (
    <Shell>
      <div className="space-y-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Command Center</h1>
          <p className="text-muted-foreground font-mono text-sm">
            SYSTEM OVERVIEW // LIVE DATABASE ANALYTICS
          </p>
        </div>

        {/* Stats Grid — real DB data */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard
            title="Total Workers"
            value={summary?.totalWorkers}
            icon={Users}
            loading={summaryLoading}
          />
          <StatCard
            title="Total Detections"
            value={summary?.totalDetections}
            icon={Database}
            loading={summaryLoading}
          />
          <StatCard
            title="Safe Detections"
            value={summary?.safeDetections}
            icon={ShieldCheck}
            loading={summaryLoading}
            accent="green"
          />
          <StatCard
            title="Unsafe Detections"
            value={summary?.unsafeDetections}
            icon={AlertTriangle}
            loading={summaryLoading}
            accent="red"
            alert={(summary?.unsafeDetections ?? 0) > 0}
          />
          <StatCard
            title="Safety Score"
            value={summary ? `${summary.safetyScore}%` : undefined}
            icon={Activity}
            loading={summaryLoading}
            accent={
              (summary?.safetyScore ?? 100) >= 80
                ? "green"
                : (summary?.safetyScore ?? 100) >= 60
                ? "yellow"
                : "red"
            }
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Chart Area */}
          <div className="lg:col-span-2 space-y-8">
            {/* 30-Day Trends */}
            <Card className="border-border/50 bg-card/50 backdrop-blur">
              <CardHeader>
                <CardTitle className="font-mono text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  Detection Trends (Last 30 Days)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[280px] w-full">
                  {trendsLoading ? (
                    <Skeleton className="w-full h-full" />
                  ) : formattedTrends.length === 0 ? (
                    <EmptyChart message="No detection data yet. Upload an image or video to start." />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={formattedTrends} barCategoryGap="30%">
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="#334155"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="day"
                          stroke="#94a3b8"
                          fontSize={11}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          stroke="#94a3b8"
                          fontSize={11}
                          tickLine={false}
                          axisLine={false}
                        />
                        <Tooltip {...CHART_STYLE} />
                        <Bar dataKey="total" name="Total" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="unsafe" name="Unsafe" fill="#ef4444" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Violations over time + Safe vs Unsafe ratio */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Violations line chart */}
              <Card className="border-border/50 bg-card/50 backdrop-blur">
                <CardHeader>
                  <CardTitle className="font-mono text-sm uppercase tracking-wider text-muted-foreground">
                    Violations Over Time
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[220px] w-full">
                    {trendsLoading ? (
                      <Skeleton className="w-full h-full" />
                    ) : formattedTrends.length === 0 ? (
                      <EmptyChart message="No data yet" />
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={formattedTrends}>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="#334155"
                            vertical={false}
                          />
                          <XAxis
                            dataKey="day"
                            stroke="#94a3b8"
                            fontSize={10}
                            tickLine={false}
                            axisLine={false}
                          />
                          <YAxis
                            stroke="#94a3b8"
                            fontSize={10}
                            tickLine={false}
                            axisLine={false}
                          />
                          <Tooltip {...CHART_STYLE} />
                          <Line
                            type="monotone"
                            dataKey="violations"
                            stroke="#f59e0b"
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4 }}
                            name="Violations"
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Safe vs Unsafe Pie */}
              <Card className="border-border/50 bg-card/50 backdrop-blur">
                <CardHeader>
                  <CardTitle className="font-mono text-sm uppercase tracking-wider text-muted-foreground">
                    Safe vs Unsafe Ratio
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[220px] w-full">
                    {summaryLoading ? (
                      <Skeleton className="w-full h-full rounded-full" />
                    ) : safeUnsafeData.length === 0 ? (
                      <EmptyChart message="No detection data yet" />
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={safeUnsafeData}
                            cx="50%"
                            cy="50%"
                            innerRadius={55}
                            outerRadius={75}
                            paddingAngle={4}
                            dataKey="value"
                            nameKey="name"
                          >
                            {safeUnsafeData.map((entry, i) => (
                              <Cell key={i} fill={entry.fill} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={CHART_STYLE.contentStyle} />
                          <Legend
                            formatter={(value) => (
                              <span className="text-xs font-mono text-muted-foreground uppercase">
                                {value}
                              </span>
                            )}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Right Column — Recent Unsafe Detections */}
          <div className="lg:col-span-1 space-y-4">
            <h3 className="font-mono text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              Recent Unsafe Detections
            </h3>
            <div className="space-y-3">
              {historyLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))
              ) : (history?.data ?? []).length === 0 ? (
                <div className="p-4 rounded-lg bg-card border border-border/50 text-center">
                  <p className="text-sm text-muted-foreground">
                    No unsafe detections yet.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Upload footage on the Video Feed page to begin.
                  </p>
                </div>
              ) : (
                (history?.data ?? []).map((d) => (
                  <div
                    key={d.id}
                    className="p-4 rounded-lg bg-card border border-destructive/20 hover:bg-card/80 transition-colors"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <Badge variant="destructive" className="text-xs font-mono">
                        UNSAFE
                      </Badge>
                      <span className="text-xs font-mono text-muted-foreground">
                        {new Date(d.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-card-foreground mb-1">
                      {d.workerName ?? `Worker ${d.trackId ?? d.workerId}`}
                    </p>
                    {(d.violations as string[])?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {(d.violations as string[]).map((v, i) => (
                          <span
                            key={i}
                            className="text-xs px-2 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/20 font-mono"
                          >
                            {v}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      Confidence: {Math.round((d.confidence ?? 0) * 100)}%
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  loading,
  alert,
  accent,
}: {
  title: string;
  value: string | number | undefined;
  icon: React.ComponentType<{ className?: string }>;
  loading: boolean;
  alert?: boolean;
  accent?: "green" | "red" | "yellow";
}) {
  const accentClasses = {
    green: "text-emerald-400",
    red: "text-destructive",
    yellow: "text-amber-400",
  };

  return (
    <Card
      className={`border-border/50 bg-card/50 backdrop-blur ${
        alert ? "border-destructive/50 bg-destructive/10" : ""
      }`}
    >
      <CardContent className="p-6">
        <div className="flex items-center justify-between pb-2">
          <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            {title}
          </p>
          <Icon
            className={`w-4 h-4 ${
              alert
                ? "text-destructive"
                : accent
                ? accentClasses[accent]
                : "text-muted-foreground"
            }`}
          />
        </div>
        <div className="flex items-baseline gap-2">
          {loading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <h2
              className={`text-3xl font-bold ${
                alert
                  ? "text-destructive"
                  : accent
                  ? accentClasses[accent]
                  : "text-card-foreground"
              }`}
            >
              {value ?? 0}
            </h2>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <p className="text-sm text-muted-foreground text-center max-w-[180px]">{message}</p>
    </div>
  );
}
