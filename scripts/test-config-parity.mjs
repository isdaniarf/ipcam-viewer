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

  for (const file of ["go2rtc.yaml", "cameras.json"]) {
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

rmSync(scratch, { recursive: true, force: true });
console.log(failures === 0 ? `\nparity: all ${Object.keys(valid).length + Object.keys(invalid).length} cases agree` : `\nparity: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
