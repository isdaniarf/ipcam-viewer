import type { Camera, Protocol } from "../types/camera";
import { VideoPlayer } from "./VideoPlayer";

interface CameraCardProps {
  camera: Camera;
  selectedProtocol: Protocol;
  onFullscreen: (camera: Camera) => void;
}

export function CameraCard({ camera, selectedProtocol, onFullscreen }: CameraCardProps) {
  const label = camera.name.replace(/_/g, " ");
  const available = camera.protocols.includes(selectedProtocol);
  const streamName = `${camera.name}.${selectedProtocol}`;

  return (
    <div className="group relative overflow-hidden rounded-lg bg-gray-900">
      <div className="aspect-video">
        {available ? (
          <VideoPlayer
            src={`/api/ws?src=${streamName}`}
            className="h-full w-full"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-sm text-gray-500">
              {selectedProtocol.toUpperCase()} not available
            </span>
          </div>
        )}
      </div>
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-3 py-2">
        <span className="text-sm font-medium capitalize text-white">
          {label}
        </span>
        <button
          onClick={() => onFullscreen(camera)}
          className="rounded p-1 text-white/70 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
          aria-label={`Fullscreen ${label}`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-5 w-5"
          >
            <path d="M3.75 3.75v4.5h1.5v-3h3v-1.5h-4.5zM11.75 3.75v1.5h3v3h1.5v-4.5h-4.5zM5.25 11.75h-1.5v4.5h4.5v-1.5h-3v-3zM14.75 14.75v-3h1.5v4.5h-4.5v-1.5h3z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
