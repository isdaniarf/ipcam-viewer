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
- One process at run time. go2rtc serves the page, the camera list and the streams.
- A password protects the page and the streams.
- An `ipcam` command controls the service from anywhere in your shell.
- A one-line install from a GitHub release. The config stays on your machines.

## Requirements

On the machine where you build:

- Node.js 22.
- `unzip`, for the macOS and Windows go2rtc archives.

On the machine that runs the viewer: nothing. The bundle holds the binary, the page and the config.
The installer uses launchd on macOS and systemd on Linux, and it adds the `ipcam` command to your PATH.

## Quick start

1. Copy the template and add your cameras. See [Camera configuration](#camera-configuration).

```bash
cp cameras.yaml.example cameras.yaml
```

2. Install the build dependencies once.

```bash
cd scripts && npm install && cd ../frontend && npm install && cd ..
```

3. Build the bundle. The script builds the page, downloads go2rtc for this machine, and writes the config.

```bash
node scripts/bundle.mjs
```

4. Install the service. This also adds the `ipcam` command to your PATH.

```bash
./bundle/ipcam install
```

5. Open the address that the installer prints. Log in with the user and the password from `server:` in `cameras.yaml`.

The bundle is self-contained. Keep the `bundle/` directory in place after the install, because the
service runs go2rtc from there.

## The ipcam command

`ipcam install` links the command into `~/.local/bin`. Set `IPCAM_BIN_DIR` to use another directory.
The command then works from anywhere.

| Command | Effect |
|---------|--------|
| `ipcam install [--no-link]` | Install the service, start it, and link the command |
| `ipcam start`, `ipcam stop`, `ipcam restart` | Control the service |
| `ipcam status` | Show the state, the pid, the URL and the link |
| `ipcam logs` | Follow the service log |
| `ipcam url` | Print the address and the viewer user name |
| `ipcam update [--build]` | Rebuild the config from `cameras.yaml`, then restart |
| `ipcam config show\|export\|import` | Show, export or import the config |
| `ipcam upgrade` | Install the newest release, and keep the config |
| `ipcam uninstall` | Stop the service, remove it, and remove the link |
| `ipcam version` | Show the bundle and go2rtc versions |

`ipcam update` needs the repository and Node.js. It works on the machine that built the bundle.
On another machine, build a new bundle and copy it again.

### Change the cameras

Edit `cameras.yaml`, then apply the change.

```bash
ipcam update
```

## Install on another Mac

The second machine needs no Node.js, no repository and no Homebrew. One command installs the runtime:

```bash
curl -fsSL https://raw.githubusercontent.com/isdaniarf/ipcam-viewer/main/install.sh | sh
```

It detects the platform, downloads the release and the matching go2rtc binary, installs into
`~/.local/share/ipcam-viewer`, and links the `ipcam` command.

Then give it your config. The config holds the camera passwords, so it never goes into a release.
Export it on a machine that already runs the viewer, send the file over a private channel, and import it:

```bash
ipcam config export ~/ipcam-config.tgz     # on the machine that already runs
ipcam config import ~/ipcam-config.tgz     # on the new machine
ipcam install
```

`ipcam upgrade` installs a newer release later and keeps the config.

### Installer options

| Variable | Effect |
|----------|--------|
| `IPCAM_VERSION` | Install a fixed tag instead of the newest release. |
| `IPCAM_PREFIX` | Install into another directory. Default: `~/.local/share/ipcam-viewer`. |
| `IPCAM_BIN_DIR` | Link the command into another directory. Default: `~/.local/bin`. |

Read the script before you pipe it into a shell. Pin a tag with `IPCAM_VERSION` when you want a
reproducible install.

### Build the bundle yourself

The repository can also produce a bundle without a release. Copy the directory to the other machine.

```bash
node scripts/bundle.mjs
scp -r bundle your-mac.local:~/ipcam-viewer
ssh your-mac.local '~/ipcam-viewer/ipcam install'
```

AirDrop, a USB disk or a shared folder work as well. The bundle is about 18 MB.

macOS marks a file that arrives through AirDrop or a browser download with a quarantine flag, and
Gatekeeper then blocks the unsigned go2rtc binary. `ipcam install` removes that flag, so the copy runs.

Both Macs must use the same processor family. Build with `--platform mac_amd64` for an Intel Mac.
The same flow works for Linux with `--platform linux_arm64`, where the installer needs `sudo` for the
systemd unit.

Supported platforms: `mac_arm64`, `mac_amd64`, `linux_amd64`, `linux_arm64`, `linux_arm`,
`linux_armv6` and `linux_i386`.

### One server, many viewers

Each installation opens its own RTSP connection to every camera. Most cameras accept only two or
three at a time. Run the server on one machine, and open its address from the other devices. Install
the bundle on a second Mac when you want a spare server, not a second viewer.

### Bundle options

| Option | Effect |
|--------|--------|
| `--platform <name>` | Build for another platform. Default: this machine. |
| `--out <dir>` | Write the bundle to another directory. Default: `bundle/`. |
| `--version <x.y.z>` | Use another go2rtc release. Default: `1.9.14`. |
| `--binary <path>` | Use a local go2rtc binary. No download. |
| `--skip-build` | Keep the current `frontend/dist`. |

The script keeps the downloaded binary when its version matches.

## Camera configuration

The file `cameras.yaml` holds the viewer password, your cameras and their passwords. Git ignores this file.

```yaml
server:
  listen: ":80"
  username: viewer
  password: choose_a_viewer_password

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

### Server fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `password` | yes | — | The viewer password. It protects the page, the camera list and the streams. |
| `username` | no | `viewer` | The viewer user name. |
| `listen` | no | `:80` | The address and port of the web server. |
| `candidates` | no | — | A list of host IP addresses for WebRTC. See [Remote access](#remote-access). |

### Camera fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | yes | — | The stream name. Use letters, digits, `_` and `-` only. It must be unique. |
| `label` | no | From `name` | The title on the tile. |
| `host` | yes | — | The IP address or the hostname of the camera. |
| `username` | for RTSP and ONVIF | — | The camera account. Each block can override it. |
| `password` | for RTSP and ONVIF | — | The camera password. Each block can override it. |

### Protocol fields

Each camera declares one block for each protocol that it supports. A block turns that protocol on.
The generator creates no stream for an absent block.

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

## Find cameras on the LAN

The script `scripts/discover-cameras.mjs` finds the cameras on your network. It sends a WS-Discovery
probe, sweeps the common camera ports on each local subnet, and prints the model and the
authentication state of each host. It has no npm dependency.

```bash
node scripts/discover-cameras.mjs
node scripts/discover-cameras.mjs --subnet 192.168.1.0/24 --json
ONVIF_USER=admin ONVIF_PASSWORD=secret node scripts/discover-cameras.mjs
```

Run it on the host, not in Docker. Docker on macOS blocks multicast and hides the ARP table.
`ONVIF_USER` and `ONVIF_PASSWORD` unlock the device information on cameras that reject the anonymous call.

| Option | Effect |
|--------|--------|
| `--subnet <cidr>` | Sweep this subnet. Repeat the option for more subnets. Default: the local subnets. |
| `--ports <list>` | Sweep these ports, comma separated. Default: `80,443,554,2020,8000,8080,8443,8554,8899`. |
| `--timeout <ms>` | Timeout for one TCP connect or one request. Default: `1000`. |
| `--wait <ms>` | Time to collect the WS-Discovery answers. Default: `3000`. |
| `--concurrency <n>` | Parallel TCP connects in the sweep. Default: `256`. |
| `--skip-discovery` | Send no WS-Discovery probe. |
| `--skip-sweep` | Sweep no ports. Inspect only the hosts that answer the probe. |
| `--offline` | Look up no MAC vendor online. |
| `--json` | Print the result as JSON. |

## Remote access

Tailscale is a good fit. Install Tailscale on the host and on your phone, then open the host's
MagicDNS name. go2rtc detects the host addresses at run time, so it advertises the Tailscale address
for WebRTC as soon as Tailscale is connected.

Run `ipcam url` to see the address and the viewer user name of the host.

Set `server.candidates` when you want a fixed list instead, for example on a host with many interfaces.
Do not use Tailscale Funnel. Funnel publishes the viewer to the open internet.

## Ports

| Port | Purpose |
|------|---------|
| 80, or `server.listen` | The page, the camera list, the WebSocket and the go2rtc API |
| 8555 TCP and UDP | WebRTC media |

The go2rtc API shares the web port. The viewer password protects every path on it.
Requests from the host itself skip the password. That is go2rtc behaviour.

## Where the passwords are

- `cameras.yaml` holds the viewer password and the camera passwords in plain text.
- `bundle/go2rtc.yaml` holds the same values, because go2rtc reads them from there.
- The browser receives `cameras.json`. This file holds camera names and stream names only.
- The holder of the viewer password can read the camera passwords through the go2rtc API.
  Give the viewer password to people who may know the camera passwords.

## Docker

Docker is the alternative when you want no service on the host. It runs go2rtc behind nginx.
In this layout the go2rtc API stays inside the Docker network, and nginx proxies the stream paths only.

```bash
cp cameras.yaml.example cameras.yaml
cp .env.example .env
docker compose up --build
```

`HOST_IP` in `.env` is mandatory here. The container cannot detect the host addresses, so the
generator writes `HOST_IP` as the WebRTC candidate. Separate several addresses with a comma.
The Docker layout has no password. The `server:` block is ignored.

## Development

1. Generate the configuration, then start go2rtc from the repository.

```bash
node scripts/generate-config.mjs
./go2rtc/go2rtc -config go2rtc/go2rtc.yaml
```

The generator writes `go2rtc/go2rtc.yaml`. It needs `go2rtc/go2rtc`, the binary for your platform.
Copy it from a bundle, or download it from the [go2rtc releases](https://github.com/AlexxIT/go2rtc/releases).

2. Start the dev server in a second terminal.

```bash
cd frontend && npm run dev
```

The dev server proxies `/api/ws` and `/api/hls` to `http://localhost:1984`. Set `GO2RTC_URL` to use
a different address. Requests from the host skip the password, so the dev server needs no login.

## Commands

| Task | Command |
|------|---------|
| Build the bundle | `node scripts/bundle.mjs` |
| Install from a release | `curl -fsSL https://raw.githubusercontent.com/isdaniarf/ipcam-viewer/main/install.sh \| sh` |
| Install from a local bundle | `./bundle/ipcam install` |
| Control the service | `ipcam [start\|stop\|restart\|status\|logs\|url\|update\|uninstall]` |
| Generate the configuration only | `node scripts/generate-config.mjs [--target native\|docker]` |
| Find cameras on the LAN | `node scripts/discover-cameras.mjs [--help]` |
| Start the dev server | `cd frontend && npm run dev` |
| Build the frontend | `cd frontend && npm run build` |
| Check the code style | `cd frontend && npm run lint` |
| Start the Docker stack | `docker compose up --build` |

## Troubleshooting

**The browser asks for a password again and again.**
Check `server.username` and `server.password` in `cameras.yaml`, then run `ipcam update`.

**The service does not start.**
Run `ipcam logs`. A common cause is another program on port 80. A port below 1024 can also need root
on some systems. Change `server.listen` to a high port, for example `":8080"`, then run `ipcam update`.

**A tile stays on "Connecting" or shows "Offline".**
Check that the camera answers on its RTSP port. Check the `path` value.

**The browser shows no camera.**
Run `ipcam update` and read the generator output.

**The tile is black, and the tile shows "Live".**
The substream path is wrong for that camera. Delete `sub_path` for the camera.

**Video starts on the LAN but not over Tailscale.**
Check that Tailscale is connected on the host. Or set `server.candidates` to the LAN address and the
Tailscale address of the host.

## Project layout

| Path | Content |
|------|---------|
| `frontend/` | The React client. See [frontend/README.md](frontend/README.md). |
| `scripts/generate-config.mjs` | It reads `cameras.yaml`. It writes `go2rtc.yaml` and `cameras.json`. |
| `scripts/bundle.mjs` | It builds the self-contained bundle for a platform. |
| `scripts/discover-cameras.mjs` | It finds cameras on the LAN with WS-Discovery and a port sweep. |
| `scripts/native/` | The `ipcam` command, and the launchd and systemd templates for the bundle. |
| `install.sh` | The `curl \| sh` entry point. It installs a published release. |
| `.github/workflows/release.yml` | It builds and publishes a release on a `v*` tag. |
| `bundle/` | The generated bundle. Git ignores this directory. |
| `nginx/nginx.conf` | The nginx config for the Docker layout. |
| `docker-compose.yml` | The Docker layout: `config-gen`, `go2rtc` and `web`. |
| `cameras.yaml` | Your passwords and cameras. Git ignores this file. |
