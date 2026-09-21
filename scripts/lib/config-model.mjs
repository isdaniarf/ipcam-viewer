export const PROTOCOLS = ["rtsp", "onvif", "tapo"];
export const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
export const DEFAULT_PORT = { rtsp: 554, onvif: 80 };
export const DEFAULT_SERVER = { listen: ":80", username: "viewer" };
export const DEFAULT_ALLOW_PATHS = ["/", "/assets", "/cameras.json", "/api/ws", "/api/hls"];
export const VIEW_PREFIX = "view:";
export const VIEW_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const VIEW_KEYS = new Set(["listen", "username", "password", "cameras", "webrtc", "allow_paths"]);
const PROXY_KEYS = new Set(["listen", "realm", "tls_listen", "tls_cert", "tls_key"]);
export const LOOPBACK = "127.0.0.1";

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

  const base = `onvif://${auth(user, pass)}@${camera.host}:${port}`;
  const main = `${camera.name}.onvif`;
  streams[main] = block.profile ? `${base}?subtype=${block.profile}` : base;
  entry.onvif = { main };

  if (block.sub_profile) {
    const sub = `${camera.name}.onvif.sub`;
    streams[sub] = `${base}?subtype=${block.sub_profile}`;
    entry.onvif.sub = sub;
  }
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
  const routes = new Set();

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

    if (camera.route !== undefined) {
      if (!ROUTE_PATTERN.test(camera.route)) {
        errors.push(`${where} has an invalid route. Use letters, digits, "_" and "-" only.`);
        return;
      }
      if (RESERVED_ROUTES.has(camera.route)) {
        errors.push(`${where} uses the reserved route "${camera.route}".`);
        return;
      }
      if (routes.has(camera.route)) {
        errors.push(`${where} repeats the route "${camera.route}".`);
        return;
      }
      routes.add(camera.route);
    }

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

    const record = { name: camera.name, label: camera.label ?? toLabel(camera.name) };
    if (camera.route !== undefined) record.route = camera.route;
    record.streams = entry;
    manifest.push(record);
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
  const allowPaths = block.allow_paths && block.allow_paths.length > 0
    ? block.allow_paths
    : DEFAULT_ALLOW_PATHS;
  return { listen: String(listen), username: String(username), password, allowPaths };
}

// `rtspListen` is "" for a view. Every go2rtc falls back to :8554 when the
// config names no RTSP port, so two servers on one host race for it and the
// loser logs "bind: address already in use". A view serves a browser and needs
// no RTSP server of its own, so it turns the listener off instead.
export function buildGo2rtcConfig({ streams, api, candidates, webrtcListen, rtspListen }) {
  const webrtc = { listen: webrtcListen ?? ":8555", ice_servers: [] };
  if (candidates && candidates.length > 0) webrtc.candidates = candidates;
  return { streams, api, rtsp: { listen: rtspListen ?? ":8554" }, webrtc };
}

export function manifestJson(manifest) {
  return `${JSON.stringify({ cameras: manifest }, null, 2)}\n`;
}

const SERVER_KEYS = new Set(["listen", "username", "password", "candidates", "allow_paths"]);
const CAMERA_KEYS = new Set(["label", "host", "username", "password", "route"]);
export const ROUTE_PATTERN = /^[A-Za-z0-9_-]+$/;
export const RESERVED_ROUTES = new Set(["api", "assets", "index.html", "cameras.json"]);
const PROTOCOL_KEYS = {
  rtsp: new Set(["port", "path", "sub_path", "username", "password"]),
  onvif: new Set(["port", "profile", "sub_profile", "username", "password"]),
  tapo: new Set(["username", "password"]),
};
const ENABLE_WORDS = new Set(["", "on", "yes", "true", "1"]);
const DISABLE_WORDS = new Set(["off", "no", "false", "0"]);

function viewFromSection(section, errors) {
  const name = section.name.slice(VIEW_PREFIX.length);
  if (!VIEW_NAME_PATTERN.test(name)) {
    errors.push(`line ${section.line}: invalid view name "${name}". Use letters, digits, "_" and "-".`);
    return null;
  }
  const view = { name, line: section.line };
  for (const [key, { value, line }] of section.entries) {
    if (!VIEW_KEYS.has(key)) {
      errors.push(`line ${line}: unknown key "${key}" in [view:${name}]`);
      continue;
    }
    if (value === "") {
      errors.push(`line ${line}: "${key}" has no value`);
      continue;
    }
    view[key] = key === "cameras" || key === "allow_paths"
      ? value.split(",").map((item) => item.trim()).filter(Boolean)
      : value;
  }
  return view;
}

