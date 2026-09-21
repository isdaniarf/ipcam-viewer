export type Protocol = "rtsp" | "onvif" | "tapo";

export const PROTOCOLS: Protocol[] = ["rtsp", "onvif", "tapo"];

export const PROTOCOL_LABELS: Record<Protocol, string> = {
  rtsp: "RTSP",
  onvif: "ONVIF",
  tapo: "Tapo",
};

export interface StreamIds {
  main: string;
  sub?: string;
}

export interface Camera {
  name: string;
  label: string;
  route?: string;
  streams: Partial<Record<Protocol, StreamIds>>;
}

export function routeOf(pathname: string): string | null {
  const segment = pathname.replace(/^\/+|\/+$/g, "");
  return segment === "" || segment.includes("/") ? null : segment;
}

export function cameraForRoute(cameras: Camera[], pathname: string): Camera | null {
  const route = routeOf(pathname);
  if (route === null) return null;
  return cameras.find((camera) => camera.route === route) ?? null;
}

export function cameraProtocols(camera: Camera): Protocol[] {
  return PROTOCOLS.filter((protocol) => camera.streams[protocol] !== undefined);
}

export function streamUrl(id: string): string {
  return `/api/ws?src=${encodeURIComponent(id)}`;
}
