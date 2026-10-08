import { useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { CameraStatus } from "../lib/camera-video";
import { PROTOCOL_LABELS, streamUrl, type Camera, type Protocol } from "../types/camera";
import { GripIcon } from "./GripIcon";
import { StreamStatus } from "./StreamStatus";
import { VideoPlayer } from "./VideoPlayer";

export type DragRole = "source" | "target" | null;

interface CameraCardProps {
  camera: Camera;
  protocol: Protocol;
  mainStream: boolean;
  style: CSSProperties;
  dragRole: DragRole;
  onFullscreen: (camera: Camera) => void;
  onDragStart: (event: PointerEvent<HTMLElement>) => void;
  onMove: (delta: number) => void;
}

const MOVE_KEYS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowUp: -1,
  ArrowRight: 1,
  ArrowDown: 1,
};

const HOVER_REVEAL =
  "transition-opacity pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100";

const DRAG_ROLE_CLASS: Record<string, string> = {
  source: "opacity-40",
  target: "ring-2 ring-sky-400",
};

export function CameraCard({
  camera,
  protocol,
  mainStream,
  style,
  dragRole,
  onFullscreen,
  onDragStart,
  onMove,
}: CameraCardProps) {
  const [status, setStatus] = useState<CameraStatus>("connecting");
  const streams = camera.streams[protocol];
  const streamId = streams ? (mainStream ? streams.main : (streams.sub ?? streams.main)) : null;

  const handleTilePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse") return;
    if ((event.target as Element).closest("button")) return;
    onDragStart(event);
  };

  const handleMoveKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const delta = MOVE_KEYS[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    onMove(delta);
  };

  return (
    <div
      data-drag-key={camera.name}
      style={style}
      onPointerDown={handleTilePointerDown}
      className={`group relative overflow-hidden rounded-lg bg-gray-900 pointer-fine:cursor-grab ${
        dragRole ? DRAG_ROLE_CLASS[dragRole] : ""
      }`}
    >
      <div className="h-full">
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

      <button
        id={`move-${camera.name}`}
        type="button"
        onPointerDown={onDragStart}
        onKeyDown={handleMoveKey}
        className={`absolute left-2 top-2 cursor-grab touch-none rounded bg-black/60 p-1 text-white/80 hover:text-white focus-visible:outline-2 focus-visible:outline-sky-400 ${HOVER_REVEAL}`}
        aria-label={`Move ${camera.label}. Drag it, or use the arrow keys.`}
      >
        <GripIcon className="h-4 w-4" />
      </button>

      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-3 py-2">
        <span className="truncate text-sm font-medium text-white">{camera.label}</span>
        <button
          id={`fullscreen-${camera.name}`}
          onClick={() => onFullscreen(camera)}
          className={`rounded p-1 text-white/80 hover:text-white ${HOVER_REVEAL}`}
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