export function configFromIni(sections, errors) {
  let server = null;
  let proxy = null;
  const cameras = [];
  const views = [];

  for (const section of sections) {
    if (section.name === "proxy") {
      proxy = {};
      for (const [key, { value, line }] of section.entries) {
        if (!PROXY_KEYS.has(key)) {
          errors.push(`line ${line}: unknown key "${key}" in [proxy]`);
          continue;
        }
        if (value === "") {
          errors.push(`line ${line}: "${key}" has no value`);
          continue;
        }
        proxy[key] = value;
      }
      continue;
    }
    if (section.name.startsWith(VIEW_PREFIX)) {
      const view = viewFromSection(section, errors);
      if (view) views.push(view);
      continue;
    }
    if (section.name === "server") {
      server = {};
      for (const [key, { value, line }] of section.entries) {
        if (!SERVER_KEYS.has(key)) {
          errors.push(`line ${line}: unknown key "${key}" in [server]`);
          continue;
        }
        if (value === "") {
          errors.push(`line ${line}: "${key}" has no value`);
          continue;
        }
        server[key] = key === "candidates" || key === "allow_paths"
          ? value.split(",").map((item) => item.trim()).filter(Boolean)
          : value;
      }
      continue;
    }

    const camera = { name: section.name };
    const enabled = {};
    for (const [key, { value, line }] of section.entries) {
      const dot = key.indexOf(".");
      if (value === "" && !(dot === -1 && key in PROTOCOL_KEYS)) {
        errors.push(`line ${line}: "${key}" has no value`);
        continue;
      }
      if (dot === -1) {
        if (CAMERA_KEYS.has(key)) {
          camera[key] = value;
          continue;
        }
        if (key in PROTOCOL_KEYS) {
          if (ENABLE_WORDS.has(value)) enabled[key] = enabled[key] ?? {};
          else if (DISABLE_WORDS.has(value)) enabled[key] = null;
          else errors.push(`line ${line}: "${key}" takes on or off, not "${value}"`);
          continue;
        }
        errors.push(`line ${line}: unknown key "${key}" in [${section.name}]`);
        continue;
      }
      const protocol = key.slice(0, dot);
      const field = key.slice(dot + 1);
      if (!(protocol in PROTOCOL_KEYS)) {
        errors.push(`line ${line}: unknown protocol "${protocol}" in key "${key}"`);
        continue;
      }
      if (!PROTOCOL_KEYS[protocol].has(field)) {
        errors.push(`line ${line}: unknown key "${key}" in [${section.name}]`);
        continue;
      }
      if (enabled[protocol] === null) continue;
      enabled[protocol] = enabled[protocol] ?? {};
      enabled[protocol][field] = value;
    }
    for (const protocol of PROTOCOLS) {
      if (enabled[protocol]) camera[protocol] = enabled[protocol];
    }
    cameras.push(camera);
  }

  return { server, cameras, views, proxy };
}

export function toLoopback(address) {
  const port = String(address).split(":").pop();
  return `${LOOPBACK}:${port}`;
}

export function buildProxy(proxy, mainServer, views, errors) {
  if (!proxy) return null;
  const listen = proxy.listen ?? ":80";
  const realm = proxy.realm ?? "IP Camera Viewer";
  // Relative by design: the service sets the working directory to the bundle.
  const tlsListen = proxy.tls_listen ?? "";
  const tlsCert = proxy.tls_cert ?? "tls/server.crt";
  const tlsKey = proxy.tls_key ?? "tls/server.key";
  const proxyPort = String(listen).split(":").pop();

  const accounts = [
    { user: mainServer.username, password: mainServer.password, backend: toLoopback(mainServer.listen) },
  ];
  for (const view of views) {
    accounts.push({ user: view.username, password: view.password, backend: toLoopback(view.listen) });
  }

  const seenUser = new Set();
  for (const account of accounts) {
    if (seenUser.has(account.user)) {
      errors.push(`the proxy cannot tell two servers apart: both use the user name "${account.user}".`);
    }
    seenUser.add(account.user);
    if (String(account.backend).split(":").pop() === proxyPort) {
      errors.push(`a server listens on the proxy's own port ${proxyPort}. Give it a different port.`);
    }
  }

  return { listen, realm, accounts, tlsListen, tlsCert, tlsKey };
}

