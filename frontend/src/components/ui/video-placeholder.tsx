import { Camera, Radio, Clock } from "lucide-react";
import { useEffect, useState } from "react";

interface VideoPlaceholderProps {
  cameraId: string;
  status?: "connecting" | "live" | "offline";
  label?: string;
  className?: string;
}

export function VideoPlaceholder({ cameraId, status = "live", label = "Live Feed", className = "" }: VideoPlaceholderProps) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className={`relative bg-slate-950 border border-border rounded-lg overflow-hidden flex items-center justify-center aspect-video ${className}`}>
      {/* Grid overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]" />
      
      {/* Content */}
      <div className="flex flex-col items-center justify-center gap-4 z-10 text-muted-foreground">
        <Camera className={`w-12 h-12 ${status === "live" ? "text-primary opacity-50" : "text-muted-foreground opacity-30"}`} />
        <div className="font-mono tracking-widest text-sm font-bold flex flex-col items-center gap-2">
          {status === "live" && <span className="text-primary animate-pulse flex items-center gap-2"><Radio className="w-4 h-4"/> RECORDING</span>}
          {status === "connecting" && <span>CONNECTING...</span>}
          {status === "offline" && <span className="text-destructive">NO SIGNAL</span>}
        </div>
      </div>

      {/* Overlays */}
      <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/60 px-3 py-1.5 rounded-md backdrop-blur-md border border-white/10">
        <div className={`w-2 h-2 rounded-full ${status === "live" ? "bg-red-500 animate-pulse" : "bg-muted-foreground"}`} />
        <span className="text-xs font-mono text-white/90 font-medium">{label} - {cameraId}</span>
      </div>

      <div className="absolute bottom-4 right-4 flex items-center gap-2 bg-black/60 px-3 py-1.5 rounded-md backdrop-blur-md border border-white/10">
        <Clock className="w-3.5 h-3.5 text-white/70" />
        <span className="text-xs font-mono text-white/90">
          {time.toISOString().replace("T", " ").substring(0, 19)}
        </span>
      </div>
    </div>
  );
}
