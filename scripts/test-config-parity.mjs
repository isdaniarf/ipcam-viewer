import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, generate } from "./generate-config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const awkProgram = resolve(here, "native", "config.awk");
delete process.env.HOST_IP;

const valid = {
  minimal: `
[server]
password = x

[cam]
host = 1.2.3.4
username = u
password = p
rtsp.path = /s1
`,
  everything: `
; a comment
# another comment

[server]
listen = :8080
username = admin
password = p@ss w0rd='#1
candidates = 192.168.1.10, 100.64.0.5

[front-door_2]
label = Front "Door" \\ café
host = 192.168.1.54
username = mail@example.com
password = sécret+%&
rtsp.port = 8554
rtsp.path = /stream1
rtsp.sub_path = /stream2
rtsp.username = rtspuser
rtsp.password = rtsp'pass
onvif.port = 2020
onvif.profile = profile_1
onvif.sub_profile = profile_2
tapo.username = cloud@example.com
tapo.password = cloudpw

[garage]
host = 10.0.0.9
username\t=\tu2
password =  p2
onvif = on
`,
  disabled_protocol: `
[server]
password = x
[cam]
host = 1.2.3.4
username = u
password = p
rtsp.path = /s1
onvif.port = 2020
onvif = off
`,
  flag_then_keys: `
[server]
password = x
[cam]
host = 1.2.3.4
username = u
password = p
rtsp = yes
rtsp.path = /s1
`,
  routes: `
[server]
password = x

[hallway]
route = hallway
host = 10.0.0.1
username = u
password = p
rtsp.path = /s1

[side-gate]
route = side-gate
label = Side Gate
host = 10.0.0.2
username = u
password = p
onvif.port = 2020

[no_route]
host = 10.0.0.3
username = u
password = p
rtsp.path = /s1
`,
  views: `
[server]
listen = :80
username = owner
password = ownerpw

[view:guest]
listen = :8080
username = guest
password = guestpw
cameras = hallway, gate

[view:kitchen_only]
listen = :8081
password = kpw
cameras = gate
webrtc = :8600
allow_paths = /, /assets, /cameras.json, /api/ws

[hallway]
route = hallway
host = 10.0.0.1
username = u
password = p
rtsp.path = /s1
rtsp.sub_path = /s2

[bedroom]
host = 10.0.0.2
username = u
password = p
rtsp.path = /s1

[gate]
host = 10.0.0.3
username = u
password = p
onvif.port = 2020
`,
  proxy: `
[proxy]
listen = :80
realm = My Cameras

[server]
listen = :8081
username = admin
password = adminpw

[view:guest]
listen = :8082
username = guest
password = guestpw
cameras = gate

[hallway]
host = 10.0.0.1
username = u
password = p
rtsp.path = /s1

[gate]
host = 10.0.0.2
username = u
password = p
rtsp.path = /s1
`,
  allow_paths_override: `
[server]
password = x
allow_paths = /, /api/ws, /api/streams

[cam]
host = 10.0.0.1
username = u
password = p
rtsp.path = /s1
`,
  tapo_only: `
[server]
password = x
[patio]
host = 1.2.3.4
tapo.password = cloud
`,
  many_cameras: `
[server]
password = x
[living_room-1]
host = 10.0.0.1
username = u
password = p
rtsp.path = /a
[b2]
host = 10.0.0.2
username = u
password = p
onvif.port = 80
[c_3]
host = 10.0.0.3
username = u
password = p
rtsp.path = /c
rtsp.sub_path = /c2
tapo.password = t
`,
  crlf: "[server]\r\npassword = x\r\n[cam]\r\nhost = 1.2.3.4\r\nusername = u\r\npassword = p\r\nrtsp.path = /s1\r\n",
};

