#!/usr/bin/env bash
# Exercise the real installer with a temporary application directory.
set -euo pipefail
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
export SHADOWCODE_APP_DIR="$root/Applications" HOME="$root/home" SHADOWCODE_VERSION=1.0.0
mkdir -p "$root/bin" "$SHADOWCODE_APP_DIR/ShadowCode.app" "$HOME"
export PATH="$root/bin:$PATH"
printf old > "$SHADOWCODE_APP_DIR/ShadowCode.app/generation"
for suffix in new previous; do printf keep > "$SHADOWCODE_APP_DIR/ShadowCode.app.$suffix"; done
cat > "$root/bin/curl" <<'MOCK'
#!/bin/bash
while [[ "$1" != -o ]]; do shift; done
case "$2" in
  *.sha256) for arch in aarch64 x64; do
    printf '%s  ShadowCode_1.0.0_%s.dmg\n' "$(printf image | shasum -a 256 | awk '{print $1}')" "$arch"
  done > "$2";;
  *.dmg) printf image > "$2";;
esac
MOCK
cat > "$root/bin/hdiutil" <<'MOCK'
#!/bin/bash
[[ "$1" = attach ]] || exit 0
while [[ "$1" != -mountpoint ]]; do shift; done
mkdir -p "$2/ShadowCode.app/Contents/MacOS"
touch "$2/ShadowCode.app/Contents/MacOS/shadowcode"
chmod +x "$2/ShadowCode.app/Contents/MacOS/shadowcode"
MOCK
cat > "$root/bin/mv" <<'MOCK'
#!/bin/bash
if [[ "${TEST_FINAL_MOVE_FAIL:-}" = 1 && "$1" = */new.app ]]; then exit 42; fi
exec /bin/mv "$@"
MOCK
chmod +x "$root/bin/"*
if TEST_FINAL_MOVE_FAIL=1 bash scripts/install-macos.sh; then exit 1; fi
[[ "$(cat "$SHADOWCODE_APP_DIR/ShadowCode.app/generation")" = old ]]
bash scripts/install-macos.sh
[[ -x "$HOME/.local/bin/shadowcode" && ! -e "$SHADOWCODE_APP_DIR/.shadowcode-install.lock" ]]
for suffix in new previous; do [[ "$(cat "$SHADOWCODE_APP_DIR/ShadowCode.app.$suffix")" = keep ]]; done

