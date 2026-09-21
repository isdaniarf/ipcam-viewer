# IP Camera Viewer

Multi-camera IP video streaming viewer. React frontend talks to go2rtc for RTSP/WebRTC streaming, served behind nginx.

## Project Structure

```
├── frontend/          # React 19 + TypeScript + Vite + Tailwind CSS 4
│   ├── public/
│   │   └── cameras.json        # Generated camera manifest (gitignored)
│   └── src/
│       ├── App.tsx              # Root component, manages state
│       ├── components/
│       │   ├── Header.tsx       # Title bar + protocol selector
│       │   ├── CameraGrid.tsx   # Responsive grid layout
│       │   ├── CameraCard.tsx   # Single camera tile
│       │   ├── StreamStatus.tsx # Connecting / live / offline badge
│       │   ├── VideoPlayer.tsx  # <camera-video> wrapper
│       │   └── FullscreenOverlay.tsx
│       ├── hooks/
│       │   └── useCameras.ts    # Fetches /cameras.json, retries on failure
│       ├── types/
│       │   └── camera.ts        # Camera & Protocol types
│       └── lib/
│           ├── video-rtc.js     # VideoRTC v1.6.0, with local changes
│           ├── video-rtc.d.ts   # Types for the vendored player
│           └── camera-video.ts  # <camera-video> subclass, LAN defaults
├── scripts/
│   ├── generate-config.mjs     # Reads cameras.ini → writes go2rtc.yaml + cameras.json (no npm deps)
│   ├── bundle.mjs              # Builds the self-contained native bundle: binary + www + config
│   ├── discover-cameras.mjs    # WS-Discovery + port sweep; writes cameras.ini and runtime config
│   ├── lib/config-model.mjs    # Shared camera->streams/manifest logic; zero imports by design
│   ├── lib/ini.mjs             # INI reader, zero imports
│   ├── test-config-parity.mjs  # Proves config.awk == the JavaScript reader
│   └── native/                 # ipcam CLI, config.awk reader, launchd plist and systemd unit
├── install.sh                  # curl | sh entry point; installs a published release
├── .github/workflows/release.yml  # builds + publishes platform archives on a v* tag
├── bundle/                     # Generated native bundle (gitignored)
├── nginx/
│   └── nginx.conf              # Serves frontend, proxies /api/ws and /api/hls
├── go2rtc/                     # Generated config + binary (gitignored)
├── Dockerfile                  # Multi-target: config-gen, web
├── docker-compose.yml          # 3 services: config-gen, go2rtc, web
├── cameras.ini                 # Camera definitions (gitignored, has credentials)
├── cameras.ini.example         # Template for cameras.ini
├── .env                        # HOST_IP for Docker WebRTC (gitignored)
└── .env.example                # Template for .env
```

## Architecture

- **go2rtc** — Streams RTSP/ONVIF/Tapo cameras. WebRTC on `:8555`.
- **Frontend** — React SPA using the `<camera-video>` custom element for playback (WebRTC → MSE → HLS fallback)

Two layouts exist. The native layout is the primary one.

- **Native** — go2rtc alone. It serves `www/` (the built frontend and `cameras.json`) through
  `api.static_dir` on `server.listen` (default `:80`). Basic auth from `server.username` and
  `server.password` protects every path. Requests from the host itself skip the auth. A launchd
  daemon (root, see the Local Network note below) or a systemd unit keeps it running.
  `scripts/bundle.mjs` builds it, `bundle/ipcam install` installs it.
- **Docker** — go2rtc on `:1984` inside the Docker network, nginx on `:80` in front. nginx serves the
  frontend and proxies `/api/ws` and `/api/hls` only. No auth. The generator runs with `--target docker`.

### Camera configuration

`cameras.ini` is plain INI: one `[section]` per camera, `key = value` lines, a value runs to the end
of the line with surrounding whitespace trimmed, no quoting, `;`/`#` comments only at line start.
Unknown keys, duplicate keys, empty values, tabs-only oddities and flow syntax are hard errors.

```ini
[server]                 ; native layout only, ignored by --target docker
listen = :80             ; default :80
username = viewer        ; default viewer
password = secret        ; required
candidates = 1.2.3.4     ; optional, comma separated; default: go2rtc detects at run time

[hallway]                ; section name = camera name, [A-Za-z0-9_-]+
label = Hallway          ; optional, default title-cased name
route = hallway          ; optional; serves this camera alone at /hallway
host = 192.168.1.54
username = camera_account
password = camera_password
rtsp.path = /stream1     ; required for RTSP; rtsp.port default 554
rtsp.sub_path = /stream2 ; optional low resolution stream
onvif.port = 2020        ; default 80; onvif.profile / onvif.sub_profile pick ONVIF profiles
tapo.password = cloud    ; required for Tapo; this is the TP-Link cloud password
```

