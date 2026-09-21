import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PROTOCOLS,
  cameraForRoute,
  cameraProtocols,
  type Camera,
  type Protocol,
} from "./types/camera";
import { useCameras } from "./hooks/useCameras";
import { Header } from "./components/Header";
import { CameraGrid } from "./components/CameraGrid";
import { FullscreenOverlay } from "./components/FullscreenOverlay";

const PROTOCOL_STORAGE_KEY = "ipcam-viewer.protocol";

function readStoredProtocol(): Protocol | null {
  try {
    const stored = localStorage.getItem(PROTOCOL_STORAGE_KEY);
    return PROTOCOLS.includes(stored as Protocol) ? (stored as Protocol) : null;
  } catch (error) {
    console.warn("The browser blocked localStorage.", error);
    return null;
  }
}

function storeProtocol(protocol: Protocol): void {
  try {
    localStorage.setItem(PROTOCOL_STORAGE_KEY, protocol);
  } catch (error) {
    console.warn("The browser blocked localStorage.", error);
  }
}

function pathFor(camera: Camera | null): string {
  return camera && camera.route ? `/${camera.route}/` : "/";
}

export default function App() {
  const { cameras, loading, error, reload } = useCameras();
  const [fullscreenName, setFullscreenName] = useState<string | null>(null);
  const [preferredProtocol, setPreferredProtocol] = useState<Protocol | null>(readStoredProtocol);
  const [path, setPath] = useState(() => window.location.pathname);
  const openerName = useRef<string | null>(null);

  const availableProtocols = useMemo(() => {
    const found = new Set<Protocol>();
    for (const camera of cameras) {
      for (const protocol of cameraProtocols(camera)) found.add(protocol);
    }
    return PROTOCOLS.filter((protocol) => found.has(protocol));
  }, [cameras]);

  const protocol =
    preferredProtocol && availableProtocols.includes(preferredProtocol)
      ? preferredProtocol
      : (availableProtocols[0] ?? "rtsp");

  const selectProtocol = useCallback((next: Protocol) => {
    setPreferredProtocol(next);
    storeProtocol(next);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setPath(window.location.pathname);
      setFullscreenName(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const openFullscreen = useCallback((camera: Camera) => {
    openerName.current = camera.name;
    if (camera.route) {
      const next = pathFor(camera);
      window.history.pushState({}, "", next);
      setPath(next);
      setFullscreenName(null);
    } else {
      setFullscreenName(camera.name);
    }
  }, []);

  const closeFullscreen = useCallback(() => {
    setFullscreenName(null);
    if (window.location.pathname !== "/") {
      window.history.pushState({}, "", "/");
      setPath("/");
    }
  }, []);

  const routeCamera = cameraForRoute(cameras, path);
  const fullscreenCamera =
    routeCamera ??
    (fullscreenName ? (cameras.find((camera) => camera.name === fullscreenName) ?? null) : null);

  useEffect(() => {
    if (fullscreenCamera !== null) return;
    const name = openerName.current;
    if (name === null) return;
    openerName.current = null;
    document.getElementById(`fullscreen-${name}`)?.focus();
  }, [fullscreenCamera]);

  const unknownRoute =
    !loading && !error && cameras.length > 0 && path !== "/" && cameraForRoute(cameras, path) === null;

  return (
    <div className="min-h-screen bg-gray-950">
      <Header
        cameraCount={cameras.length}
        availableProtocols={availableProtocols}
        selectedProtocol={protocol}
        onProtocolChange={selectProtocol}
      />

      {loading && <p className="px-6 pb-4 text-gray-400">It loads the cameras...</p>}

      {error && (
        <div className="flex flex-wrap items-center gap-3 px-6 pb-4">
          <p className="text-red-400">The camera list did not load: {error}</p>
          <button
            onClick={reload}
            className="rounded-md bg-gray-800 px-3 py-1 text-sm font-medium text-gray-100 hover:bg-gray-700"
          >
            Retry
          </button>
        </div>
      )}

      {unknownRoute && (
        <p className="px-6 pb-4 text-gray-400">
          No camera uses the address {path}. It shows every camera instead.
        </p>
      )}

      {!loading && !error && cameras.length === 0 && (
        <p className="px-6 pb-4 text-gray-400">It found no camera.</p>
      )}

      {!fullscreenCamera && (
        <CameraGrid cameras={cameras} protocol={protocol} onFullscreen={openFullscreen} />
      )}

      {fullscreenCamera && (
        <FullscreenOverlay
          camera={fullscreenCamera}
          protocol={protocol}
          onClose={closeFullscreen}
        />
      )}
    </div>
  );
}
