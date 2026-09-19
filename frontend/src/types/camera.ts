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
  streams: Partial<Record<Protocol, StreamIds>>;
}

export function cameraProtocols(camera: Camera): Protocol[] {
  return PROTOCOLS.filter((protocol) => camera.streams[protocol] !== undefined);
}

export function streamUrl(id: string): string {
  return `/api/ws?src=${encodeURIComponent(id)}`;
}
