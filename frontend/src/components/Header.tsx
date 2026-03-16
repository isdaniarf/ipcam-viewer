import type { Protocol } from "../types/camera";

interface HeaderProps {
  cameraCount: number;
  availableProtocols: Protocol[];
  selectedProtocol: Protocol;
  onProtocolChange: (protocol: Protocol) => void;
}

const PROTOCOL_LABELS: Record<Protocol, string> = {
  rtsp: "RTSP",
  onvif: "ONVIF",
  tapo: "Tapo",
};

export function Header({
  cameraCount,
  availableProtocols,
  selectedProtocol,
  onProtocolChange,
}: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-6 py-4">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-semibold text-white">IP Camera Viewer</h1>
        <span className="text-sm text-gray-400">
          {cameraCount} camera{cameraCount !== 1 ? "s" : ""}
        </span>
      </div>

      {availableProtocols.length > 1 && (
        <div className="flex rounded-lg bg-gray-900 p-1">
          {availableProtocols.map((proto) => (
            <button
              key={proto}
              onClick={() => onProtocolChange(proto)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                proto === selectedProtocol
                  ? "bg-gray-700 text-white"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {PROTOCOL_LABELS[proto]}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}
