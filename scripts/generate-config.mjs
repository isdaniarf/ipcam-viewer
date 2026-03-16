import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import YAML from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const camerasFile = readFileSync(resolve(root, "cameras.yaml"), "utf-8");
const { cameras } = YAML.parse(camerasFile);

const streams = {};
for (const cam of cameras) {
  const user = encodeURIComponent(cam.username);
  const pass = encodeURIComponent(cam.password);
  const path = cam.path || "/stream1";

  // RTSP stream
  streams[`${cam.name}.rtsp`] = `rtsp://${user}:${pass}@${cam.host}:${cam.port}${path}`;

  // ONVIF stream
  streams[`${cam.name}.onvif`] = `onvif://${user}:${pass}@${cam.host}:2020`;

  // Tapo native stream (uses password only)
  streams[`${cam.name}.tapo`] = `tapo://${pass}@${cam.host}`;
}

function getLanIPs() {
  const ips = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        ips.push(`${addr.address}:8555`);
      }
    }
  }
  return ips;
}

function getWebRTCCandidates() {
  const hostIp = process.env.HOST_IP;
  if (hostIp) return [`${hostIp}:8555`];
  return getLanIPs();
}

const candidates = getWebRTCCandidates();

const go2rtcConfig = {
  streams,
  api: { listen: ":1984" },
  webrtc: { listen: ":8555", candidates },
};

const outDir = resolve(root, "go2rtc");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "go2rtc.yaml");
writeFileSync(outPath, YAML.stringify(go2rtcConfig));

console.log(`Generated ${outPath}`);
console.log(`Configured ${cameras.length} camera(s) × 3 protocols = ${Object.keys(streams).length} stream(s)`);
console.log(`Streams: ${Object.keys(streams).join(", ")}`);
console.log(`WebRTC candidates: ${candidates.join(", ")}`);