const invalid = {
  unknown_camera_key: "[server]\npassword = x\n[cam]\nhost = h\nusername = u\npassword = p\nrtsp.path = /s\nfoo = 1\n",
  unknown_server_key: "[server]\npassword = x\nport = 80\n[cam]\nhost = h\nusername = u\npassword = p\nrtsp.path = /s\n",
  duplicate_key: "[server]\npassword = x\n[cam]\nhost = h\nhost = h2\nusername = u\npassword = p\nrtsp.path = /s\n",
  key_before_section: "password = x\n[cam]\nhost = h\n",
  missing_host: "[server]\npassword = x\n[cam]\nusername = u\npassword = p\nrtsp.path = /s\n",
  missing_rtsp_path: "[server]\npassword = x\n[cam]\nhost = h\nusername = u\npassword = p\nrtsp.port = 554\n",
  bad_name: "[server]\npassword = x\n[bad name!]\nhost = h\nusername = u\npassword = p\nrtsp.path = /s\n",
  dotted_name: "[server]\npassword = x\n[a.b]\nhost = h\nusername = u\npassword = p\nrtsp.path = /s\n",
  no_server_password: "[cam]\nhost = h\nusername = u\npassword = p\nrtsp.path = /s\n",
  duplicate_section: "[server]\npassword = x\n[cam]\nhost = h\nusername = u\npassword = p\nrtsp.path = /s\n[cam]\nhost = h\n",
  bad_flag: "[server]\npassword = x\n[cam]\nhost = h\nusername = u\npassword = p\nonvif = maybe\n",
  empty_value: "[server]\npassword = x\n[cam]\nhost = h\nusername = u\npassword = p\nrtsp.path = /s\nlabel =\n",
  old_yaml: "server:\n  password: x\ncameras:\n  - name: cam\n    host: h\n",
  no_equals: "[server]\npassword = x\n[cam]\nhost h\n",
  empty_file: "\n",
  tapo_without_password: "[server]\npassword = x\n[cam]\nhost = h\ntapo.username = e\n",
  no_protocol: "[server]\npassword = x\n[cam]\nhost = h\nusername = u\npassword = p\n",
  route_with_space: "[server]\npassword = x\n[cam]\nroute = has space\nhost = h\nusername = u\npassword = p\nrtsp.path = /s\n",
  route_with_dot: "[server]\npassword = x\n[cam]\nroute = a.b\nhost = h\nusername = u\npassword = p\nrtsp.path = /s\n",
  route_reserved: "[server]\npassword = x\n[cam]\nroute = api\nhost = h\nusername = u\npassword = p\nrtsp.path = /s\n",
  view_unknown_camera: "[server]\npassword = x\n[view:g]\nlisten = :8080\npassword = p\ncameras = nope\n[cam]\nhost = h\nusername = u\npassword = p\nrtsp.path = /s\n",
  view_no_password: "[server]\npassword = x\n[view:g]\nlisten = :8080\ncameras = cam\n[cam]\nhost = h\nusername = u\npassword = p\nrtsp.path = /s\n",
  view_no_listen: "[server]\npassword = x\n[view:g]\npassword = p\ncameras = cam\n[cam]\nhost = h\nusername = u\npassword = p\nrtsp.path = /s\n",
  view_port_clash: "[server]\nlisten = :80\npassword = x\n[view:g]\nlisten = :80\npassword = p\ncameras = cam\n[cam]\nhost = h\nusername = u\npassword = p\nrtsp.path = /s\n",
  view_unknown_key: "[server]\npassword = x\n[view:g]\nlisten = :8080\npassword = p\ncameras = cam\nbogus = 1\n[cam]\nhost = h\nusername = u\npassword = p\nrtsp.path = /s\n",
  proxy_same_user: "[proxy]\nlisten = :80\n[server]\nlisten = :8081\nusername = same\npassword = a\n[view:g]\nlisten = :8082\nusername = same\npassword = b\ncameras = cam\n[cam]\nhost = h\nusername = u\npassword = p\nrtsp.path = /s\n",
  proxy_port_clash: "[proxy]\nlisten = :8081\n[server]\nlisten = :8081\nusername = a\npassword = a\n[cam]\nhost = h\nusername = u\npassword = p\nrtsp.path = /s\n",
  proxy_unknown_key: "[proxy]\nlisten = :80\nbogus = 1\n[server]\npassword = a\n[cam]\nhost = h\nusername = u\npassword = p\nrtsp.path = /s\n",
  view_bad_name: "[server]\npassword = x\n[view:bad name]\nlisten = :8080\npassword = p\ncameras = cam\n[cam]\nhost = h\nusername = u\npassword = p\nrtsp.path = /s\n",
  route_duplicate: "[server]\npassword = x\n[a]\nroute = same\nhost = h1\nusername = u\npassword = p\nrtsp.path = /s\n[b]\nroute = same\nhost = h2\nusername = u\npassword = p\nrtsp.path = /s\n",
  missing_camera_password: "[server]\npassword = x\n[cam]\nhost = h\nusername = u\nrtsp.path = /s\n",
};

