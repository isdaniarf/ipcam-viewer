import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PROTOCOLS,
  cameraForRoute,
  cameraProtocols,
  type Camera,
  type Protocol,
} from "./types/camera";
import { useCameras } from "./hooks/useCameras";
import { useLayoutSettings } from "./hooks/useLayoutSettings";
import {
  arrangeCameras,
  keepUnknownNames,
  moveName,
  shiftName,
  swapNames,
} from "./lib/arrangement";
import { Header } from "./components/Header";
import { LayoutToolbar } from "./components/LayoutToolbar";
import { ArrangePanel } from "./components/ArrangePanel";
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
  const { settings, updateSettings } = useLayoutSettings();
  const [pageIndex, setPageIndex] = useState(0);
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const arranged = useMemo(
    () => arrangeCameras(cameras, settings.order),
    [cameras, settings.order],
  );
  const hidden = useMemo(() => new Set(settings.hidden), [settings.hidden]);
  const shown = useMemo(
    () => arranged.filter((camera) => !hidden.has(camera.name)),
    [arranged, hidden],
  );
  const pageSize = settings.pageSize ?? Math.max(shown.length, 1);
  const pageCount = Math.max(1, Math.ceil(shown.length / pageSize));
  const page = Math.min(pageIndex, pageCount - 1);
  const pageCameras = shown.slice(page * pageSize, (page + 1) * pageSize);

  const saveOrder = useCallback(
    (names: string[]) => updateSettings({ order: keepUnknownNames(names, settings.order) }),
    [settings.order, updateSettings],
  );

  const labelOf = useCallback(
    (name: string) => cameras.find((camera) => camera.name === name)?.label ?? name,
    [cameras],
  );

  const swapCameras = useCallback(
    (name: string, otherName: string) => {
      saveOrder(swapNames(arranged.map((camera) => camera.name), name, otherName));
      setAnnouncement(`${labelOf(name)} and ${labelOf(otherName)} changed places.`);
    },
    [arranged, labelOf, saveOrder],
  );

  const moveShownCamera = useCallback(
    (name: string, delta: number) => {
      const from = shown.findIndex((camera) => camera.name === name);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= shown.length) return;
      saveOrder(swapNames(arranged.map((camera) => camera.name), name, shown[to].name));
      setPageIndex(Math.floor(to / pageSize));
      setAnnouncement(`${labelOf(name)} is now at position ${to + 1} of ${shown.length}.`);
      requestAnimationFrame(() => document.getElementById(`move-${name}`)?.focus());
    },
    [arranged, labelOf, pageSize, saveOrder, shown],
  );

  const reorderCamera = useCallback(
    (name: string, target: string, after: boolean) =>
      saveOrder(moveName(arranged.map((camera) => camera.name), name, target, after)),
    [arranged, saveOrder],
  );

  const shiftCamera = useCallback(
    (name: string, delta: number) =>
      saveOrder(shiftName(arranged.map((camera) => camera.name), name, delta)),
    [arranged, saveOrder],
  );

  const toggleHidden = useCallback(
    (name: string) =>
      updateSettings({
        hidden: hidden.has(name)
          ? settings.hidden.filter((other) => other !== name)
          : [...settings.hidden, name],
      }),
    [hidden, settings.hidden, updateSettings],
  );

  const resetArrangement = useCallback(
    () => updateSettings({ order: [], hidden: [] }),
    [updateSettings],
  );

  const changePageSize = useCallback(
    (next: number | null) => {
      updateSettings({ pageSize: next });
      setPageIndex(0);
    },
    [updateSettings],
  );

  const closeArrange = useCallback(() => setArrangeOpen(false), []);

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
    setArrangeOpen(false);
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
    <div className="flex h-dvh flex-col bg-gray-950">
      <Header
        cameraCount={cameras.length}
        availableProtocols={availableProtocols}
        selectedProtocol={protocol}
        onProtocolChange={selectProtocol}
      />

      {cameras.length > 1 && (
        <LayoutToolbar
          layout={settings.layout}
          pageSize={settings.pageSize}
          fit={settings.fit}
          page={page}
          pageCount={pageCount}
          arrangeOpen={arrangeOpen}
          onLayoutChange={(layout) => updateSettings({ layout })}
          onPageSizeChange={changePageSize}
          onFitChange={(fit) => updateSettings({ fit })}
          onPageChange={setPageIndex}
          onArrangeToggle={() => setArrangeOpen((open) => !open)}
        />
      )}

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

      {cameras.length > 0 && shown.length === 0 && (
        <p className="px-6 pb-4 text-gray-400">
          All cameras are hidden. Click Arrange to show a camera.
        </p>
      )}

      {!fullscreenCamera && (
        <CameraGrid
          cameras={pageCameras}
          protocol={protocol}
          layout={settings.layout}
          fit={settings.fit}
          onFullscreen={openFullscreen}
          onSwap={swapCameras}
          onMove={moveShownCamera}
        />
      )}

      {arrangeOpen && cameras.length > 1 && (
        <ArrangePanel
          cameras={arranged}
          hidden={hidden}
          pageSize={settings.pageSize}
          onClose={closeArrange}
          onReorder={reorderCamera}
          onShift={shiftCamera}
          onToggleHidden={toggleHidden}
          onReset={resetArrangement}
        />
      )}

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

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
