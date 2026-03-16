# IP Camera Viewer

Multi-camera IP video streaming viewer. React frontend talks to go2rtc for RTSP/WebRTC streaming, served behind nginx.

## Project Structure

```
├── frontend/          # React 19 + TypeScript + Vite + Tailwind CSS 4
│   └── src/
│       ├── App.tsx              # Root component, manages state
│       ├── components/
│       │   ├── Header.tsx       # Title bar + protocol selector
│       │   ├── CameraGrid.tsx   # Responsive grid layout
│       │   ├── CameraCard.tsx   # Single camera tile
│       │   ├── VideoPlayer.tsx  # <video-rtc> wrapper
│       │   └── FullscreenOverlay.tsx
│       ├── hooks/
│       │   └── useCameras.ts    # Fetches /api/streams, groups by camera
│       ├── types/
│       │   ├── camera.ts        # Camera & Protocol types
│       │   └── video-rtc.d.ts   # Custom element type defs
│       └── lib/
│           └── video-rtc.js     # VideoRTC v1.6.0 player library
├── scripts/
│   └── generate-config.mjs     # Reads cameras.yaml → writes go2rtc/go2rtc.yaml
├── nginx/
│   └── nginx.conf              # Serves frontend, proxies /api/ to go2rtc
├── go2rtc/                     # Generated config + binary (gitignored)
├── Dockerfile                  # Multi-target: config-gen, web
├── docker-compose.yml          # 3 services: config-gen, go2rtc, web
├── cameras.yaml                # Camera definitions (gitignored, has credentials)
├── cameras.yaml.example        # Template for cameras.yaml
├── .env                        # HOST_IP for Docker WebRTC (gitignored)
└── .env.example                # Template for .env
```

## Architecture

- **go2rtc** — Streams RTSP/ONVIF/Tapo cameras, exposes API on `:1984` and WebRTC on `:8555`
- **nginx** — Serves the built frontend on `:80`, reverse-proxies `/api/` to go2rtc
- **Frontend** — React SPA using `<video-rtc>` custom element for playback (WebRTC → MSE → HLS fallback)

### Stream naming convention

Each camera gets 3 streams: `{name}.rtsp`, `{name}.onvif`, `{name}.tapo`. The frontend groups streams by camera name and lets users toggle protocol.

### API endpoints (proxied through nginx)

- `GET /api/streams` — Lists all configured streams
- `WS /api/ws?src={stream_name}` — WebSocket for video playback

## Development

```bash
# 1. Generate go2rtc config
cd scripts && npm install && cd ..
node scripts/generate-config.mjs

# 2. Start go2rtc
./go2rtc/go2rtc -config go2rtc/go2rtc.yaml

# 3. Start frontend dev server (proxies /api to localhost:1984)
cd frontend && npm install && npm run dev
```

Vite dev server proxies `/api` to `http://localhost:1984` (configured in `vite.config.ts`).

## Docker Deployment

```bash
cp cameras.yaml.example cameras.yaml   # Edit with your cameras
cp .env.example .env                    # Set HOST_IP to your LAN IP
docker compose up --build
```

Three services:
1. **config-gen** — Init container, generates go2rtc.yaml from cameras.yaml into shared volume, then exits
2. **go2rtc** — `alexxit/go2rtc` image, reads config from shared volume
3. **web** — Multi-stage build (Vite build → nginx:alpine), serves frontend

`HOST_IP` env var is required in Docker so WebRTC ICE candidates use the host LAN IP instead of container IPs.

## Key Technical Details

- Frontend uses no state library — just React hooks (`useState`, `useEffect`)
- `video-rtc.js` is a vendored library, not an npm package
- `generate-config.mjs` uses the `yaml` npm package (in `scripts/package.json`)
- Sensitive files (`cameras.yaml`, `.env`, `go2rtc/go2rtc.yaml`) are gitignored

## Commands

| Task | Command |
|------|---------|
| Dev server | `cd frontend && npm run dev` |
| Build frontend | `cd frontend && npm run build` |
| Lint | `cd frontend && npm run lint` |
| Generate config | `node scripts/generate-config.mjs` |
| Docker up | `docker compose up --build` |
