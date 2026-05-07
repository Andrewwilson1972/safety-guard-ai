import { Shell } from "@/components/layout/shell";
import { useGetRecentAlerts } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertBadge } from "@/components/ui/alert-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Search, Filter } from "lucide-react";
import { useState } from "react";

export default function Alerts() {
  const { data: alerts, isLoading } = useGetRecentAlerts();
  const [search, setSearch] = useState("");

  const filteredAlerts = alerts?.filter(a => 
    a.type.toLowerCase().includes(search.toLowerCase()) || 
    a.zone.toLowerCase().includes(search.toLowerCase()) ||
    a.message.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Shell>
      <div className="space-y-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Security Alerts</h1>
          <p className="text-muted-foreground font-mono text-sm">INCIDENT LOG // HISTORICAL DATA</p>
        </div>

        <div className="flex items-center gap-4 bg-card/50 p-4 rounded-lg border border-border/50 backdrop-blur">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search by type, zone, or message..." 
              className="pl-9 bg-background border-border/50 font-mono text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-alert-search"
            />
          </div>
          <button className="flex items-center gap-2 px-4 py-2 rounded-md border border-border/50 bg-background text-sm font-medium hover:bg-muted/50 transition-colors">
            <Filter className="w-4 h-4" />
            Filter
          </button>
        </div>

        <div className="rounded-md border border-border/50 bg-card/50 backdrop-blur overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="font-mono text-xs uppercase tracking-wider w-[100px]">ID</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider w-[120px]">Severity</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider">Type</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider w-[150px]">Zone</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider">Message</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider text-right">Timestamp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i} className="border-border/50">
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-64" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : filteredAlerts?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground font-mono text-sm">
                    NO ALERTS FOUND
                  </TableCell>
                </TableRow>
              ) : (
                filteredAlerts?.map((alert) => (
                  <TableRow key={alert.id} className="border-border/50 hover:bg-muted/20 transition-colors cursor-pointer group" data-testid={`row-alert-${alert.id}`}>
                    <TableCell className="font-mono text-xs text-muted-foreground">#{alert.id}</TableCell>
                    <TableCell>
                      <AlertBadge severity={alert.severity} />
                    </TableCell>
                    <TableCell className="font-medium text-sm text-card-foreground">{alert.type}</TableCell>
                    <TableCell>
                      <span className="px-2 py-1 rounded bg-background border border-border font-mono text-xs text-muted-foreground">
                        {alert.zone}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-md truncate group-hover:text-card-foreground transition-colors">
                      {alert.message}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {new Date(alert.timestamp).toLocaleString([], {
                        month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'
                      })}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </Shell>
  );
}
