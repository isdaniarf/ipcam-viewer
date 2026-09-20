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
│   ├── generate-config.mjs     # Reads cameras.yaml → writes go2rtc.yaml + cameras.json
│   ├── bundle.mjs              # Builds the self-contained native bundle: binary + www + config
│   ├── discover-cameras.mjs    # WS-Discovery + port sweep, prints model and auth state per host
│   └── native/                 # launchd, systemd and install.sh templates for the bundle
├── bundle/                     # Generated native bundle (gitignored)
├── nginx/
│   └── nginx.conf              # Serves frontend, proxies /api/ws and /api/hls
├── go2rtc/                     # Generated config + binary (gitignored)
├── Dockerfile                  # Multi-target: config-gen, web
├── docker-compose.yml          # 3 services: config-gen, go2rtc, web
├── cameras.yaml                # Camera definitions (gitignored, has credentials)
├── cameras.yaml.example        # Template for cameras.yaml
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
  agent or a systemd unit keeps it running. `scripts/bundle.mjs` builds it, `bundle/install.sh` installs it.
- **Docker** — go2rtc on `:1984` inside the Docker network, nginx on `:80` in front. nginx serves the
  frontend and proxies `/api/ws` and `/api/hls` only. No auth. The generator runs with `--target docker`.

### Camera configuration

Each camera in `cameras.yaml` declares the protocols that it supports. A protocol block turns that
protocol on. The generator creates no stream for an absent block.

```yaml
server:                    # native layout only, ignored by --target docker
  listen: ":80"            # default ":80"
  username: viewer         # default "viewer"
  password: secret         # required
  candidates: []           # optional fixed WebRTC host IPs; default: go2rtc detects them at run time

cameras:
  - name: hallway          # letters, digits, "_" and "-" only
    label: Hallway         # optional, the UI derives it from the name
    host: 192.168.68.54
    username: camera_account
    password: camera_password
    rtsp:
      port: 554            # default 554
      path: /stream1       # required
      sub_path: /stream2   # optional low resolution stream
    onvif:
      port: 2020           # default 80, Tapo uses 2020
    tapo:
      username: tplink_email      # optional
      password: tplink_password   # required, this is the cloud password
```

The Tapo password is the TP-Link cloud password. It is not the RTSP password.
The generator rejects a `tapo:` block without its own password.

### Stream naming convention

The generator creates `{name}.rtsp`, `{name}.rtsp.sub`, `{name}.onvif` and `{name}.tapo`.
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
cd scripts && npm install && cd ../frontend && npm install && cd ..
node scripts/bundle.mjs            # builds frontend, downloads go2rtc, writes bundle/
./bundle/install.sh                # launchd on macOS, systemd on Linux; also restart|uninstall|status
```

`bundle/` holds `go2rtc` (binary), `go2rtc.yaml` (with `static_dir: www`, relative), `www/`,
`service/` templates, `install.sh` and `README.txt`. It is relocatable: the service file sets the
working directory to the bundle path. `--platform linux_arm64` etc. builds for another host.
The generator omits `webrtc.candidates` for the native target unless `server.candidates` or
`HOST_IP` is set. go2rtc then trickles its own host addresses, verified against 1.9.14.

## Development

```bash
# 1. Generate go2rtc config and the camera manifest (native target by default)
cd scripts && npm install && cd ..
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
cp cameras.yaml.example cameras.yaml   # Edit with your cameras
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
- `camera-video.ts` retries the WebRTC offer with backoff (5 s to 60 s) after a `webrtc/offer` error from
  go2rtc, because the vendored library otherwise stays on MSE until a reload. Seen on cold starts.
- `generate-config.mjs` uses the `yaml` npm package (in `scripts/package.json`)
- `discover-cameras.mjs` has no npm dependency. It uses `dgram`, `net`, `http` and `https` only.
  Run it on the host. Docker on macOS blocks multicast and hides the ARP table.
  `ONVIF_USER` and `ONVIF_PASSWORD` unlock `GetDeviceInformation` on cameras that reject the anonymous call.
- Sensitive and generated files are gitignored: `cameras.yaml`, `.env`, `go2rtc/go2rtc.yaml`,
  `go2rtc/cameras.json` and `frontend/public/cameras.json`

## Commands

| Task | Command |
|------|---------|
| Build native bundle | `node scripts/bundle.mjs [--platform X] [--skip-build]` |
| Install / restart service | `./bundle/install.sh [install\|restart\|uninstall\|status]` |
| Dev server | `cd frontend && npm run dev` |
| Build frontend | `cd frontend && npm run build` |
| Lint | `cd frontend && npm run lint` |
| Generate config | `node scripts/generate-config.mjs` |
| Find cameras on the LAN | `node scripts/discover-cameras.mjs` |
| Docker up | `docker compose up --build` |
