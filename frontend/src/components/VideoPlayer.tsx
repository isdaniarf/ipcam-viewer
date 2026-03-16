import { useEffect, useRef } from "react";
import "../lib/video-rtc.js";

interface VideoPlayerProps {
  src: string;
  className?: string;
}

export function VideoPlayer({ src, className }: VideoPlayerProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current as any;
    if (!el) return;
    el.mode = "webrtc,mse,hls";
    el.media = "video,audio";
    el.src = src;
  }, [src]);

  return <video-rtc ref={ref} className={className} />;
}
