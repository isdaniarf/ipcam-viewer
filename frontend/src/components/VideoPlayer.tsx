import { useEffect, useRef } from "react";
import { CAMERA_STATUS_EVENT, CameraVideo, type CameraStatus } from "../lib/camera-video";

interface VideoPlayerProps {
  src: string;
  media?: string;
  controls?: boolean;
  visibilityThreshold?: number;
  className?: string;
  onStatusChange?: (status: CameraStatus) => void;
}

export function VideoPlayer({
  src,
  media = "video",
  controls = false,
  visibilityThreshold = 0,
  className,
  onStatusChange,
}: VideoPlayerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef(onStatusChange);

  useEffect(() => {
    statusRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const player = new CameraVideo();
    player.media = media;
    player.showControls = controls;
    player.visibilityThreshold = visibilityThreshold;

    const handleStatus = (event: Event) => {
      statusRef.current?.((event as CustomEvent<CameraStatus>).detail);
    };
    player.addEventListener(CAMERA_STATUS_EVENT, handleStatus);

    statusRef.current?.("connecting");
    player.src = src;
    host.appendChild(player);

    return () => {
      player.removeEventListener(CAMERA_STATUS_EVENT, handleStatus);
      player.remove();
      player.destroy();
    };
  }, [src, media, controls, visibilityThreshold]);

  return <div ref={hostRef} className={className} />;
}
