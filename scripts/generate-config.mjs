import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import { cpSync } from "node:fs";
import {
  buildCameras,
  buildProxy,
  buildViews,
  buildGo2rtcConfig,
  buildServer,
  configFromIni,
  emitGo2rtcYaml,
  emitProxyConfig,
  manifestJson,
  toLoopback,
} from "./lib/config-model.mjs";
import { looksLikeOldYaml, parseIni } from "./lib/ini.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const root = resolve(__dirname, "..");

export class ConfigError extends Error {
  constructor(problems) {
    super(`cameras.ini has ${problems.length} problem(s)`);
    this.problems = problems;
  }
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

function toCandidates(list) {
  return list.map((ip) => String(ip).trim()).filter(Boolean).map((ip) => `${ip}:8555`);
}

function webrtcCandidates(server, target, warnings) {
  const hostIp = process.env.HOST_IP;
  if (hostIp) return { candidates: toCandidates(hostIp.split(",")), candidateSource: "HOST_IP" };

  const configured = server && Array.isArray(server.candidates) ? server.candidates : [];
  if (configured.length > 0) {
    return { candidates: toCandidates(configured), candidateSource: "server.candidates" };
  }

  if (target === "native") return { candidates: [], candidateSource: "runtime" };

  const candidates = lanAddresses();
  if (candidates.length === 0) {
    warnings.push("found no LAN address for WebRTC. Set HOST_IP to your LAN IP.");
  }
  return { candidates, candidateSource: "auto" };
}

function readCamerasFile(camerasFile, errors) {
  if (!existsSync(camerasFile)) {
    errors.push(`${camerasFile} does not exist. Copy cameras.ini.example to cameras.ini.`);
    return { cameras: [], server: null };
  }
  const text = readFileSync(camerasFile, "utf-8");
  if (looksLikeOldYaml(text)) {
    errors.push(
      `${camerasFile} is in the old YAML format. The file is INI now: one [section] per camera, ` +
        "and `rtsp.path = /stream1` style keys. See cameras.ini.example.",
    );
    return { cameras: [], server: null };
  }
  const parsed = parseIni(text);
  errors.push(...parsed.errors);
  const { server, cameras, views, proxy } = configFromIni(parsed.sections, errors);
  if (cameras.length === 0 && errors.length === 0) {
    errors.push(`${camerasFile} names no camera. Add a [camera_name] section.`);
  }
  return { cameras, server, views, proxy };
}

export function syncRouteDirectories(staticDirPath, manifest, warnings) {
  const indexPath = resolve(staticDirPath, "index.html");
  const markerPath = resolve(staticDirPath, ".routes");
  if (!existsSync(indexPath)) {
    if (manifest.some((camera) => camera.route)) {
      warnings.push(`${staticDirPath} has no index.html yet, so no route folder was made.`);
    }
    return [];
  }

  const previous = existsSync(markerPath)
    ? readFileSync(markerPath, "utf-8").split("\n").map((line) => line.trim()).filter(Boolean)
    : [];
  const wanted = manifest.map((camera) => camera.route).filter(Boolean);

  for (const stale of previous) {
    if (wanted.includes(stale)) continue;
    const dir = resolve(staticDirPath, stale);
    if (existsSync(resolve(dir, "index.html"))) rmSync(dir, { recursive: true, force: true });
  }
  for (const route of wanted) {
    const dir = resolve(staticDirPath, route);
    mkdirSync(dir, { recursive: true });
    copyFileSync(indexPath, resolve(dir, "index.html"));
  }
  if (wanted.length > 0) writeFileSync(markerPath, `${wanted.join("\n")}\n`);
  else if (existsSync(markerPath)) rmSync(markerPath, { force: true });
  return wanted;
}

function writeView({ view, cameras, outDir, staticDirPath, candidates, warnings, proxied }) {
  const subset = cameras.filter((camera) => view.cameras.includes(camera.name));
  const errors = [];
  const { streams, manifest } = buildCameras(subset, errors, warnings);
  if (errors.length > 0) throw new ConfigError(errors);

  const dir = resolve(outDir, "views", view.name);
  const www = resolve(dir, "www");
  mkdirSync(www, { recursive: true });

  if (existsSync(staticDirPath)) {
    for (const entry of readdirSync(staticDirPath)) {
      if (entry === "cameras.json" || entry === ".routes") continue;
      const source = resolve(staticDirPath, entry);
      if (statSync(source).isDirectory() && entry !== "assets") continue;
      cpSync(source, resolve(www, entry), { recursive: true });
    }
  }

  const json = manifestJson(manifest);
  writeFileSync(resolve(dir, "cameras.json"), json);
  writeFileSync(resolve(www, "cameras.json"), json);
  const routes = syncRouteDirectories(www, manifest, warnings);

  const config = buildGo2rtcConfig({
    streams,
    api: {
      listen: proxied ? toLoopback(view.listen) : view.listen,
      static_dir: "www",
      allow_paths: view.allowPaths,
      username: view.username,
      password: view.password,
    },
    candidates,
    webrtcListen: view.webrtc,
    rtspListen: "",
  });
  writeFileSync(resolve(dir, "go2rtc.yaml"), emitGo2rtcYaml(config));

  return { name: view.name, listen: view.listen, cameras: view.cameras, routes, dir };
}

export function generate(options = {}) {
  const target = options.target ?? "native";
  if (target !== "native" && target !== "docker") {
    throw new Error(`unknown target "${target}". Use "native" or "docker".`);
  }
  const camerasFile = options.camerasFile ?? resolve(root, "cameras.ini");
  const outDir = options.outDir ?? resolve(root, "go2rtc");
  const staticDir = options.staticDir ?? resolve(root, "frontend", "dist");
  const staticDirPath = isAbsolute(staticDir) ? staticDir : resolve(outDir, staticDir);
  const writeDevManifest = options.writeDevManifest ?? true;

  const errors = [];
  const warnings = [];

  const { cameras, server, views: rawViews, proxy: rawProxy } = readCamerasFile(camerasFile, errors);
  const { streams, manifest } = buildCameras(cameras, errors, warnings);
  const serverConfig = target === "native" ? buildServer(server, errors) : null;
  const views = target === "native" ? buildViews(rawViews ?? [], cameras, server, errors) : [];
  const proxy = target === "native" ? buildProxy(rawProxy, serverConfig, views, errors) : null;
  if (errors.length > 0) throw new ConfigError(errors);

  const { candidates, candidateSource } = webrtcCandidates(server, target, warnings);
  const api = target === "native"
    ? {
        listen: proxy ? toLoopback(serverConfig.listen) : serverConfig.listen,
        static_dir: staticDir,
        allow_paths: serverConfig.allowPaths,
        username: serverConfig.username,
        password: serverConfig.password,
      }
    : { listen: ":1984" };
  const go2rtcConfig = buildGo2rtcConfig({ streams, api, candidates });

  mkdirSync(outDir, { recursive: true });
  const configPath = resolve(outDir, "go2rtc.yaml");
  writeFileSync(configPath, emitGo2rtcYaml(go2rtcConfig));

  const json = manifestJson(manifest);
  const manifestPaths = [resolve(outDir, "cameras.json")];
  if (target === "native") {
    if (existsSync(staticDirPath)) {
      manifestPaths.push(resolve(staticDirPath, "cameras.json"));
    } else {
      warnings.push(`static directory ${staticDirPath} does not exist yet. Build the frontend, then run this again.`);
    }
  }
  if (writeDevManifest && existsSync(resolve(root, "frontend"))) {
    const publicDir = resolve(root, "frontend", "public");
    mkdirSync(publicDir, { recursive: true });
    manifestPaths.push(resolve(publicDir, "cameras.json"));
  }
  for (const path of manifestPaths) writeFileSync(path, json);

  const routes = target === "native" && existsSync(staticDirPath)
    ? syncRouteDirectories(staticDirPath, manifest, warnings)
    : [];

  const viewResults = [];
  if (views.length > 0) {
    const viewsRoot = resolve(outDir, "views");
    if (existsSync(viewsRoot)) {
      for (const entry of readdirSync(viewsRoot)) {
        if (!views.some((view) => view.name === entry)) {
          rmSync(resolve(viewsRoot, entry), { recursive: true, force: true });
        }
      }
    }
    for (const view of views) {
      viewResults.push(
        writeView({ view, cameras, outDir, staticDirPath, candidates, warnings, proxied: Boolean(proxy) }),
      );
    }
  } else {
    const viewsRoot = resolve(outDir, "views");
    if (existsSync(viewsRoot)) rmSync(viewsRoot, { recursive: true, force: true });
  }
  writeFileSync(resolve(outDir, "views.txt"), views.map((view) => view.name).join("\n") + (views.length ? "\n" : ""));

  const proxyPath = resolve(outDir, "proxy.conf");
  if (proxy) writeFileSync(proxyPath, emitProxyConfig(proxy));
  else if (existsSync(proxyPath)) rmSync(proxyPath, { force: true });

  return { target, configPath, manifestPaths, manifest, streams, candidates, candidateSource, warnings, api, routes, views: viewResults, proxy };
}

export function printSummary(result) {
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  console.log(`Wrote ${result.configPath}`);
  for (const path of result.manifestPaths) console.log(`Wrote ${path}`);
  console.log(`Target: ${result.target}. Configured ${result.manifest.length} camera(s) and ${Object.keys(result.streams).length} stream(s).`);
  for (const camera of result.manifest) {
    const parts = Object.entries(camera.streams).map(([protocol, ids]) =>
      ids.sub ? `${protocol} (+sub)` : protocol,
    );
    console.log(`  ${camera.name}: ${parts.join(", ")}`);
  }
  if (result.target === "native") {
    console.log(`Server: listen ${result.api.listen}, static ${result.api.static_dir}, user ${result.api.username}`);
  }
  if (result.proxy) {
    console.log(`Proxy: ${result.proxy.listen}, ${result.proxy.accounts.length} user(s); every server moved to loopback`);
  }
  for (const view of result.views ?? []) {
    console.log(`View ${view.name}: ${view.listen}, ${view.cameras.length} camera(s): ${view.cameras.join(", ")}`);
  }
  if (result.routes && result.routes.length > 0) {
    console.log(`Routes: ${result.routes.map((route) => `/${route}`).join(", ")}`);
  }
  if (result.candidateSource === "runtime") {
    console.log("WebRTC candidates: go2rtc detects the host addresses at run time");
  } else {
    console.log(`WebRTC candidates (${result.candidateSource}): ${result.candidates.join(", ") || "none"}`);
  }
}

export function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--target") { options.target = value; i += 1; }
    else if (arg === "--out") { options.outDir = resolve(process.cwd(), value); i += 1; }
    else if (arg === "--static-dir") { options.staticDir = value; i += 1; }
    else if (arg === "--cameras") { options.camerasFile = resolve(process.cwd(), value); i += 1; }
    else throw new Error(`unknown option "${arg}"`);
  }
  return options;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    printSummary(generate(parseArgs(process.argv.slice(2))));
  } catch (error) {
    if (error instanceof ConfigError) {
      for (const problem of error.problems) console.error(`error: ${problem}`);
      console.error(`Wrote no files. Correct ${error.problems.length} problem(s) in cameras.ini.`);
    } else {
      console.error(`error: ${error.message}`);
    }
    process.exit(1);
  }
}
