import { useMemo, useState } from "react";
import type { Camera, Protocol } from "./types/camera";
import { useCameras } from "./hooks/useCameras";
import { Header } from "./components/Header";
import { CameraGrid } from "./components/CameraGrid";
import { FullscreenOverlay } from "./components/FullscreenOverlay";

export default function App() {
  const { cameras, loading, error } = useCameras();
  const [fullscreen, setFullscreen] = useState<Camera | null>(null);
  const [selectedProtocol, setSelectedProtocol] = useState<Protocol>("rtsp");

  const availableProtocols = useMemo(() => {
    const set = new Set<Protocol>();
    for (const cam of cameras) {
      for (const p of cam.protocols) {
        set.add(p);
      }
    }
    return Array.from(set);
  }, [cameras]);

  return (
    <div className="min-h-screen bg-gray-950">
      <Header
        cameraCount={cameras.length}
        availableProtocols={availableProtocols}
        selectedProtocol={selectedProtocol}
        onProtocolChange={setSelectedProtocol}
      />

      {loading && (
        <p className="px-6 text-gray-400">Loading cameras...</p>
      )}

      {error && (
        <p className="px-6 text-red-400">
          Failed to load cameras: {error}
        </p>
      )}

      {!loading && !error && cameras.length === 0 && (
        <p className="px-6 text-gray-400">No cameras found.</p>
      )}

      <CameraGrid
        cameras={cameras}
        selectedProtocol={selectedProtocol}
        onFullscreen={setFullscreen}
      />

      {fullscreen && (
        <FullscreenOverlay
          camera={fullscreen}
          selectedProtocol={selectedProtocol}
          onClose={() => setFullscreen(null)}
        />
      )}
    </div>
  );
}
