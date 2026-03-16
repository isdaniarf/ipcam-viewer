import type { Camera, Protocol } from "../types/camera";
import { CameraCard } from "./CameraCard";

interface CameraGridProps {
  cameras: Camera[];
  selectedProtocol: Protocol;
  onFullscreen: (camera: Camera) => void;
}

export function CameraGrid({ cameras, selectedProtocol, onFullscreen }: CameraGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 px-6 pb-6 sm:grid-cols-2 lg:grid-cols-3">
      {cameras.map((camera) => (
        <CameraCard
          key={camera.name}
          camera={camera}
          selectedProtocol={selectedProtocol}
          onFullscreen={onFullscreen}
        />
      ))}
    </div>
  );
}
