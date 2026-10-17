#!/usr/bin/env bash
# Build ShadowCode.app and ShadowCode_<version>_<arch>.dmg on macOS.
#
#   * The pinned llama.cpp runtime (Metal + CPU) is built first when
#     packaging/llama.cpp/bin does not already hold a macOS build of the pinned
#     commit (scripts/build-llama.cpp.sh --no-user-install), then bundled into
#     ShadowCode.app/Contents/Resources/llama.cpp.
#   * The app is signed ad hoc ("-"): it runs on this Mac and on Apple
#     silicon, but Gatekeeper asks before the first launch of a downloaded
#     copy until the app is signed with a Developer ID and notarized.
#   * Needs Xcode (or the Command Line Tools plus Xcode's metal compiler for
#     the runtime), Rust 1.95.0, Node 22 and cmake.
#
# Outputs (in $CARGO_TARGET_DIR or target/): release/bundle/macos/ShadowCode.app
# and release/bundle/dmg/ShadowCode_<version>_<arch>.dmg.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ "$(uname -s)" == Darwin ]] || { echo "Build the macOS app on macOS." >&2; exit 1; }
RUNTIME="$ROOT/packaging/llama.cpp/bin"
field() { [[ -f "$1" ]] && awk -F= -v key="$2" '$1 == key { print substr($0, length(key) + 2); exit }' "$1"; }
PINNED="$(field "$ROOT/tools/llama.cpp.pin" commit)"
if [[ ! -x "$RUNTIME/llama-server" || ! -f "$RUNTIME/default.metallib" \
      || "$(field "$RUNTIME/COMMIT" commit || true)" != "$PINNED" ]]; then
  bash "$ROOT/scripts/build-llama.cpp.sh" --no-user-install
fi
if [[ ! -x "$ROOT/ui/node_modules/.bin/tauri" ]]; then
  npm --prefix "$ROOT/ui" ci
fi
# CI=true keeps the DMG step from scripting Finder (which needs a desktop
# session and Automation permission); the image is the same.
cd "$ROOT"
CI=true "$ROOT/ui/node_modules/.bin/tauri" build --bundles app,dmg \
  --config "$ROOT/packaging/macos/bundle-runtime.conf.json"
TARGET="${CARGO_TARGET_DIR:-$ROOT/target}"
APP="$TARGET/release/bundle/macos/ShadowCode.app"
[[ -x "$APP/Contents/MacOS/shadowcode" && -x "$APP/Contents/Resources/llama.cpp/llama-server" ]] \
  || { echo "The bundle is missing the app or its runtime: $APP" >&2; exit 1; }
codesign --verify --deep --strict "$APP"
printf 'Built %s\n' "$APP"
ls "$TARGET"/release/bundle/dmg/*.dmg
