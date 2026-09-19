# IP Camera Viewer

A multi-camera viewer for IP cameras. It shows every camera in one grid in your browser.

The app uses [go2rtc](https://github.com/AlexxIT/go2rtc) to read the cameras.
It plays each stream with WebRTC. It falls back to MSE, and then to HLS.

## Features

- One responsive grid for all cameras.
- Low latency playback with WebRTC.
- A protocol selector for RTSP, ONVIF and Tapo. The app keeps your choice.
- A fullscreen view with audio and player controls.
- A status badge for each tile: connecting, live or offline.
- Low bandwidth use. The grid plays the substream. It pauses a tile when the tile leaves the screen.
- No camera password reaches the browser.

## Requirements

- Docker and Docker Compose, for the deployment.
- Node.js 22, for local development.
- Cameras on the same LAN as the host.

## Quick start with Docker

1. Copy the two templates.

```bash
cp cameras.yaml.example cameras.yaml
cp .env.example .env
```

2. Edit `cameras.yaml`. Add your cameras. See [Camera configuration](#camera-configuration).
3. Edit `.env`. Set `HOST_IP` to the LAN IP address of the host.
4. Start the stack.

```bash
docker compose up --build
```

5. Open `http://<host-ip>/` in a browser.

`HOST_IP` is mandatory. WebRTC sends this address to the browser as the connection candidate.
The browser cannot reach the internal container address.

## Camera configuration

The file `cameras.yaml` holds your cameras and your passwords. Git ignores this file.

Each camera declares one block for each protocol that it supports. A block turns that protocol on.
The generator creates no stream for an absent block.

```yaml
cameras:
  - name: hallway
    label: Hallway
    host: 192.168.1.54
    username: camera_account
    password: camera_password
    rtsp:
      port: 554
      path: /stream1
      sub_path: /stream2
    onvif:
      port: 2020
    tapo:
      username: tplink_account_email
      password: tplink_cloud_password
```

### Camera fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | yes | — | The stream name. Use letters, digits, `_` and `-` only. It must be unique. |
| `label` | no | From `name` | The title on the tile. |
| `host` | yes | — | The IP address or the hostname of the camera. |
| `username` | for RTSP and ONVIF | — | The camera account. Each block can override it. |
| `password` | for RTSP and ONVIF | — | The camera password. Each block can override it. |

### Protocol fields

| Block | Field | Required | Default | Description |
|-------|-------|----------|---------|-------------|
| `rtsp` | `path` | yes | — | The path of the main stream. |
| `rtsp` | `sub_path` | no | — | The path of the low resolution stream. The grid plays it. |
| `rtsp` | `port` | no | `554` | The RTSP port. |
| `onvif` | `port` | no | `80` | The ONVIF port. Tapo cameras use `2020`. |
| `tapo` | `password` | yes | — | The TP-Link cloud password. |
| `tapo` | `username` | no | — | The TP-Link account email address. |

The Tapo password is **not** the RTSP password. The Tapo protocol uses your TP-Link cloud account.
The RTSP protocol uses the camera account from the Tapo app.

A `sub_path` gives the largest performance gain. Most Tapo cameras serve `/stream2` at a low
resolution. Delete the line if your camera returns an error for that path.

The generator checks the file. It reports every problem, and then it writes no file.

## Development

1. Download the `go2rtc` binary for your platform. Put it in `go2rtc/go2rtc`.
   Get it from the [go2rtc releases](https://github.com/AlexxIT/go2rtc/releases).
2. Generate the configuration.

```bash
cd scripts && npm install && cd ..
node scripts/generate-config.mjs
```

3. Start go2rtc.

```bash
./go2rtc/go2rtc -config go2rtc/go2rtc.yaml
```

4. Start the dev server in a second terminal.

```bash
cd frontend && npm install && npm run dev
```

The dev server proxies `/api/ws` and `/api/hls` to `http://localhost:1984`.
Set `GO2RTC_URL` to use a different address.

Run `node scripts/generate-config.mjs` again after each change to `cameras.yaml`.

## Commands

| Task | Command |
|------|---------|
| Generate the configuration | `node scripts/generate-config.mjs` |
| Start the dev server | `cd frontend && npm run dev` |
| Build the frontend | `cd frontend && npm run build` |
| Check the code style | `cd frontend && npm run lint` |
| Start the stack | `docker compose up --build` |
| Stop the stack | `docker compose down` |

## Ports

| Port | Service | Scope |
|------|---------|-------|
| 80 | Web interface | Your LAN |
| 8555 TCP and UDP | WebRTC media | Your LAN |
| 1984 | go2rtc API | The Docker network only |

The stack does not publish port 1984. The go2rtc API shows the camera passwords in plain text.
nginx proxies `/api/ws` and `/api/hls` only. It returns 404 for every other `/api/` path.

The browser receives `/cameras.json`. This file holds camera names and stream names only.

## Troubleshooting

**A tile stays on "Connecting" or shows "Offline".**
Check that the camera answers on its RTSP port. Check the `path` value.
Some cameras close the RTSP port after a firmware update.

**The browser shows no camera.**
Run the generator again. In Docker, read the log of the `config-gen` service.
This service must finish before go2rtc starts.

**The video does not start in Docker, but it starts in development.**
Check `HOST_IP` in `.env`. Set it to the LAN IP address of the host, and start the stack again.

**The tile is black, and the tile shows "Live".**
The substream path is wrong for that camera. Delete `sub_path` for the camera.

## Project layout

| Path | Content |
|------|---------|
| `frontend/` | The React client. See [frontend/README.md](frontend/README.md). |
| `scripts/generate-config.mjs` | It reads `cameras.yaml`. It writes `go2rtc.yaml` and `cameras.json`. |
| `nginx/nginx.conf` | It serves the client, and it proxies the two stream paths. |
| `docker-compose.yml` | The three services: `config-gen`, `go2rtc` and `web`. |
| `cameras.yaml` | Your cameras and your passwords. Git ignores this file. |
| `.env` | The `HOST_IP` value. Git ignores this file. |
