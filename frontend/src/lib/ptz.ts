const PTZ_URL = "/api/ptz";

export const PRESET_NAME_LIMIT = 40;
export const UNSAFE_PRESET_CHARACTERS = /[<>&]/;

export interface Preset {
  token: string;
  name: string;
}

export type PTZCommand =
  | { action: "move"; pan: number; tilt: number }
  | { action: "stop" }
  | { action: "goto"; preset: string }
  | { action: "save"; name: string }
  | { action: "remove"; preset: string };

function parsePresets(value: unknown): Preset[] | null {
  if (!value || typeof value !== "object") return null;
  const list = (value as Record<string, unknown>).presets;
  if (!Array.isArray(list)) return null;
  return list.filter(
    (item): item is Preset =>
      !!item && typeof item.token === "string" && typeof item.name === "string",
  );
}

async function problemOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body.error === "string") return body.error;
  } catch {
    return `HTTP ${response.status}`;
  }
  return `HTTP ${response.status}`;
}

function isJson(response: Response): boolean {
  return response.headers.get("Content-Type")?.startsWith("application/json") ?? false;
}

export async function fetchPresets(camera: string, signal: AbortSignal): Promise<Preset[] | null> {
  const response = await fetch(`${PTZ_URL}?camera=${encodeURIComponent(camera)}`, {
    signal,
    cache: "no-store",
  });
  if (!response.ok || !isJson(response)) return null;
  return parsePresets(await response.json());
}

export async function sendPTZ(camera: string, command: PTZCommand): Promise<Preset[] | null> {
  const response = await fetch(PTZ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ camera, ...command }),
  });
  if (!response.ok) throw new Error(await problemOf(response));
  if (response.status === 204 || !isJson(response)) return null;
  return parsePresets(await response.json());
}