Any `proto.*` key enables that protocol; `proto = on|off` toggles it explicitly. `rtsp.username`,
`onvif.username` and their password twins override the camera account per protocol.

Two readers exist and must agree: `scripts/lib/ini.mjs` + `scripts/lib/config-model.mjs` (JavaScript,
used by `generate-config.mjs` and `discover-cameras.mjs`) and `scripts/native/config.awk` (POSIX awk,
used by the installed bundle via `ipcam`). Both emit the same canonical `go2rtc.yaml` (every string
single-quoted) and the same `cameras.json`. `scripts/test-config-parity.mjs` diffs them byte for byte
over synthetic cases plus `cameras.ini.example` and a local `cameras.ini`; CI runs it on push and before
every release. Extend the schema in both readers and add a parity case, or the build fails.

### Stream naming convention

The generator creates `{name}.rtsp`, `{name}.rtsp.sub`, `{name}.onvif`, `{name}.onvif.sub` and `{name}.tapo`.
It writes the names into `cameras.json`. The frontend reads that file and never parses stream names.

The grid plays `sub` when it exists. The fullscreen view plays the main stream with audio.

### API endpoints

- `GET /cameras.json` — The camera manifest. nginx serves it from the shared volume.
- `WS /api/ws?src={stream_name}` — WebSocket for video playback.
- `GET /api/hls/...` — HLS fallback for old Safari.

nginx returns 404 for every other `/api/` path. The go2rtc API port stays inside the Docker
network, because `GET /api/streams` and `GET /api/config` show the camera passwords.

## Native bundle

```bash
cd frontend && npm install && cd ..
node scripts/bundle.mjs            # builds frontend, downloads go2rtc, writes bundle/
./bundle/ipcam install             # launchd on macOS, systemd on Linux; links ipcam into ~/.local/bin
ipcam status | logs | restart | url | update | uninstall
```

`bundle/` holds `go2rtc` (binary), `go2rtc.yaml` (with `static_dir: www`, relative), `www/`,
`service/` templates, `ipcam`, an `install.sh` shim, `build-info` and `README.txt`. It is relocatable:
the service file sets the working directory to the bundle path, and `ipcam` resolves `$0` through
symlinks to find its own bundle, so the PATH link works from anywhere. `--platform linux_arm64` etc. builds for another host.
The generator omits `webrtc.candidates` for the native target unless `server.candidates` or
`HOST_IP` is set. go2rtc then trickles its own host addresses, verified against 1.9.14.

## Development

```bash
# 1. Generate go2rtc config and the camera manifest (native target by default)
node scripts/generate-config.mjs   # options: --target native|docker, --out, --static-dir, --cameras

# 2. Start go2rtc
./go2rtc/go2rtc -config go2rtc/go2rtc.yaml

# 3. Start frontend dev server (proxies /api/ws and /api/hls to localhost:1984)
cd frontend && npm install && npm run dev
```

`generate-config.mjs` exports `generate(options)`, `printSummary`, `parseArgs` and `ConfigError`;
`bundle.mjs` imports them. The CLI entry runs only when the file is executed directly.

The Vite dev server proxies `/api/ws` and `/api/hls` to `http://localhost:1984`.
Set `GO2RTC_URL` to change that address. Vite serves `/cameras.json` from `frontend/public/`.

## Docker Deployment

```bash
cp cameras.ini.example cameras.ini     # Edit with your cameras
cp .env.example .env                    # Set HOST_IP to your LAN IP
docker compose up --build
```

Three services:
1. **config-gen** — Init container. It runs the generator with `--target docker` and writes go2rtc.yaml and cameras.json into the shared volume, then exits.
2. **go2rtc** — `alexxit/go2rtc:1.9.14`. It reads the config from the shared volume. It has a healthcheck.
3. **web** — Multi-stage build (Vite build → nginx). It waits for a healthy go2rtc.
   It mounts the shared volume read-only at `/srv/go2rtc` to serve `cameras.json`.

`HOST_IP` env var is required in Docker so WebRTC ICE candidates use the host LAN IP instead of container IPs.
It accepts a comma-separated list.

## Key Technical Details

