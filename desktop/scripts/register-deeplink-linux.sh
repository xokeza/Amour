#!/usr/bin/env bash
# registers the amour:// protocol for xdg-open (linux dev testing).
# packaged installs self-register via electron-builder protocols, this is
# only so a dev checkout answers share-link clicks too.
# usage: ./scripts/register-deeplink-linux.sh [--binary /path/to/amour]
set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$HOME/.local/share/applications"

if [ "${1:-}" = "--binary" ]; then
  BIN="${2:?pass a binary path after --binary}"
  [ -x "$BIN" ] || { echo "not executable: $BIN" >&2; exit 1; }
  EXEC="$BIN %u"
  ENTRY="amour-handler.desktop"
  LABEL="Amour!"
else
  ELECTRON="$DESKTOP_DIR/node_modules/.bin/electron"
  [ -x "$ELECTRON" ] || { echo "electron not found, run pnpm install first" >&2; exit 1; }
  # second instance forwards the url to the running dev app and quits,
  # so keep the vite dev server running for this to open anything
  EXEC="$ELECTRON $DESKTOP_DIR %u"
  ENTRY="amour-dev.desktop"
  LABEL="Amour! (dev)"
fi

mkdir -p "$APP_DIR"
cat > "$APP_DIR/$ENTRY" <<EOF
[Desktop Entry]
Name=$LABEL
Exec=$EXEC
Type=Application
Terminal=false
NoDisplay=true
MimeType=x-scheme-handler/amour;
EOF

update-desktop-database "$APP_DIR" >/dev/null 2>&1 || true
xdg-mime default "$ENTRY" x-scheme-handler/amour

echo "handler: $(xdg-mime query default x-scheme-handler/amour)"
echo "test with: xdg-open 'amour://artist?id=UCGtGpOIGHfRu1KYL9pi-mNQ'"
