import type { CameraStatus } from "../lib/camera-video";

interface StreamStatusProps {
  status: CameraStatus;
  className?: string;
}

const STATUS_TEXT: Record<CameraStatus, string> = {
  connecting: "Connecting",
  live: "Live",
  offline: "Offline. It retries.",
};

const STATUS_DOT: Record<CameraStatus, string> = {
  connecting: "bg-amber-400 animate-pulse",
  live: "bg-emerald-400",
  offline: "bg-red-500",
};

export function StreamStatus({ status, className }: StreamStatusProps) {
  return (
    <div
      role="status"
      className={`flex items-center gap-2 rounded-full bg-black/70 px-3 py-1 text-xs text-gray-200 ${className ?? ""}`}
    >
      <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
      {STATUS_TEXT[status]}
    </div>
  );
}
