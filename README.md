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
- One plain INI config file, readable by the installed bundle with no Node.js.

## Requirements

- macOS or Linux, on the machine that runs the viewer.
- Node.js 22 and git, for the source install and for `ipcam discover --deep`. Nothing else needs them.
- Cameras that speak RTSP, ONVIF or Tapo, on the same network.
- An ONVIF camera account, when you let `ipcam discover` find the cameras for you.

The service runs as a launchd daemon on macOS, or as a systemd unit on Linux. The installer adds an
`ipcam` command to your PATH.

On macOS the daemon runs as root and starts at boot, so the cameras come up before anyone logs in.
Root is not a preference: macOS Local Network privacy blocks the LAN connections of any launchd
process that runs as a normal user, and go2rtc then reaches no camera at all. `ipcam install`,
`start`, `stop` and `uninstall` therefore ask for your password.

## Install

The viewer is one program plus a config that lists your cameras. Install the program in whichever of
these three ways suits the machine.

| Way | It needs | Choose it when |
|-----|----------|----------------|
| [From source](#install-from-source) | Node.js 22 and git | You set up your cameras for the first time, or you change them |
| [From a release](#install-from-a-release) | `curl` only | You want one command. Then scan, or write `cameras.ini` by hand |
| [From a bundle](#install-from-a-bundle) | Nothing on the target | The target has no internet, or another processor family |

The config is what separates them. It holds your camera passwords, so it never ships in a release.
You get one in three ways: write `cameras.ini` yourself, let `ipcam discover` scan your network, or
copy an existing config with `ipcam config export` and `ipcam config import`. Every way works on every
install, with no Node.js.

### Install from source

This writes your config and builds the page. Do this at least once.

1. Clone this repository.

```bash
git clone https://github.com/isdaniarf/ipcam-viewer.git
cd ipcam-viewer
```

2. Copy the template and add your cameras. See [Camera configuration](#camera-configuration).
   Or let a scan write the file for you. See [Write cameras.ini from a scan](#write-camerasini-from-a-scan).

```bash
cp cameras.ini.example cameras.ini
```

3. Install the build dependencies once.

```bash
cd frontend && npm install && cd ..
```

4. Build the bundle. The script builds the page, downloads go2rtc for this machine, and writes the config.

```bash
node scripts/bundle.mjs
```

5. Install the service. This also adds the `ipcam` command to your PATH.

```bash
./bundle/ipcam install
```

6. Open the address that the installer prints. Log in with the user and the password from `[server]` in `cameras.ini`.

The bundle is self-contained. Keep the `bundle/` directory in place after the install, because the
service runs go2rtc from there.

### Install from a release

This needs no clone and no Node.js. One command installs the program:

```bash
curl -fsSL https://raw.githubusercontent.com/isdaniarf/ipcam-viewer/main/install.sh | sh
```

It detects the platform, downloads the release and the matching go2rtc binary, installs into
`~/.local/share/ipcam-viewer`, and links the `ipcam` command.

It brings no config, so give it one in any of three ways. Scan for your cameras:

```bash
ONVIF_USER=admin ONVIF_PASSWORD=secret ipcam discover
ipcam install
```

`ipcam discover` writes `cameras.ini` and leaves the running config alone. Review the file, then
`ipcam install` or `ipcam update` applies it.

Or write `cameras.ini` by hand, as shown in [Camera configuration](#camera-configuration), and import it:

```bash
ipcam config import cameras.ini
ipcam install
```

Or copy a config from a machine that already has one:

```bash
ipcam config export ~/ipcam-config.tgz     # where the config already exists
ipcam config import ~/ipcam-config.tgz     # on this machine
ipcam install
```

`ipcam discover` needs nothing but the bundle. It starts go2rtc on a loopback port, asks it to find
ONVIF cameras, reads each camera's stream profiles, and writes `cameras.ini`. It uses the largest
profile for the grid tile and the second one as the low resolution stream, and it prints the viewer
login it generated.

It merges rather than overwrites. Cameras already in `cameras.ini` are matched by `host` and left
exactly as they are, so a renamed section, a label and hand-edited stream paths all survive a rescan.
Cameras it finds that are missing are appended, and a camera the scan did not see stays in the file.
The `[server]` block is never touched.

It writes that one file and nothing else. The running config stays as it is, so you can rename the
new cameras from `c210` to `hallway` first. Apply it when you are happy:

```bash
ipcam update
```

| Option | Effect |
|--------|--------|
| `--apply` | Regenerate the config and restart at once, with no review step. |
| `--replace` | Write a fresh file instead of merging. Both scans still keep the viewer login. |
| `--deep` | Use the bundled scanner instead. It needs Node.js 22, and it also finds cameras that speak no ONVIF, and reports the vendor and the open ports. |

`ipcam upgrade` installs a newer release later and keeps the config.

### Installer options

| Variable | Effect |
|----------|--------|
| `IPCAM_VERSION` | Install a fixed tag instead of the newest release. |
| `IPCAM_PREFIX` | Install into another directory. Default: `~/.local/share/ipcam-viewer`. |
| `IPCAM_BIN_DIR` | Link the command into another directory. Default: `~/.local/bin`. |

Read the script before you pipe it into a shell. Pin a tag with `IPCAM_VERSION` when you want a
reproducible install.

### Install from a bundle

A bundle is a complete directory: the program, the page, the go2rtc binary and the config. Build it
for the target platform on a machine that has the sources, then copy the directory over.

```bash
node scripts/bundle.mjs --platform linux_arm64 --out bundle-pi
scp -r bundle-pi pi@192.168.1.20:~/ipcam-viewer
ssh pi@192.168.1.20 '~/ipcam-viewer/ipcam install'
```

AirDrop, a USB disk or a shared folder work as well. The bundle is about 18 MB, because it carries
the go2rtc binary. It also carries your camera passwords, so treat it as a secret.

macOS marks a file that arrives through AirDrop or a browser download with a quarantine flag, and
Gatekeeper then blocks the unsigned go2rtc binary. `ipcam install` removes that flag, so the copy runs.

Build for the processor family of the target, not of the machine you build on. Use
`--platform mac_amd64` for an Intel Mac. The installer needs `sudo` on both systems: for the systemd
unit on Linux, and for the launchd daemon on macOS.

Supported platforms: `mac_arm64`, `mac_amd64`, `linux_amd64`, `linux_arm64`, `linux_arm`,
`linux_armv6` and `linux_i386`.

### Bundle options

| Option | Effect |
|--------|--------|
| `--platform <name>` | Build for another platform. Default: this machine. |
| `--out <dir>` | Write the bundle to another directory. Default: `bundle/`. |
| `--version <x.y.z>` | Use another go2rtc release. Default: `1.9.14`. |
| `--binary <path>` | Use a local go2rtc binary. No download. |
| `--skip-build` | Keep the current `frontend/dist`. |

The script keeps the downloaded binary when its version matches.

### One server, many viewers

You do not need the program on every device. Any phone, tablet or laptop on the network opens the
address in a browser.

Install it a second time only when you want a spare server. Each installation opens its own RTSP
connection to every camera, and most cameras accept only two or three at a time.

## The ipcam command

`ipcam install` links the command into `~/.local/bin`. Set `IPCAM_BIN_DIR` to use another directory.
The command then works from anywhere.

| Command | Effect |
|---------|--------|
| `ipcam install [--no-link]` | Install the service, start it, and link the command |
| `ipcam start`, `ipcam stop`, `ipcam restart` | Control the service |
| `ipcam status` | Show the state, the pid, the URL and the link |
| `ipcam logs [view\|proxy]` | Follow the service log, a view's log, or the proxy's |
| `ipcam url` | Print the address and the viewer user name |
| `ipcam update [--build]` | Regenerate the config from `cameras.ini`, then restart |
| `ipcam discover [--apply\|--replace\|--deep]` | Scan the network and merge what it finds into `cameras.ini`. It applies nothing unless you pass `--apply` |
| `ipcam config show\|export\|import` | Show, export or import the config. Import takes a `.tgz`, a `cameras.ini` or a `go2rtc.yaml` |
| `ipcam upgrade` | Install the newest release, and keep the config |
| `ipcam uninstall` | Stop the service, remove it, and remove the link |
| `ipcam version` | Show the app, bundle and go2rtc versions |

`ipcam update` reads the `cameras.ini` next to the installed bundle and needs nothing else. That file
is the one the service uses, so edit it in place. Pass `--build` to rebuild the web page and take the
repository's copy of the config, which needs the repository and Node.js.

### Change the cameras

Edit `cameras.ini`, then apply the change.

```bash
ipcam update
```

## Camera configuration

The file `cameras.ini` holds the viewer password, your cameras and their passwords. Git ignores this file.
It is plain INI: one `[section]` per camera, and `key = value` lines. There is no indentation and no
quoting. A value runs from the first `=` to the end of the line, with surrounding spaces removed, so a
password that contains `#`, `=`, quotes or spaces needs nothing special.

```ini
[server]
listen = :80
username = viewer
password = choose_a_viewer_password

[hallway]
label = Hallway
host = 192.168.1.54
username = camera_account
password = camera_password
rtsp.path = /stream1
rtsp.sub_path = /stream2
onvif.port = 2020
tapo.username = tplink_account_email
tapo.password = tplink_cloud_password
```

A line that starts with `;` or `#` is a comment. The section name is the camera name: letters,
digits, `_` and `-` only. A key that the viewer does not know stops the generator with the line
number, so a typo cannot pass silently.

### Server keys

| Key | Required | Default | Description |
|-----|----------|---------|-------------|
| `password` | yes | — | The viewer password. It protects the page, the camera list and the streams. |
| `username` | no | `viewer` | The viewer user name. |
| `listen` | no | `:80` | The address and port of the web server. |
| `candidates` | no | — | Host IP addresses for WebRTC, comma separated. See [Remote access](#remote-access). |
| `allow_paths` | no | See below | The paths the server answers at all, comma separated. |

### Camera keys

| Key | Required | Default | Description |
|-----|----------|---------|-------------|
| `host` | yes | — | The IP address or the hostname of the camera. |
| `label` | no | From the name | The title on the tile. |
| `route` | no | — | A path that opens this camera alone, for example `hallway` gives `/hallway`. |
| `username` | for RTSP and ONVIF | — | The camera account. A protocol key can override it. |
| `password` | for RTSP and ONVIF | — | The camera password. A protocol key can override it. |

### Give some people only some cameras

A view is a second server with its own port, its own login and its own cameras:

```ini
[view:guest]
listen = :8080
username = guest
password = guest_password
cameras = hallway, house_front
```

Guests open `http://<host>:8080/` and see those two cameras. The other cameras are not merely hidden
from the page, they are absent from that server, so asking it for one returns nothing at all.

| Key | Required | Default | Description |
|-----|----------|---------|-------------|
| `listen` | yes | — | The address and port. It must differ from every other server. |
| `password` | yes | — | The password for this view. |
| `cameras` | yes | — | The camera names this view may show, comma separated. |
| `username` | no | `viewer` | The user name for this view. |
| `webrtc` | no | `:8556`, then `:8557` | The media port. Every server needs its own, and it must not clash with a web port. |
| `allow_paths` | no | The standard list | As for `[server]`. |

`ipcam install`, `start`, `stop`, `restart` and `uninstall` cover every view as well as the main
server. `ipcam status` lists each one, and `ipcam logs <view>` follows a single view's log.

Add or remove a view in `cameras.ini`, then run `ipcam update`. It installs the service for a new
view and removes the one for a view you deleted.

The admin and the guest are separate logins on separate ports. The guest password is refused on the
admin port and the reverse, which you can check with `curl -u`. Guests use `http://<host>:8080/`.

Each view opens its own connection to a shared camera, and most cameras allow only two or three at
once, so avoid putting the same camera in many views that people watch at the same time.

### One address for everyone

By default each view has its own port, so guests use `http://<host>:8080/`. Add a `[proxy]` section
and everyone shares one address instead, each with their own login:

```ini
[proxy]
listen = :80

[server]
listen = :8081
username = admin
password = admin_password

[view:guest]
listen = :8082
username = guest
password = guest_password
cameras = house_front
```

Both open `http://<host>/`. The proxy checks the password and hands each person to their own server.
Every server moves to loopback automatically, so nothing outside the machine can reach them directly,
and `listen` on each becomes the loopback port it uses.

| Key | Required | Default | Description |
|-----|----------|---------|-------------|
| `listen` | no | `:80` | The one address everybody uses. |
| `realm` | no | `IP Camera Viewer` | The name the browser shows in its login box. |

The proxy shares one web address, but not the media ports. Each server still needs its own `webrtc`
port, reachable from the viewer, because WebRTC video goes straight from the browser to that server
and never through the proxy. The generator refuses a clash rather than letting a view fall back to a
slower transport without telling you.

Each user name must be unique, since the proxy tells people apart by it. `ipcam` runs the proxy
alongside the rest, `ipcam status` shows it, and `ipcam logs proxy` follows its log.

The proxy is a small program built for this, about 5.6 MB and 9 MB of memory, and it ships in the
release. It authenticates and forwards, nothing else. Video measured the same through it as without.

### What the server exposes

go2rtc serves its whole API on the same port as the page, and two of those endpoints return your
camera passwords in clear text. The generated config therefore answers only the paths the page needs:

```yaml
allow_paths: ['/', '/assets', '/cameras.json', '/api/ws', '/api/hls']
```

Everything else returns 404, including `/api/config` and `/api/streams`, and including requests from
the machine itself. So a person holding the viewer password can watch the cameras, but cannot read the
camera account out of the server.

This also blocks those endpoints for you. Widen the list temporarily when you want them for
diagnosis, then put it back:

```ini
[server]
allow_paths = /, /assets, /cameras.json, /api/ws, /api/hls, /api/streams
```

Note what this does not do. The stream endpoint accepts any stream name, so the viewer password
grants access to every camera, whatever the page chooses to show. Leaving a camera out of the page
hides it from the interface, not from the server. Use a second instance with its own cameras and its
own password when you need real separation.

### One camera on its own address

Give a camera a `route` and that path opens it fullscreen, with nothing else on the page:

```ini
[hallway]
route = hallway
host = 192.168.1.54
```

Then `http://<host>/hallway` shows the hallway camera. It is useful for a bookmark, a wall display or
a phone home-screen shortcut.

Opening a camera fullscreen from the grid puts the same address in the browser bar, so you can copy
it, and the back button returns to the grid. A camera with no `route` still opens fullscreen, it just
leaves the address alone.

Use letters, digits, `_` and `-`. Each route must be unique, and `api`, `assets`, `index.html` and
`cameras.json` are reserved.

A route needs a folder on disk, which `ipcam update` creates. `ipcam config show` lists every route
and says which one is missing, and `ipcam install`, `start` and `restart` recreate them.

### Protocol keys

A camera speaks a protocol when any key with that prefix appears. `onvif = on` turns a protocol on
with all defaults, and `onvif = off` turns it off even when its keys are present.

| Key | Required | Default | Description |
|-----|----------|---------|-------------|
| `rtsp.path` | yes, for RTSP | — | The path of the main stream. |
| `rtsp.sub_path` | no | — | The path of the low resolution stream. The grid plays it. |
| `rtsp.port` | no | `554` | The RTSP port. |
| `rtsp.username`, `rtsp.password` | no | The camera account | An account for RTSP only. |
| `onvif.port` | no | `80` | The ONVIF port. Tapo cameras use `2020`. |
| `onvif.profile` | no | The first profile | The ONVIF profile of the main stream. |
| `onvif.sub_profile` | no | — | The ONVIF profile of the low resolution stream. |
| `onvif.username`, `onvif.password` | no | The camera account | An account for ONVIF only. |
| `tapo.password` | yes, for Tapo | — | The TP-Link cloud password. |
| `tapo.username` | no | — | The TP-Link account email address. |

The Tapo password is **not** the RTSP password. The Tapo protocol uses your TP-Link cloud account.
The RTSP protocol uses the camera account from the Tapo app.

A `rtsp.sub_path` or `onvif.sub_profile` gives the largest performance gain. Most Tapo cameras serve
`/stream2` at a low resolution. `ipcam discover` finds the profiles for you.

The generator checks the file. It reports every problem, and then it writes no file. Two readers exist,
one in JavaScript for the source install and one in awk for the installed bundle, and a test in CI
proves that they produce the same output for the same file.

## Find cameras on the LAN

The script `scripts/discover-cameras.mjs` finds the cameras on your network. It sends a WS-Discovery
probe, sweeps the common camera ports on each local subnet, and prints the model and the
authentication state of each host. It has no npm dependency.

```bash
node scripts/discover-cameras.mjs
node scripts/discover-cameras.mjs --subnet 192.168.1.0/24 --json
ONVIF_USER=admin ONVIF_PASSWORD=secret node scripts/discover-cameras.mjs
```

### Write cameras.ini from a scan

With the camera account it can also write the config for you:

```bash
ONVIF_USER=admin ONVIF_PASSWORD=secret \
  node scripts/discover-cameras.mjs --write-config cameras.ini
```

It asks each camera over ONVIF for its stream profiles, and it takes the exact RTSP port and path
from the answer. The largest H264 profile becomes `rtsp.path`, and the smallest becomes `rtsp.sub_path`. When a
camera speaks no ONVIF, it tries the common RTSP paths with the same account instead.

It never overwrites an existing file. Use `-` to print the config instead of writing it.

Check the result before you use it:

- The names come from the camera model, such as `tapo_c210`, unless you gave the camera a name in its
  own app. Rename them to the room, for example `hallway`.
- The viewer password under `[server]` is random on a first scan. A later scan keeps the one already
  in the file. Pass `--keep-server <file>` to reuse a login from somewhere else.
- No `tapo.password` is written, because the TP-Link cloud password is not on the network.
- Without `ONVIF_USER` and `ONVIF_PASSWORD` it writes placeholders for the camera account, and it
  cannot read the stream path from a camera that needs a login.

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
| `--write-config <file>` | Write a `cameras.ini` for the cameras that were found. `-` means stdout. |
| `--keep-server <file>` | Reuse the `[server]` block of that file instead of generating a viewer login. |
| `--write-runtime <dir>` | Write `go2rtc.yaml` and `cameras.json` straight into a directory. |
| `--force` | Let `--write-runtime` replace an existing `go2rtc.yaml`. |

## Remote access

Tailscale is a good fit. Install Tailscale on the host and on your phone, then open the host's
MagicDNS name. go2rtc detects the host addresses at run time, so it advertises the Tailscale address
for WebRTC as soon as Tailscale is connected.

Run `ipcam url` to see the address and the viewer user name of the host.

Set `candidates` under `[server]` when you want a fixed list instead, for example on a host with many interfaces.
Do not use Tailscale Funnel. Funnel publishes the viewer to the open internet.

## Ports

| Port | Purpose |
|------|---------|
| 80, or `listen` under `[server]` | The page, the camera list, the WebSocket and the go2rtc API |
| 8555 TCP and UDP | WebRTC media |

The go2rtc API shares the web port. The viewer password protects every path on it.
Requests from the host itself skip the password. That is go2rtc behaviour.

## Where the passwords are

- `cameras.ini` holds the viewer password and the camera passwords in plain text.
- `bundle/go2rtc.yaml` holds the same values, because go2rtc reads them from there.
- The browser receives `cameras.json`. This file holds camera names and stream names only.
- The holder of the viewer password can read the camera passwords through the go2rtc API.
  Give the viewer password to people who may know the camera passwords.

## Docker

Docker is the alternative when you want no service on the host. It runs go2rtc behind nginx.
In this layout the go2rtc API stays inside the Docker network, and nginx proxies the stream paths only.

```bash
cp cameras.ini.example cameras.ini
cp .env.example .env
docker compose up --build
```

`HOST_IP` in `.env` is mandatory here. The container cannot detect the host addresses, so the
generator writes `HOST_IP` as the WebRTC candidate. Separate several addresses with a comma.
The Docker layout has no password. The `[server]` section is ignored.

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
| Write cameras.ini from a scan | `node scripts/discover-cameras.mjs --write-config cameras.ini` |
| Start the dev server | `cd frontend && npm run dev` |
| Build the frontend | `cd frontend && npm run build` |
| Check the code style | `cd frontend && npm run lint` |
| Start the Docker stack | `docker compose up --build` |

## Troubleshooting

**The browser asks for a password again and again.**
Check `username` and `password` under `[server]` in `cameras.ini`, then run `ipcam update`.

**The service does not start.**
Run `ipcam logs`. A common cause is another program on port 80. A port below 1024 can also need root
on some systems. Set `listen = :8080` under `[server]` in `cameras.ini`, then run `ipcam update`.

**A tile stays on "Connecting" or shows "Offline".**
Check that the camera answers on its RTSP port. Check the `rtsp.path` value.

**A route gives 404.**
Run `ipcam config show`. It lists each route and marks any whose folder is missing. Run `ipcam update`
to recreate them. Check too that the route is the one you meant: it is the `route` value, not a camera
name and not the viewer user name.

**The browser shows no camera.**
Run `ipcam update` and read the generator output.

**The tile is black, and the tile shows "Live".**
The substream path is wrong for that camera. Delete its `rtsp.sub_path` line.

**Video starts on the LAN but not over Tailscale.**
Check that Tailscale is connected on the host. Or set `candidates` under `[server]` to the LAN address and the
Tailscale address of the host, under `[server]`.

## Project layout

| Path | Content |
|------|---------|
| `frontend/` | The React client. See [frontend/README.md](frontend/README.md). |
| `scripts/generate-config.mjs` | It reads `cameras.ini`. It writes `go2rtc.yaml` and `cameras.json`. |
| `scripts/bundle.mjs` | It builds the self-contained bundle for a platform. |
| `scripts/discover-cameras.mjs` | It finds cameras on the LAN with WS-Discovery and a port sweep. |
| `scripts/lib/` | The INI reader and the shared config logic. No dependency. |
| `scripts/native/config.awk` | The same reader in awk. The installed bundle uses it, so it needs no Node.js. |
| `scripts/native/merge-ini.awk` | It merges a scan into an existing `cameras.ini`, matching on `host`. |
| `proxy/` | The small proxy that puts every view behind one address. Go, no dependencies. |
| `scripts/test-config-parity.mjs` | It proves the awk and JavaScript readers agree. CI runs it. |
| `scripts/native/` | The `ipcam` command, and the launchd and systemd templates for the bundle. |
| `install.sh` | The `curl \| sh` entry point. It installs a published release. |
| `.github/workflows/release.yml` | It builds and publishes a release on a `v*` tag. |
| `bundle/` | The generated bundle. Git ignores this directory. |
| `nginx/nginx.conf` | The nginx config for the Docker layout. |
| `docker-compose.yml` | The Docker layout: `config-gen`, `go2rtc` and `web`. |
| `cameras.ini` | Your passwords and cameras. Git ignores this file. |
