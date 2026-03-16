export type Protocol = "rtsp" | "onvif" | "tapo";

export interface Camera {
  name: string;
  protocols: Protocol[];
}
