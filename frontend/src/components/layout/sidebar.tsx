import { Link, useLocation } from "wouter";
import { Shield, LayoutDashboard, Video, AlertTriangle, FileText, History, Bot, Wifi, WifiOff } from "lucide-react";
import { useHealthCheck } from "@workspace/api-client-react";
import { useEffect, useState } from "react";

interface AiModeData { available: boolean; mode: "openai" | "ollama" | null; model: string | null }

function useAiMode() {
  const [data, setData] = useState<AiModeData | null>(null);
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
  useEffect(() => {
    fetch(`${BASE}/api/ai-mode`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setData({ available: false, mode: null, model: null }));
  }, []);
  return data;
}

export function Sidebar() {
  const [location] = useLocation();
  const { data: health } = useHealthCheck();
  const aiMode = useAiMode();

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/video", label: "Video Feed", icon: Video },
    { href: "/alerts", label: "Alerts", icon: AlertTriangle },
    { href: "/history", label: "History", icon: History },
    { href: "/assistant", label: "Assistant", icon: Bot },
    { href: "/reports", label: "Reports", icon: FileText },
  ];

  return (
    <div className="w-64 bg-sidebar border-r border-sidebar-border h-screen flex flex-col fixed left-0 top-0">
      <div className="p-6 flex items-center gap-3 text-sidebar-foreground border-b border-sidebar-border">
        <Shield className="w-8 h-8 text-primary" />
        <div className="font-bold text-lg tracking-tight leading-none">
          WORKER<br />
          <span className="text-primary">SAFETY</span> MON
        </div>
      </div>

      <nav className="flex-1 px-4 py-6 space-y-2">
        {navItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-md transition-colors ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              }`}
              data-testid={`nav-${item.label.toLowerCase().replace(" ", "-")}`}
            >
              <item.icon className="w-5 h-5" />
              <span className="font-medium text-sm">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-4 pb-3 space-y-2">
        {/* AI mode badge */}
        {aiMode !== null && (
          <div
            className={`flex items-center gap-2 px-3 py-2 rounded-md border text-xs font-mono uppercase tracking-wider ${
              aiMode.available && aiMode.mode === "ollama"
                ? "bg-purple-500/10 border-purple-500/30 text-purple-400"
                : aiMode.available && aiMode.mode === "openai"
                ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
                : "bg-muted/30 border-border/50 text-muted-foreground"
            }`}
          >
            {aiMode.available ? (
              <Wifi className="w-3 h-3 shrink-0" />
            ) : (
              <WifiOff className="w-3 h-3 shrink-0" />
            )}
            <span>
              {aiMode.mode === "ollama"
                ? `Offline AI (${aiMode.model})`
                : aiMode.mode === "openai"
                ? "Online AI (GPT)"
                : "AI Unavailable"}
            </span>
          </div>
        )}

        {/* System status */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-background/50 border border-border">
          <div
            className={`w-2 h-2 rounded-full ${
              health?.status === "ok" ? "bg-emerald-500 animate-pulse" : "bg-red-500"
            }`}
          />
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
            {health?.status === "ok" ? "System Online" : "System Offline"}
          </span>
        </div>
      </div>
    </div>
  );
}
