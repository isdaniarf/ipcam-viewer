import { useEffect } from "react";
import type { Camera, Protocol } from "../types/camera";
import { VideoPlayer } from "./VideoPlayer";

interface FullscreenOverlayProps {
  camera: Camera;
  selectedProtocol: Protocol;
  onClose: () => void;
}

export function FullscreenOverlay({ camera, selectedProtocol, onClose }: FullscreenOverlayProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const label = camera.name.replace(/_/g, " ");
  const available = camera.protocols.includes(selectedProtocol);
  const streamName = `${camera.name}.${selectedProtocol}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
      <button
        onClick={onClose}
        className="absolute right-4 top-4 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
        aria-label="Close fullscreen"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-6 w-6"
        >
          <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
        </svg>
      </button>
      <div className="absolute left-4 top-4 z-10 rounded bg-black/50 px-3 py-1">
        <span className="text-sm font-medium capitalize text-white">
          {label}
        </span>
      </div>
      {available ? (
        <VideoPlayer
          src={`/api/ws?src=${streamName}`}
          className="h-full w-full"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <span className="text-lg text-gray-500">
            {selectedProtocol.toUpperCase()} not available for this camera
          </span>
        </div>
      )}
    </div>
  );
}
