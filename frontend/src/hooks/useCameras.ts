import { useEffect, useState } from "react";
import type { Camera, Protocol } from "../types/camera";

const KNOWN_PROTOCOLS: Protocol[] = ["rtsp", "onvif", "tapo"];

export function useCameras() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/streams")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const keys = Object.keys(data);
        const grouped = new Map<string, Protocol[]>();

        for (const key of keys) {
          const dotIdx = key.lastIndexOf(".");
          if (dotIdx === -1) continue;
          const name = key.slice(0, dotIdx);
          const proto = key.slice(dotIdx + 1) as Protocol;
          if (!KNOWN_PROTOCOLS.includes(proto)) continue;

          const existing = grouped.get(name);
          if (existing) {
            existing.push(proto);
          } else {
            grouped.set(name, [proto]);
          }
        }

        const result: Camera[] = [];
        for (const [name, protocols] of grouped) {
          result.push({ name, protocols });
        }
        setCameras(result);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return { cameras, loading, error };
}
