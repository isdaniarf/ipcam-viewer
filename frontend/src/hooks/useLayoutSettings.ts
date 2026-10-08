import { useCallback, useEffect, useState } from "react";
import { LAYOUT_IDS, type LayoutId } from "../lib/layouts";

const SETTINGS_STORAGE_KEY = "ipcam-viewer.layout";

export const PAGE_SIZES = [1, 2, 3, 4, 6, 8, 9, 12, 16];

export interface LayoutSettings {
  layout: LayoutId;
  pageSize: number | null;
  fit: boolean;
  order: string[];
  hidden: string[];
}

const DEFAULT_SETTINGS: LayoutSettings = {
  layout: "grid",
  pageSize: null,
  fit: true,
  order: [],
  hidden: [],
};

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string"))];
}

function parseSettings(value: unknown): LayoutSettings {
  if (!value || typeof value !== "object") return DEFAULT_SETTINGS;
  const record = value as Record<string, unknown>;
  return {
    layout: LAYOUT_IDS.includes(record.layout as LayoutId)
      ? (record.layout as LayoutId)
      : DEFAULT_SETTINGS.layout,
    pageSize: PAGE_SIZES.includes(record.pageSize as number) ? (record.pageSize as number) : null,
    fit: typeof record.fit === "boolean" ? record.fit : DEFAULT_SETTINGS.fit,
    order: uniqueStrings(record.order),
    hidden: uniqueStrings(record.hidden),
  };
}

function readStoredSettings(): LayoutSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    return stored ? parseSettings(JSON.parse(stored)) : DEFAULT_SETTINGS;
  } catch (error) {
    console.warn("The stored layout did not load.", error);
    return DEFAULT_SETTINGS;
  }
}

export function useLayoutSettings() {
  const [settings, setSettings] = useState<LayoutSettings>(readStoredSettings);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.warn("The browser blocked localStorage.", error);
    }
  }, [settings]);

  const updateSettings = useCallback((patch: Partial<LayoutSettings>) => {
    setSettings((previous) => ({ ...previous, ...patch }));
  }, []);

  return { settings, updateSettings };
}
