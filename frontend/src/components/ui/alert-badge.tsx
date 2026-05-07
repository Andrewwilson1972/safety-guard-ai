import { AlertSeverity } from "@workspace/api-client-react";

interface AlertBadgeProps {
  severity: AlertSeverity;
}

export function AlertBadge({ severity }: AlertBadgeProps) {
  const colors = {
    low: "bg-blue-500/20 text-blue-400 border-blue-500/50",
    medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/50",
    high: "bg-orange-500/20 text-orange-400 border-orange-500/50",
    critical: "bg-red-500/20 text-red-400 border-red-500/50 animate-pulse",
  };

  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${colors[severity]} uppercase tracking-wider`}>
      {severity}
    </span>
  );
}
