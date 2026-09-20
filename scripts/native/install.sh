#!/bin/sh
set -eu
DIR=$(cd "$(dirname "$0")" && pwd)
exec "$DIR/ipcam" "${1:-install}"