- Frontend uses no state library — just React hooks (`useState`, `useEffect`)
- `video-rtc.js` is a vendored library, not an npm package. It has 3 local changes: the `lifecycle`
  `AbortController` field, the `observer` field, and the `destroy()` method. Keep them on an upgrade.
- `camera-video.ts` extends the vendored class. It empties `iceServers`, because the app runs on a LAN.
- `VideoPlayer.tsx` creates the element, sets the properties, and then appends it. This order matters,
  because the player reads `visibilityThreshold` when the browser attaches the element.
- The grid pauses a tile when the tile leaves the viewport (`visibilityThreshold={0.01}`).
- go2rtc basic auth exempts loopback requests. The Vite dev server therefore needs no login, and any
  process on the host can read `/api/config`. `GET /api/streams` and `GET /api/config` show camera passwords.
- `bundle.mjs` reuses `bundle/go2rtc` when `./go2rtc --version` matches `--version` and the platform is the host.
- `ipcam install` runs `xattr -d com.apple.quarantine` on the binary and on itself. Without that,
  Gatekeeper silently blocks the unsigned go2rtc binary on a Mac that received the bundle by AirDrop
  or by download. Verified: a quarantined binary produces no output at all.
- The macOS service is a **LaunchDaemon that runs as root**, not a LaunchAgent. This is the whole
  reason `plist_path` points at `/Library/LaunchDaemons`. macOS Local Network privacy (Sequoia and
  later) blocks the outbound LAN connections of any launchd process that runs as a normal user, so
  an agent reaches no camera: every RTSP dial fails instantly with `no route to host` while the
  camera answers ping and accepts a DESCRIBE from a shell on the same host. Loopback is exempt, so
  `:80` still serves the UI, `/api/streams` still lists every stream and `ipcam status` still reports
  healthy — only the camera connections die, which makes it look like a camera or credential fault.
  Measured on 26.7, one camera, same binary and config each time:
  agent as the user 0 bytes; **daemon with `UserName` set to the user 0 bytes**; daemon as root 2.7 MB;
  straight from a shell 2.1 MB. So the exemption follows the effective uid, not the launchd domain,
  and root is the only configuration that works. A shell works only because it inherits the
  terminal's own grant (Ghostty, iTerm).
  Things that look like the fix and are not: granting go2rtc under System Settings > Privacy &
  Security > Local Network (the entry appears and reads on, and the dial still fails, across a
  toggle off/on and a reboot); ad-hoc `codesign`; wrapping the binary in a registered `.app`.
  `tccutil reset LocalNetwork <id>` cannot target it at all, because it takes a LaunchServices
  bundle identifier and a bare executable has none. Note the settings pane does not refresh while
  open, so an entry that looks absent may just be stale — reopen it before concluding anything.
  Apple platform binaries (`/usr/bin/python3`) are exempt and connect fine from an agent, so do not
  probe this with one; a third-party binary (Node.js, Developer ID signed) reproduces it exactly.
- Release archives hold `ipcam`, `www/`, `service/` and `build-info` only. No binary and no config:
  `install.sh` reads `go2rtc=` from `build-info` and fetches that binary from go2rtc's own upstream release.
- The config never ships in a release. `ipcam config export|import` moves `cameras.ini`, `go2rtc.yaml`
  and `cameras.json` between machines as a tarball. Import sniffs the input: a tarball, a `cameras.ini`
  (has a `[section]` line), or a runtime `go2rtc.yaml` (has `^api:`). A `cameras.ini` is rendered on the
  spot by `config.awk`, so no repo and no Node are needed. `ipcam update` renders the bundle's own
  `cameras.ini` and never copies the repo's over it; it only warns when the two differ. Only `--build`
  takes the repo copy, via a full rebundle. `install.sh` preserves `cameras.ini` across an upgrade.
- `bundle/build-info` records `repo=`, so `ipcam update` can call the generator on the build machine.
  It fails with a clear message on a machine that has no repository or no Node.js.
- `camera-video.ts` retries the WebRTC offer with backoff (5 s to 60 s) after a `webrtc/offer` error from
  go2rtc, because the vendored library otherwise stays on MSE until a reload. Seen on cold starts.
- `scripts/` has no npm dependency at all. `generate-config.mjs` reads INI and emits YAML by hand.
- `discover-cameras.mjs` has no npm dependency. It uses `dgram`, `net`, `http` and `https` only.
  It emits YAML by hand through `yamlScalar` and `emitYaml`, so keep it dependency free.
