import { useCallback, useEffect, useState } from "react";
import { PROTOCOLS, type Camera, type Protocol, type StreamIds } from "../types/camera";

const MANIFEST_URL = "/cameras.json";
const RETRY_DELAYS = [1000, 2000, 5000, 10000, 30000];

interface CamerasState {
  cameras: Camera[];
  loading: boolean;
  error: string | null;
}

function parseStreamIds(value: unknown): StreamIds | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.main !== "string") return undefined;
  const ids: StreamIds = { main: record.main };
  if (typeof record.sub === "string") ids.sub = record.sub;
  return ids;
}

function parseCamera(value: unknown): Camera | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string") return null;

  const source = (record.streams ?? {}) as Record<string, unknown>;
  const streams: Partial<Record<Protocol, StreamIds>> = {};
  for (const protocol of PROTOCOLS) {
    const ids = parseStreamIds(source[protocol]);
    if (ids) streams[protocol] = ids;
  }
  if (Object.keys(streams).length === 0) return null;

  const label = typeof record.label === "string" ? record.label : record.name;
  const camera: Camera = { name: record.name, label, streams };
  if (typeof record.route === "string" && record.route !== "") camera.route = record.route;
  return camera;
}

function parseManifest(value: unknown): Camera[] {
  if (!value || typeof value !== "object") return [];
  const list = (value as Record<string, unknown>).cameras;
  if (!Array.isArray(list)) return [];
  return list.map(parseCamera).filter((camera): camera is Camera => camera !== null);
}

export function useCameras() {
  const [state, setState] = useState<CamerasState>({ cameras: [], loading: true, error: null });
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let retryTimer = 0;
    let attempt = 0;

    const load = async () => {
      try {
        const response = await fetch(MANIFEST_URL, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setState({ cameras: parseManifest(await response.json()), loading: false, error: null });
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        setState((previous) => ({ ...previous, loading: false, error: message }));
        const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
        attempt += 1;
        retryTimer = window.setTimeout(load, delay);
      }
    };

    setState((previous) => ({ ...previous, loading: true }));
    void load();

    return () => {
      controller.abort();
      window.clearTimeout(retryTimer);
    };
  }, [reloadCount]);

  const reload = useCallback(() => setReloadCount((count) => count + 1), []);

  return { ...state, reload };
}
