import { PROTOCOL_LABELS, type Protocol } from "../types/camera";

interface HeaderProps {
  cameraCount: number;
  availableProtocols: Protocol[];
  selectedProtocol: Protocol;
  onProtocolChange: (protocol: Protocol) => void;
}

export function Header({
  cameraCount,
  availableProtocols,
  selectedProtocol,
  onProtocolChange,
}: HeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-semibold text-white">IP Camera Viewer</h1>
        <span className="text-sm text-gray-400">
          {cameraCount} camera{cameraCount !== 1 ? "s" : ""}
        </span>
      </div>

      {availableProtocols.length > 1 && (
        <div className="flex rounded-lg bg-gray-900 p-1" role="group" aria-label="Stream protocol">
          {availableProtocols.map((protocol) => (
            <button
              key={protocol}
              onClick={() => onProtocolChange(protocol)}
              aria-pressed={protocol === selectedProtocol}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                protocol === selectedProtocol
                  ? "bg-gray-700 text-white"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {PROTOCOL_LABELS[protocol]}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}
