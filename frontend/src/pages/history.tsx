import { Shell } from "@/components/layout/shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useGetDetectionHistory } from "@workspace/api-client-react";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { History, ChevronLeft, ChevronRight, ShieldCheck, ShieldAlert, Filter, X } from "lucide-react";

const PAGE_SIZE = 20;

export default function HistoryPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [workerInput, setWorkerInput] = useState("");
  const [workerIdFilter, setWorkerIdFilter] = useState<number | undefined>();

  const queryParams = {
    page,
    limit: PAGE_SIZE,
    ...(statusFilter !== "all" && { status: statusFilter as "safe" | "unsafe" }),
    ...(workerIdFilter && { workerId: workerIdFilter }),
    ...(dateFrom && { dateFrom }),
    ...(dateTo && { dateTo }),
  };

  const { data, isLoading, isFetching } = useGetDetectionHistory(queryParams);

  const rows = data?.data ?? [];
  const pagination = data?.pagination;

  function applyWorkerFilter() {
    const n = parseInt(workerInput, 10);
    setWorkerIdFilter(isNaN(n) ? undefined : n);
    setPage(1);
  }

  function clearFilters() {
    setStatusFilter("all");
    setDateFrom("");
    setDateTo("");
    setWorkerInput("");
    setWorkerIdFilter(undefined);
    setPage(1);
  }

  const hasFilters =
    statusFilter !== "all" || dateFrom || dateTo || workerIdFilter !== undefined;

  return (
    <Shell>
      <div className="space-y-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <History className="w-8 h-8 text-primary" />
            Detection History
          </h1>
          <p className="text-muted-foreground font-mono text-sm">
            AUDIT LOG // ALL WORKER DETECTION EVENTS
          </p>
        </div>

        {/* Filters */}
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardHeader className="pb-4">
            <CardTitle className="font-mono text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Filter className="w-4 h-4" />
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Status filter */}
              <div className="space-y-1.5">
                <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                  Status
                </label>
                <Select
                  value={statusFilter}
                  onValueChange={(v) => {
                    setStatusFilter(v);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="bg-background border-border/50">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="safe">Safe</SelectItem>
                    <SelectItem value="unsafe">Unsafe</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Worker ID filter */}
              <div className="space-y-1.5">
                <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                  Worker ID
                </label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="e.g. 1"
                    value={workerInput}
                    onChange={(e) => setWorkerInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && applyWorkerFilter()}
                    className="bg-background border-border/50"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={applyWorkerFilter}
                  >
                    Go
                  </Button>
                </div>
              </div>

              {/* Date From */}
              <div className="space-y-1.5">
                <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                  From Date
                </label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setPage(1);
                  }}
                  className="bg-background border-border/50"
                />
              </div>

              {/* Date To */}
              <div className="space-y-1.5">
                <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                  To Date
                </label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setPage(1);
                  }}
                  className="bg-background border-border/50"
                />
              </div>
            </div>

            {hasFilters && (
              <div className="mt-4 flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4 mr-1" />
                  Clear Filters
                </Button>
                {pagination && (
                  <span className="text-xs text-muted-foreground font-mono">
                    {pagination.total} result{pagination.total !== 1 ? "s" : ""} found
                  </span>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="border-border/50 bg-card/50 backdrop-blur overflow-hidden">
          <div className={`transition-opacity ${isFetching ? "opacity-60" : "opacity-100"}`}>
            {isLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="p-16 text-center">
                <History className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                <p className="text-muted-foreground">No detection records found.</p>
                <p className="text-sm text-muted-foreground/60 mt-1">
                  Upload footage on the Video Feed page to generate detection events.
                </p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/30">
                    <th className="text-left px-6 py-4 text-xs font-mono uppercase tracking-wider text-muted-foreground">
                      ID
                    </th>
                    <th className="text-left px-6 py-4 text-xs font-mono uppercase tracking-wider text-muted-foreground">
                      Worker
                    </th>
                    <th className="text-left px-6 py-4 text-xs font-mono uppercase tracking-wider text-muted-foreground">
                      Status
                    </th>
                    <th className="text-left px-6 py-4 text-xs font-mono uppercase tracking-wider text-muted-foreground hidden md:table-cell">
                      Violations
                    </th>
                    <th className="text-left px-6 py-4 text-xs font-mono uppercase tracking-wider text-muted-foreground hidden lg:table-cell">
                      Confidence
                    </th>
                    <th className="text-left px-6 py-4 text-xs font-mono uppercase tracking-wider text-muted-foreground hidden lg:table-cell">
                      Upload ID
                    </th>
                    <th className="text-left px-6 py-4 text-xs font-mono uppercase tracking-wider text-muted-foreground">
                      Timestamp
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr
                      key={row.id}
                      className={`border-b border-border/30 hover:bg-muted/20 transition-colors ${
                        idx % 2 === 0 ? "" : "bg-muted/5"
                      }`}
                    >
                      <td className="px-6 py-4 font-mono text-muted-foreground text-xs">
                        {row.id}
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-medium text-card-foreground">
                          {row.workerName ?? `Worker ${row.trackId ?? row.workerId}`}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground font-mono">
                          #{row.workerId}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {row.status === "safe" ? (
                          <Badge
                            variant="outline"
                            className="text-emerald-400 border-emerald-400/30 bg-emerald-400/10 font-mono"
                          >
                            <ShieldCheck className="w-3 h-3 mr-1" />
                            SAFE
                          </Badge>
                        ) : (
                          <Badge
                            variant="destructive"
                            className="font-mono"
                          >
                            <ShieldAlert className="w-3 h-3 mr-1" />
                            UNSAFE
                          </Badge>
                        )}
                      </td>
                      <td className="px-6 py-4 hidden md:table-cell">
                        {(row.violations as string[])?.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {(row.violations as string[]).map((v, i) => (
                              <span
                                key={i}
                                className="text-xs px-2 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/20 font-mono"
                              >
                                {v}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">None</span>
                        )}
                      </td>
                      <td className="px-6 py-4 hidden lg:table-cell font-mono text-xs text-muted-foreground">
                        {Math.round((row.confidence ?? 0) * 100)}%
                      </td>
                      <td className="px-6 py-4 hidden lg:table-cell font-mono text-xs text-muted-foreground">
                        {row.uploadId?.slice(0, 8)}...
                      </td>
                      <td className="px-6 py-4 text-xs text-muted-foreground font-mono">
                        {new Date(row.timestamp).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-border/50">
              <span className="text-xs font-mono text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || isFetching}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="border-border/50"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pagination.totalPages || isFetching}
                  onClick={() => setPage((p) => p + 1)}
                  className="border-border/50"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </Shell>
  );
}
