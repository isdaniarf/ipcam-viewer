import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import YAML from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const PROTOCOLS = ["rtsp", "onvif", "tapo"];
const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const DEFAULT_PORT = { rtsp: 554, onvif: 80 };

const errors = [];
const warnings = [];

function readCameras() {
  const file = resolve(root, "cameras.yaml");
  if (!existsSync(file)) {
    errors.push("cameras.yaml does not exist. Copy cameras.yaml.example to cameras.yaml.");
    return [];
  }
  const parsed = YAML.parse(readFileSync(file, "utf-8"));
  if (!parsed || !Array.isArray(parsed.cameras) || parsed.cameras.length === 0) {
    errors.push("cameras.yaml must contain a non-empty `cameras` list.");
    return [];
  }
  return parsed.cameras;
}

function toLabel(name) {
  return name
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function auth(user, pass) {
  const password = encodeURIComponent(pass);
  if (user === undefined || user === null || user === "") return password;
  return `${encodeURIComponent(user)}:${password}`;
}

function legacyBlocks(camera, where) {
  if (camera.port === undefined && camera.path === undefined) return null;
  warnings.push(
    `${where} uses the old flat format. Move \`port\` and \`path\` into an \`rtsp:\` block. ONVIF and Tapo are now off for this camera.`,
  );
  return { rtsp: { port: camera.port, path: camera.path } };
}

function requireText(value, field, where) {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number") return String(value);
  errors.push(`${where} needs \`${field}\`.`);
  return null;
}

function buildRtsp(camera, block, where, streams, entry) {
  const user = block.username ?? camera.username;
  const pass = block.password ?? camera.password;
  const port = block.port ?? DEFAULT_PORT.rtsp;
  const path = requireText(block.path, "rtsp.path", where);
  if (requireText(user, "username", where) === null) return;
  if (requireText(pass, "password", where) === null) return;
  if (path === null) return;

  const base = `rtsp://${auth(user, pass)}@${camera.host}:${port}`;
  const main = `${camera.name}.rtsp`;
  streams[main] = `${base}${path}`;
  entry.rtsp = { main };

  if (block.sub_path) {
    const sub = `${camera.name}.rtsp.sub`;
    streams[sub] = `${base}${block.sub_path}`;
    entry.rtsp.sub = sub;
  }
}

function buildOnvif(camera, block, where, streams, entry) {
  const user = block.username ?? camera.username;
  const pass = block.password ?? camera.password;
  const port = block.port ?? DEFAULT_PORT.onvif;
  if (requireText(user, "username", where) === null) return;
  if (requireText(pass, "password", where) === null) return;

  const main = `${camera.name}.onvif`;
  streams[main] = `onvif://${auth(user, pass)}@${camera.host}:${port}`;
  entry.onvif = { main };
}

function buildTapo(camera, block, where, streams, entry) {
  const pass = block.password;
  if (pass === undefined) {
    errors.push(
      `${where} needs \`tapo.password\`. Tapo uses the TP-Link cloud password, which is not the RTSP password.`,
    );
    return;
  }
  if (requireText(pass, "tapo.password", where) === null) return;

  const main = `${camera.name}.tapo`;
  streams[main] = `tapo://${auth(block.username, pass)}@${camera.host}`;
  entry.tapo = { main };
}

const BUILDERS = { rtsp: buildRtsp, onvif: buildOnvif, tapo: buildTapo };

function build(cameras) {
  const streams = {};
  const manifest = [];
  const seen = new Set();

  cameras.forEach((camera, index) => {
    const where = camera && camera.name ? `camera "${camera.name}"` : `camera #${index + 1}`;
    if (!camera || typeof camera !== "object") {
      errors.push(`${where} must be a mapping.`);
      return;
    }
    if (requireText(camera.name, "name", where) === null) return;
    if (!NAME_PATTERN.test(camera.name)) {
      errors.push(`${where} has an invalid name. Use letters, digits, "_" and "-" only.`);
      return;
    }
    if (seen.has(camera.name)) {
      errors.push(`${where} is a duplicate name.`);
      return;
    }
    seen.add(camera.name);
    if (requireText(camera.host, "host", where) === null) return;

    const blocks = {};
    for (const protocol of PROTOCOLS) {
      if (camera[protocol] === undefined || camera[protocol] === null) continue;
      blocks[protocol] = camera[protocol] === true ? {} : camera[protocol];
    }

    const enabled = Object.keys(blocks).length > 0 ? blocks : legacyBlocks(camera, where);
    if (!enabled) {
      errors.push(`${where} enables no protocol. Add an \`rtsp:\`, \`onvif:\` or \`tapo:\` block.`);
      return;
    }

    const entry = {};
    for (const protocol of PROTOCOLS) {
      if (!enabled[protocol]) continue;
      BUILDERS[protocol](camera, enabled[protocol], where, streams, entry);
    }
    if (Object.keys(entry).length === 0) return;

    manifest.push({
      name: camera.name,
      label: camera.label ?? toLabel(camera.name),
      streams: entry,
    });
  });

  return { streams, manifest };
}

function lanAddresses() {
  const addresses = [];
  for (const group of Object.values(networkInterfaces())) {
    for (const address of group ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        addresses.push(`${address.address}:8555`);
      }
    }
  }
  return addresses;
}

function webrtcCandidates() {
  const hostIp = process.env.HOST_IP;
  if (hostIp) return [`${hostIp}:8555`];
  return lanAddresses();
}

const cameras = readCameras();
const { streams, manifest } = build(cameras);

for (const warning of warnings) console.warn(`warning: ${warning}`);

if (errors.length > 0) {
  for (const message of errors) console.error(`error: ${message}`);
  console.error(`Wrote no files. Correct ${errors.length} problem(s) in cameras.yaml.`);
  process.exit(1);
}

const candidates = webrtcCandidates();
if (candidates.length === 0) {
  console.warn("warning: found no LAN address for WebRTC. Set HOST_IP to your LAN IP.");
}

const go2rtcConfig = {
  streams,
  api: { listen: ":1984" },
  webrtc: { listen: ":8555", candidates, ice_servers: [] },
};

const outDir = resolve(root, "go2rtc");
mkdirSync(outDir, { recursive: true });

const configPath = resolve(outDir, "go2rtc.yaml");
writeFileSync(configPath, YAML.stringify(go2rtcConfig));

const manifestJson = `${JSON.stringify({ cameras: manifest }, null, 2)}\n`;
const manifestPaths = [resolve(outDir, "cameras.json")];
if (existsSync(resolve(root, "frontend"))) {
  const publicDir = resolve(root, "frontend", "public");
  mkdirSync(publicDir, { recursive: true });
  manifestPaths.push(resolve(publicDir, "cameras.json"));
}
for (const path of manifestPaths) writeFileSync(path, manifestJson);

const streamCount = Object.keys(streams).length;
console.log(`Wrote ${configPath}`);
for (const path of manifestPaths) console.log(`Wrote ${path}`);
console.log(`Configured ${manifest.length} camera(s) and ${streamCount} stream(s).`);
for (const camera of manifest) {
  const parts = Object.entries(camera.streams).map(([protocol, ids]) =>
    ids.sub ? `${protocol} (+sub)` : protocol,
  );
  console.log(`  ${camera.name}: ${parts.join(", ")}`);
}
console.log(`WebRTC candidates: ${candidates.join(", ") || "none"}`);