for (const [name, path] of [["example", resolve(root, "cameras.ini.example")], ["local", resolve(root, "cameras.ini")]]) {
  if (existsSync(path)) valid[name] = readFileSync(path, "utf-8");
}

const scratch = mkdtempSync(join(tmpdir(), "parity-"));
let failures = 0;

function runJs(iniPath, outDir) {
  try {
    generate({ camerasFile: iniPath, outDir, staticDir: "www", target: "native", writeDevManifest: false });
    return { ok: true };
  } catch (error) {
    if (error instanceof ConfigError) return { ok: false, problems: error.problems };
    throw error;
  }
}

function runAwk(iniPath, outDir) {
  const env = { ...process.env, LC_ALL: "C" };
  delete env.HOST_IP;
  const result = spawnSync("awk", ["-v", `out=${outDir}`, "-v", "static_dir=www", "-f", awkProgram, iniPath], { env, encoding: "utf-8" });
  return { ok: result.status === 0, stderr: result.stderr };
}

function report(kind, name, message) {
  failures += 1;
  console.log(`FAIL ${kind}/${name}: ${message}`);
}

for (const [name, text] of Object.entries(valid)) {
  const dir = join(scratch, `valid-${name}`);
  const jsOut = join(dir, "js");
  const awkOut = join(dir, "awk");
  mkdirSync(jsOut, { recursive: true });
  mkdirSync(awkOut, { recursive: true });
  const iniPath = join(dir, "cameras.ini");
  writeFileSync(iniPath, text);

  const js = runJs(iniPath, jsOut);
  const awk = runAwk(iniPath, awkOut);
  if (!js.ok) { report("valid", name, `javascript rejected it: ${js.problems.join(" | ")}`); continue; }
  if (!awk.ok) { report("valid", name, `awk rejected it: ${awk.stderr.trim()}`); continue; }

  const files = ["go2rtc.yaml", "cameras.json"];
  if (existsSync(join(jsOut, "views.txt"))) {
    files.push("views.txt");
    if (existsSync(join(jsOut, "proxy.conf"))) files.push("proxy.conf");
    for (const view of readFileSync(join(jsOut, "views.txt"), "utf-8").split("\n").filter(Boolean)) {
      files.push(`views/${view}/go2rtc.yaml`, `views/${view}/cameras.json`);
    }
  }
  for (const file of files) {
    if (!existsSync(join(jsOut, file)) || !existsSync(join(awkOut, file))) {
      report("valid", name, `${file} missing from ${existsSync(join(jsOut, file)) ? "awk" : "javascript"}`);
      continue;
    }
    const a = readFileSync(join(jsOut, file), "utf-8");
    const b = readFileSync(join(awkOut, file), "utf-8");
    if (a !== b) {
      const la = a.split("\n"); const lb = b.split("\n");
      const at = la.findIndex((line, i) => line !== lb[i]);
      report("valid", name, `${file} differs at line ${at + 1}\n    js : ${JSON.stringify(la[at])}\n    awk: ${JSON.stringify(lb[at])}`);
    }
  }
  console.log(`ok   valid/${name}`);
}

