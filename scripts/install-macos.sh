#!/usr/bin/env bash
# Install or update ShadowCode on macOS from its GitHub release:
#
#   curl -fsSL https://raw.githubusercontent.com/ShadowfetchStudio/ShadowCode/main/scripts/install-macos.sh | bash
#
#   * Downloads ShadowCode_<version>_<arch>.dmg (x64 for Intel, aarch64 for
#     Apple silicon) and the release's ShadowCode_<version>_macos.sha256, and
#     refuses the image unless its SHA-256 matches.
#   * Copies ShadowCode.app into /Applications (or ~/Applications when
#     /Applications is not writable), replacing an earlier copy only after the
#     new one is complete. Settings and history live elsewhere
#     (~/Library/Application Support/ShadowCode) and are kept.
#   * Links the command-line tool as ~/.local/bin/shadowcode.
#   * The app is not notarized by Apple. Files fetched with curl are not
#     marked as downloaded, so macOS opens it without the "unidentified
#     developer" block; a .dmg downloaded in a browser needs System Settings ›
#     Privacy & Security › Open Anyway once instead.
#
# Environment: SHADOWCODE_VERSION (default: the latest release),
# SHADOWCODE_APP_DIR (default: /Applications).
set -euo pipefail
REPO="ShadowfetchStudio/ShadowCode"
fail() { printf 'ShadowCode installer: %s\n' "$*" >&2; exit 1; }
[[ "$(uname -s)" == Darwin ]] || fail "this installer is for macOS."

case "$(uname -m)" in
  x86_64) ARCH=x64 ;;
  arm64) ARCH=aarch64 ;;
  *) fail "unsupported processor $(uname -m)." ;;
esac
# A shell running under Rosetta reports x86_64 on Apple silicon.
if [[ "$ARCH" == x64 && "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" == 1 ]]; then
  ARCH=aarch64
fi

fetch() { curl -fsSL --proto '=https' --tlsv1.2 --retry 3 "$@"; }
VERSION="${SHADOWCODE_VERSION:-}"
if [[ -z "$VERSION" ]]; then
  # The latest release's page redirects to its tag; no API token needed.
  LATEST="$(curl -fsSI --proto '=https' --tlsv1.2 "https://github.com/$REPO/releases/latest" \
    | awk 'tolower($1) == "location:" { print $2 }' | tr -d '\r')"
  VERSION="${LATEST##*/tag/v}"
fi
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "could not tell which version to install (got '$VERSION')."

DMG="ShadowCode_${VERSION}_${ARCH}.dmg"
SUMS="ShadowCode_${VERSION}_macos.sha256"
BASE="https://github.com/$REPO/releases/download/v$VERSION"
WORK="$(mktemp -d)"
MOUNT=""
cleanup() {
  if [[ -n "$MOUNT" ]]; then hdiutil detach -quiet "$MOUNT" 2>/dev/null || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

printf 'Downloading ShadowCode %s for %s...\n' "$VERSION" "$([[ $ARCH == x64 ]] && echo Intel || echo 'Apple silicon')"
fetch -o "$WORK/$SUMS" "$BASE/$SUMS" || fail "release v$VERSION has no macOS checksums ($SUMS)."
fetch -o "$WORK/$DMG" "$BASE/$DMG" || fail "release v$VERSION has no $DMG."
EXPECTED="$(awk -v name="$DMG" '$2 == name || $2 == "*" name { print $1 }' "$WORK/$SUMS")"
ACTUAL="$(shasum -a 256 "$WORK/$DMG" | awk '{ print $1 }')"
[[ "$EXPECTED" =~ ^[0-9a-f]{64}$ && "$EXPECTED" == "$ACTUAL" ]] || fail "$DMG does not match the release's checksum; nothing was installed."

MOUNT="$WORK/mount"
mkdir "$MOUNT"
hdiutil attach -quiet -nobrowse -readonly -noautoopen -mountpoint "$MOUNT" "$WORK/$DMG" || fail "could not open $DMG."
[[ -x "$MOUNT/ShadowCode.app/Contents/MacOS/shadowcode" ]] || fail "$DMG does not contain ShadowCode.app."

DEST="${SHADOWCODE_APP_DIR:-/Applications}"
if [[ ! -w "$DEST" ]]; then
  DEST="$HOME/Applications"
  mkdir -p "$DEST"
fi
APP="$DEST/ShadowCode.app"
if pgrep -f "$APP/Contents/MacOS/shadowcode" >/dev/null 2>&1; then
  fail "ShadowCode is running; quit it (ShadowCode › Quit) and run the installer again."
fi
rm -rf "$APP.new" "$APP.previous"
ditto "$MOUNT/ShadowCode.app" "$APP.new"
if [[ -e "$APP" ]]; then mv "$APP" "$APP.previous"; fi
mv "$APP.new" "$APP"
rm -rf "$APP.previous"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

mkdir -p "$HOME/.local/bin"
ln -sf "$APP/Contents/MacOS/shadowcode" "$HOME/.local/bin/shadowcode"
printf 'Installed ShadowCode %s in %s.\n' "$VERSION" "$APP"
case ":$PATH:" in
  *":$HOME/.local/bin:"*) printf 'The shadowcode command is ready in this terminal.\n' ;;
  *) printf 'For the shadowcode command, add ~/.local/bin to your PATH:\n  echo '\''export PATH="$HOME/.local/bin:$PATH"'\'' >> ~/.zprofile\n' ;;
esac
printf 'Open it from Applications, or run: open -a ShadowCode\n'
