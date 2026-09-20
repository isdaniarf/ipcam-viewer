import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import YAML from "yaml";
import {
  buildCameras,
  buildGo2rtcConfig,
  buildServer,
  manifestJson,
} from "./lib/config-model.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const root = resolve(__dirname, "..");

export class ConfigError extends Error {
  constructor(problems) {
    super(`cameras.yaml has ${problems.length} problem(s)`);
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
    errors.push(`${camerasFile} does not exist. Copy cameras.yaml.example to cameras.yaml.`);
    return { cameras: [], server: undefined };
  }
  const parsed = YAML.parse(readFileSync(camerasFile, "utf-8"));
  if (!parsed || !Array.isArray(parsed.cameras) || parsed.cameras.length === 0) {
    errors.push("cameras.yaml must contain a non-empty `cameras` list.");
    return { cameras: [], server: undefined };
  }
  return { cameras: parsed.cameras, server: parsed.server };
}

export function generate(options = {}) {
  const target = options.target ?? "native";
  if (target !== "native" && target !== "docker") {
    throw new Error(`unknown target "${target}". Use "native" or "docker".`);
  }
  const camerasFile = options.camerasFile ?? resolve(root, "cameras.yaml");
  const outDir = options.outDir ?? resolve(root, "go2rtc");
  const staticDir = options.staticDir ?? resolve(root, "frontend", "dist");
  const staticDirPath = isAbsolute(staticDir) ? staticDir : resolve(outDir, staticDir);

  const errors = [];
  const warnings = [];

  const { cameras, server } = readCamerasFile(camerasFile, errors);
  const { streams, manifest } = buildCameras(cameras, errors, warnings);
  const serverConfig = target === "native" ? buildServer(server, errors) : null;
  if (errors.length > 0) throw new ConfigError(errors);

  const { candidates, candidateSource } = webrtcCandidates(server, target, warnings);
  const api = target === "native"
    ? {
        listen: serverConfig.listen,
        static_dir: staticDir,
        username: serverConfig.username,
        password: serverConfig.password,
      }
    : { listen: ":1984" };

  const go2rtcConfig = buildGo2rtcConfig({ streams, api, candidates });

  mkdirSync(outDir, { recursive: true });
  const configPath = resolve(outDir, "go2rtc.yaml");
  writeFileSync(configPath, YAML.stringify(go2rtcConfig));

  const json = manifestJson(manifest);
  const manifestPaths = [resolve(outDir, "cameras.json")];
  if (target === "native") {
    if (existsSync(staticDirPath)) {
      manifestPaths.push(resolve(staticDirPath, "cameras.json"));
    } else {
      warnings.push(`static directory ${staticDirPath} does not exist yet. Build the frontend, then run this again.`);
    }
  }
  if (existsSync(resolve(root, "frontend"))) {
    const publicDir = resolve(root, "frontend", "public");
    mkdirSync(publicDir, { recursive: true });
    manifestPaths.push(resolve(publicDir, "cameras.json"));
  }
  for (const path of manifestPaths) writeFileSync(path, json);

  return { target, configPath, manifestPaths, manifest, streams, candidates, candidateSource, warnings, api };
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
      console.error(`Wrote no files. Correct ${error.problems.length} problem(s) in cameras.yaml.`);
    } else {
      console.error(`error: ${error.message}`);
    }
    process.exit(1);
  }
}