for (const [name, text] of Object.entries(invalid)) {
  const dir = join(scratch, `invalid-${name}`);
  mkdirSync(join(dir, "js"), { recursive: true });
  mkdirSync(join(dir, "awk"), { recursive: true });
  const iniPath = join(dir, "cameras.ini");
  writeFileSync(iniPath, text);
  const js = runJs(iniPath, join(dir, "js"));
  const awk = runAwk(iniPath, join(dir, "awk"));
  if (js.ok) report("invalid", name, "javascript accepted it");
  if (awk.ok) report("invalid", name, "awk accepted it");
  if (!js.ok && !awk.ok) console.log(`ok   invalid/${name} (both refuse)`);
}

const mergeProgram = resolve(here, "native", "merge-ini.awk");

function runMerge(existing, candidate) {
  const dir = mkdtempSync(join(tmpdir(), "merge-"));
  writeFileSync(join(dir, "a.ini"), existing);
  writeFileSync(join(dir, "b.ini"), candidate);
  const result = spawnSync("awk", ["-f", mergeProgram, join(dir, "a.ini"), join(dir, "b.ini")], {
    env: { ...process.env, LC_ALL: "C" },
    encoding: "utf-8",
  });
  rmSync(dir, { recursive: true, force: true });
  return { text: result.stdout, report: result.stderr, status: result.status };
}

const BASE = `[server]
listen = :8099
username = myuser
password = mypassword

[hallway]
label = Front Hall
host = 10.0.0.1
username = u
password = p
rtsp.path = /stream1
`;

const SCAN = `[server]
listen = :80
username = viewer
password = generated

[c120]
host = 10.0.0.1
username = s
password = s
onvif.port = 2020

[c210]
host = 10.0.0.2
username = s
password = s
onvif.port = 2020
`;

const mergeChecks = [
  ["keeps a renamed camera matched by host", (m) => m.text.includes("[hallway]") && !m.text.includes("[c120]")],
  ["appends the camera that is missing", (m) => m.text.includes("[c210]")],
  ["never takes the scanned server block", (m) => m.text.includes("password = mypassword") && !m.text.includes("password = generated")],
  ["keeps hand-edited keys", (m) => m.text.includes("label = Front Hall") && m.text.includes("rtsp.path = /stream1")],
  ["reports one kept and one added", (m) => /1 camera\(s\) already present, 1 added/.test(m.report)],
  ["is idempotent", () => {
    const once = runMerge(BASE, SCAN);
    const twice = runMerge(once.text, SCAN);
    return /0 added/.test(twice.report) && twice.text.trim() === once.text.trim();
  }],
  ["renames a colliding section", () => {
    const m = runMerge(BASE, "[hallway]\nhost = 10.0.0.9\nusername = s\npassword = s\nonvif.port = 80\n");
    return /added\s+10\.0\.0\.9 as \[hallway_/.test(m.report);
  }],
  ["output still parses", (m) => {
    const dir = mkdtempSync(join(tmpdir(), "mergeparse-"));
    writeFileSync(join(dir, "cameras.ini"), m.text);
    const out = join(dir, "out");
    mkdirSync(out, { recursive: true });
    const ok = runAwk(join(dir, "cameras.ini"), out).ok && runJs(join(dir, "cameras.ini"), out).ok;
    rmSync(dir, { recursive: true, force: true });
    return ok;
  }],
];

const merged = runMerge(BASE, SCAN);
if (merged.status !== 0) report("merge", "run", `awk exited ${merged.status}: ${merged.report}`);
for (const [name, check] of mergeChecks) {
  let ok = false;
  try { ok = check(merged); } catch (error) { ok = false; }
  if (ok) console.log(`ok   merge/${name}`);
  else report("merge", name, "check failed");
}

rmSync(scratch, { recursive: true, force: true });
const total = Object.keys(valid).length + Object.keys(invalid).length + mergeChecks.length;
console.log(failures === 0 ? `\nparity: all ${total} cases agree` : `\nparity: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
