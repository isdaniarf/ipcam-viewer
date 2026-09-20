export const PROTOCOLS = ["rtsp", "onvif", "tapo"];
export const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
export const DEFAULT_PORT = { rtsp: 554, onvif: 80 };
export const DEFAULT_SERVER = { listen: ":80", username: "viewer" };

export function toLabel(name) {
  return name
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function auth(user, pass) {
  const password = encodeURIComponent(pass);
  if (user === undefined || user === null || user === "") return password;
  return `${encodeURIComponent(user)}:${password}`;
}

function requireText(value, field, where, errors) {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number") return String(value);
  errors.push(`${where} needs \`${field}\`.`);
  return null;
}

function legacyBlocks(camera, where, warnings) {
  if (camera.port === undefined && camera.path === undefined) return null;
  warnings.push(
    `${where} uses the old flat format. Move \`port\` and \`path\` into an \`rtsp:\` block. ONVIF and Tapo are now off for this camera.`,
  );
  return { rtsp: { port: camera.port, path: camera.path } };
}

function buildRtsp(camera, block, where, streams, entry, errors) {
  const user = block.username ?? camera.username;
  const pass = block.password ?? camera.password;
  const port = block.port ?? DEFAULT_PORT.rtsp;
  const path = requireText(block.path, "rtsp.path", where, errors);
  if (requireText(user, "username", where, errors) === null) return;
  if (requireText(pass, "password", where, errors) === null) return;
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

function buildOnvif(camera, block, where, streams, entry, errors) {
  const user = block.username ?? camera.username;
  const pass = block.password ?? camera.password;
  const port = block.port ?? DEFAULT_PORT.onvif;
  if (requireText(user, "username", where, errors) === null) return;
  if (requireText(pass, "password", where, errors) === null) return;

  const main = `${camera.name}.onvif`;
  streams[main] = `onvif://${auth(user, pass)}@${camera.host}:${port}`;
  entry.onvif = { main };
}

function buildTapo(camera, block, where, streams, entry, errors) {
  const pass = block.password;
  if (pass === undefined) {
    errors.push(
      `${where} needs \`tapo.password\`. Tapo uses the TP-Link cloud password, which is not the RTSP password.`,
    );
    return;
  }
  if (requireText(pass, "tapo.password", where, errors) === null) return;

  const main = `${camera.name}.tapo`;
  streams[main] = `tapo://${auth(block.username, pass)}@${camera.host}`;
  entry.tapo = { main };
}

const BUILDERS = { rtsp: buildRtsp, onvif: buildOnvif, tapo: buildTapo };

export function buildCameras(cameras, errors, warnings) {
  const streams = {};
  const manifest = [];
  const seen = new Set();

  cameras.forEach((camera, index) => {
    const where = camera && camera.name ? `camera "${camera.name}"` : `camera #${index + 1}`;
    if (!camera || typeof camera !== "object") {
      errors.push(`${where} must be a mapping.`);
      return;
    }
    if (requireText(camera.name, "name", where, errors) === null) return;
    if (!NAME_PATTERN.test(camera.name)) {
      errors.push(`${where} has an invalid name. Use letters, digits, "_" and "-" only.`);
      return;
    }
    if (seen.has(camera.name)) {
      errors.push(`${where} is a duplicate name.`);
      return;
    }
    seen.add(camera.name);
    if (requireText(camera.host, "host", where, errors) === null) return;

    const blocks = {};
    for (const protocol of PROTOCOLS) {
      if (camera[protocol] === undefined || camera[protocol] === null) continue;
      blocks[protocol] = camera[protocol] === true ? {} : camera[protocol];
    }

    const enabled = Object.keys(blocks).length > 0 ? blocks : legacyBlocks(camera, where, warnings);
    if (!enabled) {
      errors.push(`${where} enables no protocol. Add an \`rtsp:\`, \`onvif:\` or \`tapo:\` block.`);
      return;
    }

    const entry = {};
    for (const protocol of PROTOCOLS) {
      if (!enabled[protocol]) continue;
      BUILDERS[protocol](camera, enabled[protocol], where, streams, entry, errors);
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

export function buildServer(server, errors) {
  const block = server && typeof server === "object" ? server : {};
  const listen = block.listen ?? DEFAULT_SERVER.listen;
  const username = block.username ?? DEFAULT_SERVER.username;
  const password = block.password;
  if (typeof password !== "string" || password.length === 0) {
    errors.push(
      "`server.password` is missing. The native server needs a viewer password, because the go2rtc API shows the camera passwords to every client without one.",
    );
  }
  return { listen: String(listen), username: String(username), password };
}

export function buildGo2rtcConfig({ streams, api, candidates }) {
  const webrtc = { listen: ":8555", ice_servers: [] };
  if (candidates && candidates.length > 0) webrtc.candidates = candidates;
  return { streams, api, webrtc };
}

export function manifestJson(manifest) {
  return `${JSON.stringify({ cameras: manifest }, null, 2)}\n`;
}