export function emitProxyConfig(proxy) {
  const lines = [`listen ${proxy.listen}`, `realm ${proxy.realm}`];
  if (proxy.tlsListen) {
    lines.push(`tls_listen ${proxy.tlsListen}`, `tls_cert ${proxy.tlsCert}`, `tls_key ${proxy.tlsKey}`);
  }
  for (const account of proxy.accounts) {
    lines.push(`user ${account.user} ${account.password} http://${account.backend}`);
  }
  return `${lines.join("\n")}\n`;
}

export function buildViews(views, cameras, mainServer, errors) {
  const known = new Set(cameras.map((camera) => camera.name));
  const seenName = new Set();
  const port = (address) => String(address).split(":").pop();
  const seenListen = new Set([port(mainServer?.listen ?? DEFAULT_SERVER.listen)]);
  const seenWebrtc = new Set(["8555"]);
  const result = [];

  views.forEach((view, index) => {
    const where = `view "${view.name}"`;
    if (seenName.has(view.name)) {
      errors.push(`${where} is a duplicate.`);
      return;
    }
    seenName.add(view.name);

    if (typeof view.listen !== "string" || view.listen === "") {
      errors.push(`${where} needs \`listen\`, for example ":8080".`);
      return;
    }
    if (seenListen.has(port(view.listen))) {
      errors.push(`${where} listens on ${view.listen}, which another server already uses.`);
      return;
    }
    seenListen.add(port(view.listen));

    const webrtc = view.webrtc ?? `:${8556 + index}`;
    if (seenWebrtc.has(port(webrtc))) {
      errors.push(`${where} uses the WebRTC port ${webrtc}, which another server already uses.`);
      return;
    }
    if (seenListen.has(port(webrtc))) {
      errors.push(`${where} uses ${webrtc} for WebRTC, which a server already listens on.`);
      return;
    }
    seenWebrtc.add(port(webrtc));

    if (typeof view.password !== "string" || view.password === "") {
      errors.push(`${where} needs \`password\`.`);
      return;
    }
    if (!Array.isArray(view.cameras) || view.cameras.length === 0) {
      errors.push(`${where} needs \`cameras\`, a comma separated list of camera names.`);
      return;
    }
    const missing = view.cameras.filter((name) => !known.has(name));
    if (missing.length > 0) {
      errors.push(`${where} names no such camera: ${missing.join(", ")}`);
      return;
    }

    result.push({
      name: view.name,
      listen: view.listen,
      username: view.username ?? DEFAULT_SERVER.username,
      password: view.password,
      webrtc,
      allowPaths: view.allow_paths && view.allow_paths.length > 0 ? view.allow_paths : DEFAULT_ALLOW_PATHS,
      cameras: view.cameras,
    });
  });

  return result;
}

function yamlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function emitGo2rtcYaml(config) {
  const lines = ["streams:"];
  for (const [name, url] of Object.entries(config.streams)) {
    lines.push(`  ${name}: ${yamlQuote(url)}`);
  }
  lines.push("api:");
  for (const [key, value] of Object.entries(config.api)) {
    if (Array.isArray(value)) {
      lines.push(`  ${key}: [${value.map(yamlQuote).join(", ")}]`);
    } else {
      lines.push(`  ${key}: ${yamlQuote(value)}`);
    }
  }
  lines.push("rtsp:");
  lines.push(`  listen: ${yamlQuote(config.rtsp.listen)}`);
  lines.push("webrtc:");
  lines.push(`  listen: ${yamlQuote(config.webrtc.listen)}`);
  lines.push("  ice_servers: []");
  if (config.webrtc.candidates && config.webrtc.candidates.length > 0) {
    lines.push("  candidates:");
    for (const candidate of config.webrtc.candidates) lines.push(`    - ${yamlQuote(candidate)}`);
  }
  return `${lines.join("\n")}\n`;
}
