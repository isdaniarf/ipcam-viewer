#!/bin/sh
set -eu

REPO="${IPCAM_REPO:-isdaniarf/ipcam-viewer}"
VERSION="${IPCAM_VERSION:-latest}"
PREFIX="${IPCAM_PREFIX:-$HOME/.local/share/ipcam-viewer}"
BIN_DIR="${IPCAM_BIN_DIR:-$HOME/.local/bin}"
KEEP_CONFIG="${IPCAM_KEEP_CONFIG:-0}"

say() { printf '%s\n' "$*"; }
die() { printf 'install: %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required but not installed"; }
need curl
need tar

detect_platform() {
  system=$(uname -s)
  machine=$(uname -m)
  case "$system:$machine" in
    Darwin:arm64) printf 'mac_arm64\n' ;;
    Darwin:x86_64) printf 'mac_amd64\n' ;;
    Linux:x86_64) printf 'linux_amd64\n' ;;
    Linux:aarch64|Linux:arm64) printf 'linux_arm64\n' ;;
    Linux:armv7l|Linux:armv6l) printf 'linux_arm\n' ;;
    *) die "unsupported platform $system $machine" ;;
  esac
}

go2rtc_asset() {
  case $1 in
    mac_arm64) printf 'go2rtc_mac_arm64.zip\n' ;;
    mac_amd64) printf 'go2rtc_mac_amd64.zip\n' ;;
    linux_amd64) printf 'go2rtc_linux_amd64\n' ;;
    linux_arm64) printf 'go2rtc_linux_arm64\n' ;;
    linux_arm) printf 'go2rtc_linux_arm\n' ;;
    *) die "unknown platform $1" ;;
  esac
}

PLATFORM=$(detect_platform)
if [ "$VERSION" = latest ]; then
  ARCHIVE_URL="https://github.com/$REPO/releases/latest/download/ipcam-viewer-$PLATFORM.tar.gz"
else
  ARCHIVE_URL="https://github.com/$REPO/releases/download/$VERSION/ipcam-viewer-$PLATFORM.tar.gz"
fi

SCRATCH=$(mktemp -d)
cleanup() { rm -rf "$SCRATCH"; }
trap cleanup EXIT INT TERM

say "Platform: $PLATFORM"
say "Download $ARCHIVE_URL"
curl -fsSL "$ARCHIVE_URL" -o "$SCRATCH/app.tar.gz" \
  || die "could not download the release. Check that $REPO has a release for $PLATFORM."
tar -xzf "$SCRATCH/app.tar.gz" -C "$SCRATCH" || die "the archive is not readable"
[ -f "$SCRATCH/ipcam" ] || die "the archive holds no ipcam command"

GO2RTC_VERSION=$(sed -n 's/^go2rtc=//p' "$SCRATCH/build-info" 2>/dev/null | head -1)
[ -n "$GO2RTC_VERSION" ] || die "the archive records no go2rtc version"

ASSET=$(go2rtc_asset "$PLATFORM")
GO2RTC_URL="https://github.com/AlexxIT/go2rtc/releases/download/v$GO2RTC_VERSION/$ASSET"
say "Download go2rtc $GO2RTC_VERSION"
curl -fsSL "$GO2RTC_URL" -o "$SCRATCH/$ASSET" || die "could not download go2rtc from $GO2RTC_URL"

case $ASSET in
  *.zip)
    need unzip
    unzip -o -q "$SCRATCH/$ASSET" -d "$SCRATCH/go2rtc-unpacked" || die "could not unpack $ASSET"
    binary=$(find "$SCRATCH/go2rtc-unpacked" -type f -name go2rtc | head -1)
    [ -n "$binary" ] || die "the go2rtc archive holds no binary"
    mv "$binary" "$SCRATCH/go2rtc"
    rm -rf "$SCRATCH/$ASSET" "$SCRATCH/go2rtc-unpacked"
    ;;
  *) mv "$SCRATCH/$ASSET" "$SCRATCH/go2rtc" ;;
esac
chmod +x "$SCRATCH/go2rtc" "$SCRATCH/ipcam"

if [ "$KEEP_CONFIG" = 1 ] && [ -d "$PREFIX" ]; then
  for keep in go2rtc.yaml cameras.json; do
    [ -f "$PREFIX/$keep" ] && cp "$PREFIX/$keep" "$SCRATCH/$keep"
  done
fi

mkdir -p "$PREFIX"
rm -rf "$PREFIX/www" "$PREFIX/service"
for item in "$SCRATCH"/*; do
  name=$(basename "$item")
  [ "$name" = "app.tar.gz" ] && continue
  [ "$name" = "go2rtc-unpacked" ] && continue
  rm -rf "$PREFIX/$name"
  mv "$item" "$PREFIX/$name"
done

if [ "$(uname -s)" = Darwin ]; then
  xattr -d com.apple.quarantine "$PREFIX/go2rtc" 2>/dev/null || true
  xattr -d com.apple.quarantine "$PREFIX/ipcam" 2>/dev/null || true
fi

mkdir -p "$BIN_DIR"
ln -sf "$PREFIX/ipcam" "$BIN_DIR/ipcam"

say ""
say "Installed in $PREFIX"
say "Command:   $BIN_DIR/ipcam"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) say "Note: $BIN_DIR is not in PATH. Add it in your shell profile." ;;
esac

if [ -f "$PREFIX/go2rtc.yaml" ]; then
  say ""
  say "Config found. Starting the service."
  "$PREFIX/ipcam" install --no-link
else
  say ""
  say "Next: copy your config from a machine that already runs the viewer."
  say "  there:  ipcam config export ~/ipcam-config.tgz"
  say "  here:   ipcam config import ~/ipcam-config.tgz"
  say "  then:   ipcam install"
fi