- `scripts/lib/config-model.mjs` holds the camera -> streams/manifest logic. `generate-config.mjs`
  and `discover-cameras.mjs` both import it, so the two never drift. It must keep zero imports,
  because the release ships it next to the discovery script without npm.
- `--write-runtime <dir>` writes `go2rtc.yaml` + `cameras.json` (+ `www/cameras.json`) with no YAML
  parser, so a release install can configure itself. `ipcam discover --deep` wraps it.
- go2rtc has no built-in account: with `api.username`/`api.password` unset there is no auth at all.
  The `viewer` name and the random password are ours (`DEFAULT_SERVER` in config-model, and the
  generator in discover). Both scan paths reuse an existing `[server]` block rather than replacing it:
  the shell path via `existing_server_value`, the `--deep` path via `--keep-server`, which the CLI
  points at a copy of the old file before it is replaced.
- `cmd_update` and `cmd_install` call `prune_instances` then `for_each_instance ensure_instance`, so
  adding a view to `cameras.ini` installs its service and deleting one removes it; `installed_instances`
  finds them by scanning for `io.ipcam-viewer.go2rtc.<view>.plist` / `ipcam-viewer-<view>.service`.
  Loopback skips auth unless `local_auth: true`, so test credential separation over the LAN or set it.
- `test-config-parity.mjs` runs three kinds of check, and the distinction matters: parity (both
  readers emit byte-identical files), refusal (both reject a bad config), and shape (assertions about
  what the output actually says, run against BOTH readers' output). Parity alone cannot catch a
  mistake made identically in both readers, which is how views nearly kept an RTSP listener. Add a
  shape assertion whenever a generated value must hold, not merely match.
- Ports are validated by number, not by the whole address: web ports must be unique across the main
  server and all views, and `webrtc` ports likewise (seeded with 8555 for the main server) and must not
  collide with a web port. Without this a second instance binds nothing for WebRTC, logs nothing, keeps
  serving, and silently falls back to MSE, which is very hard to diagnose. The proxy never carries
  WebRTC media: it holds one TCP socket and no UDP, while go2rtc holds the UDP media ports on every
  interface, so media always goes browser to go2rtc directly.
- Every generated config names an RTSP port, because go2rtc falls back to `:8554` when none is given
  and two instances on one host then race for it. The main server takes `:8554`; a view writes
  `rtsp: listen: ''`, which turns the listener off, because a view only feeds a browser. Without this
  the loser of the race logs `[rtsp] listen error="listen tcp :8554: bind: address already in use"` on
  every start, and which instance loses changes from start to start. Verified: an empty `listen` starts
  clean with no RTSP line and no error, and the two servers then run together without a collision.
- `[proxy]` puts every server behind one port. `proxy/main.go` (~130 lines, no deps) reads
  `proxy.conf`, checks Basic auth, strips the header and forwards to that user's backend with
  `httputil.ReverseProxy`, which handles the WebSocket upgrade. With `[proxy]` present every go2rtc
  `api.listen` is rewritten to `127.0.0.1:<same port>`, so backends are unreachable off-box (verified).
  Passwords stay plaintext in `proxy.conf`, matching `cameras.ini`, which keeps generation deterministic
  and inside the parity test; Caddy was rejected partly because salted bcrypt would not be. The proxy is
  instance `@proxy`: label `io.ipcam-viewer.go2rtc.proxy`, its own launchd/systemd templates, and
  `binary_for`/`template_for` pick its binary and unit. `bundle.mjs` cross-compiles it with the Go
  toolchain when present; CI always does. Measured: 5.6 MB binary, ~9 MB RSS, video identical through it.
- `[view:<name>]` sections make extra go2rtc instances, which is the only real per-camera access
  control: a view's config holds only its own streams, so `/api/ws?src=other` returns nothing there.
  Verified live: guest 37 KB for its camera, 0 bytes for one outside the view, owner 90 KB for the same.
  Generation writes `views/<name>/{go2rtc.yaml,cameras.json,www/}` plus `views.txt`; the per-view `www`
  copies `index.html` and `assets/` and gets its own filtered `cameras.json` and route dirs. Ports must
  differ, including WebRTC (auto `:8556`, `:8557`, ...). Service files template `{{BINARY}}` (always the
  bundle root) separately from `{{BUNDLE_DIR}}` (the instance directory); labels are
  `io.ipcam-viewer.go2rtc.<view>` and units `ipcam-viewer-<view>`. `for_each_instance` drives install,
  start, stop, restart and uninstall across the main server and every view.
- The native `api` block always emits `allow_paths`, default
  `['/', '/assets', '/cameras.json', '/api/ws', '/api/hls']`, overridable by a comma-separated
  `allow_paths` under `[server]`. It gates loopback too. Measured: the page, assets, manifest, route
  dirs and the `/api/ws` upgrade all keep working; `/api/config`, `/api/streams`, `/api/frame.jpeg`
  and `/api/stream.mp4` return 404. This closes the credential leak (both endpoints print the full
  `rtsp://user:pass@...` URLs) but is NOT access control: `/api/ws?src=<name>` still serves any stream
  to anyone with the viewer password, verified by a WebSocket client pulling MSE bytes for a camera
  absent from the served manifest. Per-camera separation needs a second instance. The docker target is
  unchanged, since nginx already restricts paths there.
- Route folders are created by `sync_routes`, which now runs from `render_config`, from
  `config import` (both the tarball and the bare-yaml branch) and from `require_bundle`, so a bundle
  that received only `go2rtc.yaml` + `cameras.json` still gets them. A manifest with `route` but no
  folder yields a 404 that looks like a config error; `ipcam config show` marks those MISSING.
- A camera `route` becomes a real directory under `www/`, because go2rtc's file server has no SPA
  fallback: it 404s an unknown path but 301s `/hallway` to `/hallway/` and serves the index there.
  `generate-config.mjs` and `ipcam render_config` both copy `www/index.html` into `www/<route>/` and
  track what they made in `www/.routes`, so a removed route is cleaned up. Routes are validated in
  both readers: `[A-Za-z0-9_-]+`, unique, and not `api`, `assets`, `index.html` or `cameras.json`.
  `App.tsx` derives the fullscreen camera from `location.pathname`, pushes the route on open and `/`
  on close, and listens for popstate. It never sets state inside an effect, which the lint forbids.
- `ipcam discover` merges by default: both scan paths write a candidate to a temp file, and
  `scripts/native/merge-ini.awk` folds it into the existing `cameras.ini`. It matches cameras by
  `host`, reproduces the existing file verbatim (so renames, labels and hand-edited keys survive),
  appends only unseen hosts, uniquifies a colliding section name with the host, and never copies the
  scanned `[server]` block. `--replace` writes a fresh file. The merge is idempotent; CI covers it.
- `ipcam discover` (no flag) needs no Node at all. It writes `cameras.ini` only (with `onvif.profile` /
  `onvif.sub_profile`) and touches neither `go2rtc.yaml` nor the service; `--apply` renders and restarts.
  `require_bundle` renders from `cameras.ini` when `go2rtc.yaml` is missing, so `ipcam install` straight
  after a scan still works. Every path ends in `config.awk`, the one reader. It starts the bundled go2rtc on a loopback port and
  uses go2rtc's own `GET /api/onvif`: with no `src` it runs WS-Discovery, with `src=onvif://user:pass@host:port`
  it lists the profiles as `onvif://...?subtype=profile_N` source URLs, which are usable streams
  (verified: profile_1 2560x1440, profile_2 640x360). Discovery is UDP, so it probes twice and merges.
  Shell-only helpers do the URL encoding, slugs, JSON field extraction and YAML quoting.
- `--write-config` takes the RTSP port and path from ONVIF `GetProfiles` plus `GetStreamUri`, on the
  media XAddr from `GetCapabilities` (it falls back to the device service URL, which Tapo accepts).
  The largest H264 profile is `path`, the smallest is `sub_path`. The RTSP probe now speaks Digest and
  Basic auth, so it can find a path on cameras without ONVIF.
  Run it on the host. Docker on macOS blocks multicast and hides the ARP table.
  `ONVIF_USER` and `ONVIF_PASSWORD` unlock `GetDeviceInformation` on cameras that reject the anonymous call.
- Sensitive and generated files are gitignored: `cameras.ini`, `.env`, `go2rtc/go2rtc.yaml`,
  `go2rtc/cameras.json` and `frontend/public/cameras.json`

## Commands

| Task | Command |
|------|---------|
| Build native bundle | `node scripts/bundle.mjs [--platform X] [--skip-build]` |
| Install / control service | `./bundle/ipcam install`, then `ipcam [start\|stop\|restart\|status\|logs\|discover\|update\|uninstall]` |
| Dev server | `cd frontend && npm run dev` |
| Build frontend | `cd frontend && npm run build` |
| Lint | `cd frontend && npm run lint` |
| Generate config | `node scripts/generate-config.mjs` |
| Find cameras on the LAN | `node scripts/discover-cameras.mjs` |
| Docker up | `docker compose up --build` |
