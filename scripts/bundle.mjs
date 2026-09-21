import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { ConfigError, generate, printSummary, root } from "./generate-config.mjs";

const DEFAULT_VERSION = "1.9.14";
const PLATFORMS = {
  mac_arm64: { asset: "go2rtc_mac_arm64.zip", zip: true },
  mac_amd64: { asset: "go2rtc_mac_amd64.zip", zip: true },
  linux_amd64: { asset: "go2rtc_linux_amd64", zip: false },
  linux_arm64: { asset: "go2rtc_linux_arm64", zip: false },
  linux_arm: { asset: "go2rtc_linux_arm", zip: false },
  linux_armv6: { asset: "go2rtc_linux_armv6", zip: false },
  linux_i386: { asset: "go2rtc_linux_i386", zip: false },
};

function hostPlatform() {
  const os = { darwin: "mac", linux: "linux" }[process.platform];
  const arch = { arm64: "arm64", x64: "amd64", arm: "arm", ia32: "i386" }[process.arch];
  if (!os || !arch) return null;
  const key = `${os}_${arch}`;
  return PLATFORMS[key] ? key : null;
}

function parseArgs(argv) {
  const options = {
    platform: hostPlatform(),
    outDir: resolve(root, "bundle"),
    version: DEFAULT_VERSION,
    build: true,
    binary: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--platform") { options.platform = value; i += 1; }
    else if (arg === "--out") { options.outDir = resolve(process.cwd(), value); i += 1; }
    else if (arg === "--version") { options.version = value; i += 1; }
    else if (arg === "--binary") { options.binary = resolve(process.cwd(), value); i += 1; }
    else if (arg === "--skip-build") { options.build = false; }
    else throw new Error(`unknown option "${arg}"`);
  }
  if (!options.platform || !PLATFORMS[options.platform]) {
    throw new Error(`unknown platform "${options.platform}". Use one of: ${Object.keys(PLATFORMS).join(", ")}`);
  }
  return options;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed in ${cwd}`);
}

function buildFrontend() {
  const frontend = resolve(root, "frontend");
  if (!existsSync(resolve(frontend, "node_modules"))) {
    throw new Error("frontend/node_modules is missing. Run `npm install` in frontend first.");
  }
  run("npm", ["run", "build"], frontend);
}

function findBinary(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      const found = findBinary(path);
      if (found) return found;
    } else if (entry === "go2rtc" || entry === "go2rtc.exe") {
      return path;
    }
  }
  return null;
}

function installedVersion(binary, platform) {
  if (!existsSync(binary) || platform !== hostPlatform()) return null;
  const result = spawnSync(binary, ["--version"], { encoding: "utf-8" });
  const match = /go2rtc version (\S+)/.exec(result.stdout ?? "");
  return match ? match[1] : null;
}

async function downloadBinary(platform, version, destination) {
  const { asset, zip } = PLATFORMS[platform];
  const url = `https://github.com/AlexxIT/go2rtc/releases/download/v${version}/${asset}`;
  console.log(`Download ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status} for ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());

  if (!zip) {
    writeFileSync(destination, bytes);
    return;
  }

  const scratch = mkdtempSync(join(tmpdir(), "go2rtc-"));
  const archive = join(scratch, asset);
  writeFileSync(archive, bytes);
  run("unzip", ["-o", "-q", archive, "-d", scratch], scratch);
  const binary = findBinary(scratch);
  if (!binary) throw new Error(`the archive ${asset} holds no go2rtc binary`);
  copyFileSync(binary, destination);
  rmSync(scratch, { recursive: true, force: true });
}

function gitOutput(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf-8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function appVersion() {
  return gitOutput(["describe", "--tags", "--always", "--dirty"]) || "dev";
}

function appCommit() {
  return gitOutput(["rev-parse", "--short", "HEAD"]) || "unknown";
}

function writeBundleReadme(outDir, platform, version) {
  const text = `IP Camera Viewer, native bundle
Platform: ${platform}, go2rtc ${version}

Install:  ./ipcam install     Installs the service, starts it, and adds "ipcam" to your PATH.
Config:   ipcam discover      Scans for ONVIF cameras and writes cameras.ini (set ONVIF_USER/ONVIF_PASSWORD).
                              It changes no running config. Review the file, then: ipcam update
          ipcam config import cameras.ini    Uses a file you wrote by hand.
Then:     ipcam status | logs | restart | url | update | uninstall
Help:     ./ipcam help

The service runs go2rtc from this directory. Keep the directory in place after the install.
Log file on macOS: go2rtc.log in this directory. On Linux: journalctl -u ipcam-viewer -f
`;
  writeFileSync(resolve(outDir, "README.txt"), text);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { outDir, platform, version } = options;

  if (options.build) buildFrontend();
  const dist = resolve(root, "frontend", "dist");
  if (!existsSync(resolve(dist, "index.html"))) {
    throw new Error("frontend/dist has no index.html. Build the frontend first.");
  }

  mkdirSync(outDir, { recursive: true });
  const www = resolve(outDir, "www");
  rmSync(www, { recursive: true, force: true });
  cpSync(dist, www, { recursive: true });

  const binary = resolve(outDir, "go2rtc");
  if (options.binary) {
    copyFileSync(options.binary, binary);
  } else if (installedVersion(binary, platform) === version) {
    console.log(`Keep the existing go2rtc ${version} binary`);
  } else {
    await downloadBinary(platform, version, binary);
  }
  chmodSync(binary, 0o755);

  const serviceDir = resolve(outDir, "service");
  mkdirSync(serviceDir, { recursive: true });
  const native = resolve(root, "scripts", "native");
  copyFileSync(resolve(native, "launchd.plist"), resolve(serviceDir, "launchd.plist"));
  copyFileSync(resolve(native, "systemd.service"), resolve(serviceDir, "systemd.service"));
  for (const name of ["ipcam", "install.sh"]) {
    copyFileSync(resolve(native, name), resolve(outDir, name));
    chmodSync(resolve(outDir, name), 0o755);
  }

  const scriptsDir = resolve(outDir, "scripts");
  mkdirSync(resolve(scriptsDir, "lib"), { recursive: true });
  copyFileSync(resolve(root, "scripts", "discover-cameras.mjs"), resolve(scriptsDir, "discover-cameras.mjs"));
  copyFileSync(
    resolve(root, "scripts", "lib", "config-model.mjs"),
    resolve(scriptsDir, "lib", "config-model.mjs"),
  );
  copyFileSync(resolve(root, "scripts", "lib", "ini.mjs"), resolve(scriptsDir, "lib", "ini.mjs"));
  copyFileSync(resolve(native, "config.awk"), resolve(scriptsDir, "config.awk"));
  copyFileSync(resolve(native, "merge-ini.awk"), resolve(scriptsDir, "merge-ini.awk"));
  if (existsSync(resolve(root, "cameras.ini"))) {
    copyFileSync(resolve(root, "cameras.ini"), resolve(outDir, "cameras.ini"));
  }
  writeFileSync(
    resolve(outDir, "build-info"),
    [
      `repo=${root}`,
      `platform=${platform}`,
      `go2rtc=${version}`,
      `built=${new Date().toISOString()}`,
      `version=${appVersion()}`,
      `commit=${appCommit()}`,
      "",
    ].join("\n"),
  );
  writeBundleReadme(outDir, platform, version);

  const result = generate({ target: "native", outDir, staticDir: "www" });
  printSummary(result);

  console.log("");
  console.log(`Bundle ready: ${outDir}`);
  console.log(`Next: ${resolve(outDir, "ipcam")} install`);
}

main().catch((error) => {
  if (error instanceof ConfigError) {
    for (const problem of error.problems) console.error(`error: ${problem}`);
  } else {
    console.error(`error: ${error.message}`);
  }
  process.exit(1);
});
