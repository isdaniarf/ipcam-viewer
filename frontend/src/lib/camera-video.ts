import { VideoRTC } from "./video-rtc.js";

export type CameraStatus = "connecting" | "live" | "offline";

export const CAMERA_STATUS_EVENT = "camerastatus";

const WEBRTC_RETRY_MIN_MS = 5000;
const WEBRTC_RETRY_MAX_MS = 60000;

export class CameraVideo extends VideoRTC {
  status: CameraStatus = "connecting";
  showControls = false;
  webrtcRetryTimer = 0;
  webrtcRetryDelay = WEBRTC_RETRY_MIN_MS;

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
        if (msg.type !== "error") return;
        if (msg.value.includes("webrtc/offer")) {
          this.scheduleWebrtcRetry();
        } else {
          this.setStatus("offline");
        }
      };
    }
    return modes;
  }

  scheduleWebrtcRetry(): void {
    if (this.webrtcRetryTimer) return;
    const delay = this.webrtcRetryDelay;
    this.webrtcRetryDelay = Math.min(delay * 2, WEBRTC_RETRY_MAX_MS);
    this.webrtcRetryTimer = window.setTimeout(() => {
      this.webrtcRetryTimer = 0;
      if (this.lifecycle.signal.aborted) return;
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (this.pc && this.pc.connectionState !== "closed") return;
      this.pc = null;
      this.onwebrtc();
    }, delay);
  }

  onpcvideo(video: HTMLVideoElement): void {
    super.onpcvideo(video);
    if (this.pcState === WebSocket.OPEN) this.webrtcRetryDelay = WEBRTC_RETRY_MIN_MS;
  }

  destroy(): void {
    if (this.webrtcRetryTimer) {
      window.clearTimeout(this.webrtcRetryTimer);
      this.webrtcRetryTimer = 0;
    }
    super.destroy();
  }

  onconnect(): boolean {
    const started = super.onconnect();
    if (started) {
      this.webrtcRetryDelay = WEBRTC_RETRY_MIN_MS;
      this.setStatus("connecting");
    }
    return started;
  }

  onclose(): boolean {
    const reconnecting = super.onclose();
    if (reconnecting) this.setStatus("offline");
    return reconnecting;
  }
}

customElements.define("camera-video", CameraVideo);
