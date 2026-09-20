#!/bin/sh
set -eu

BUNDLE_DIR=$(cd "$(dirname "$0")" && pwd)
LABEL="io.ipcam-viewer.go2rtc"
UNIT_NAME="ipcam-viewer"
ACTION="${1:-install}"
RUN_USER="${SUDO_USER:-$(id -un)}"

render() {
  sed -e "s#{{BUNDLE_DIR}}#$BUNDLE_DIR#g" -e "s#{{LABEL}}#$LABEL#g" -e "s#{{USER}}#$RUN_USER#g" "$1"
}

macos_plist() {
  echo "$HOME/Library/LaunchAgents/$LABEL.plist"
}

install_macos() {
  PLIST=$(macos_plist)
  mkdir -p "$(dirname "$PLIST")"
  render "$BUNDLE_DIR/service/launchd.plist" > "$PLIST"
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "Installed and started launchd agent $LABEL"
  echo "Log: $BUNDLE_DIR/go2rtc.log"
}

uninstall_macos() {
  PLIST=$(macos_plist)
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  rm -f "$PLIST"
  echo "Removed launchd agent $LABEL"
}

status_macos() {
  launchctl print "gui/$(id -u)/$LABEL" | grep -E "state|pid|last exit" || echo "$LABEL is not loaded"
}

install_linux() {
  UNIT="/etc/systemd/system/$UNIT_NAME.service"
  render "$BUNDLE_DIR/service/systemd.service" | sudo tee "$UNIT" >/dev/null
  sudo systemctl daemon-reload
  sudo systemctl enable --now "$UNIT_NAME"
  echo "Installed and started systemd unit $UNIT_NAME"
  echo "Log: journalctl -u $UNIT_NAME -f"
}

uninstall_linux() {
  sudo systemctl disable --now "$UNIT_NAME" >/dev/null 2>&1 || true
  sudo rm -f "/etc/systemd/system/$UNIT_NAME.service"
  sudo systemctl daemon-reload
  echo "Removed systemd unit $UNIT_NAME"
}

status_linux() {
  systemctl status "$UNIT_NAME" --no-pager || true
}

case "$(uname -s)" in
  Darwin) OS=macos ;;
  Linux) OS=linux ;;
  *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac

case "$ACTION" in
  install) "install_$OS" ;;
  uninstall) "uninstall_$OS" ;;
  restart) "uninstall_$OS" >/dev/null; "install_$OS" ;;
  status) "status_$OS" ;;
  *) echo "Usage: $0 [install|uninstall|restart|status]" >&2; exit 1 ;;
esac
