import { VideoRTC } from "./video-rtc.js";

export type CameraStatus = "connecting" | "live" | "offline";

export const CAMERA_STATUS_EVENT = "camerastatus";

export class CameraVideo extends VideoRTC {
  status: CameraStatus = "connecting";
  showControls = false;

  constructor() {
    super();
    this.mode = "webrtc,mse,hls";
    this.media = "video";
    this.pcConfig = {
      bundlePolicy: "max-bundle",
      iceServers: [],
    } as RTCConfiguration;
  }

  setStatus(status: CameraStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.dispatchEvent(new CustomEvent<CameraStatus>(CAMERA_STATUS_EVENT, { detail: status }));
  }

  oninit(): void {
    super.oninit();

    this.video.controls = this.showControls;
    this.video.muted = !this.media.includes("audio");
    this.video.disablePictureInPicture = !this.showControls;

    const { signal } = this.lifecycle;
    this.video.addEventListener("playing", () => this.setStatus("live"), { signal });
    this.video.addEventListener("waiting", () => this.setStatus("connecting"), { signal });
    this.video.addEventListener("error", () => this.setStatus("offline"), { signal });
  }

  onopen(): string[] {
    const modes = super.onopen();
    if (this.onmessage) {
      this.onmessage.status = (msg) => {
        if (msg.type === "error") this.setStatus("offline");
      };
    }
    return modes;
  }

  onconnect(): boolean {
    const started = super.onconnect();
    if (started) this.setStatus("connecting");
    return started;
  }

  onclose(): boolean {
    const reconnecting = super.onclose();
    if (reconnecting) this.setStatus("offline");
    return reconnecting;
  }
}

customElements.define("camera-video", CameraVideo);
