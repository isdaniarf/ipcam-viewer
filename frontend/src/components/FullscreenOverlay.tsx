import { useEffect, useRef, useState } from "react";
import type { CameraStatus } from "../lib/camera-video";
import { PROTOCOL_LABELS, streamUrl, type Camera, type Protocol } from "../types/camera";
import { StreamStatus } from "./StreamStatus";
import { VideoPlayer } from "./VideoPlayer";

interface FullscreenOverlayProps {
  camera: Camera;
  protocol: Protocol;
  onClose: () => void;
}

const FOCUSABLE = 'button, [href], video[controls], [tabindex]:not([tabindex="-1"])';

export function FullscreenOverlay({ camera, protocol, onClose }: FullscreenOverlayProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState<CameraStatus>("connecting");
  const streams = camera.streams[protocol];

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const outside = !dialog.contains(active);

      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${camera.label}, fullscreen view`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black"
    >
      <button
        ref={closeRef}
        onClick={onClose}
        className="absolute right-4 top-4 z-10 rounded-full bg-black/60 p-2 text-white hover:bg-black/80 focus:outline-2 focus:outline-offset-2 focus:outline-white"
        aria-label="Close the fullscreen view"
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

      <div className="absolute left-4 top-4 z-10 flex items-center gap-3">
        <span className="rounded bg-black/60 px-3 py-1 text-sm font-medium text-white">
          {camera.label}
        </span>
        {streams && status !== "live" && <StreamStatus status={status} />}
      </div>

      {streams ? (
        <VideoPlayer
          src={streamUrl(streams.main)}
          media="video,audio"
          controls
          onStatusChange={setStatus}
          className="h-full w-full"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <span className="text-lg text-gray-500">
            {PROTOCOL_LABELS[protocol]} is not available for this camera.
          </span>
        </div>
      )}
    </div>
  );
}
