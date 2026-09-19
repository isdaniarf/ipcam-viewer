import { useState } from "react";
import type { CameraStatus } from "../lib/camera-video";
import { PROTOCOL_LABELS, streamUrl, type Camera, type Protocol } from "../types/camera";
import { StreamStatus } from "./StreamStatus";
import { VideoPlayer } from "./VideoPlayer";

interface CameraCardProps {
  camera: Camera;
  protocol: Protocol;
  onFullscreen: (camera: Camera) => void;
}

export function CameraCard({ camera, protocol, onFullscreen }: CameraCardProps) {
  const [status, setStatus] = useState<CameraStatus>("connecting");
  const streams = camera.streams[protocol];
  const streamId = streams ? (streams.sub ?? streams.main) : null;

  return (
    <div className="group relative overflow-hidden rounded-lg bg-gray-900">
      <div className="aspect-video">
        {streamId ? (
          <VideoPlayer
            src={streamUrl(streamId)}
            visibilityThreshold={0.01}
            onStatusChange={setStatus}
            className="h-full w-full"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-sm text-gray-500">
              {PROTOCOL_LABELS[protocol]} is not available.
            </span>
          </div>
        )}
      </div>

      {streamId && status !== "live" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <StreamStatus status={status} />
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-3 py-2">
        <span className="text-sm font-medium text-white">{camera.label}</span>
        <button
          id={`fullscreen-${camera.name}`}
          onClick={() => onFullscreen(camera)}
          className="rounded p-1 text-white/80 transition-opacity hover:text-white pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100"
          aria-label={`Show ${camera.label} in fullscreen`}
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
