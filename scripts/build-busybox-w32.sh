#!/usr/bin/env bash
# Build busybox-w32 (a native Windows sh and the usual tools in one .exe)
# from the commit pinned in tools/busybox-w32.pin, cross-compiled with
# mingw-w64 as upstream does. It is the shell inside ShadowCode's Windows
# sandbox: Git for Windows' bash (MSYS2) cannot start in an AppContainer.
#
#   * Needs git, make, gcc, bzip2 and the x86_64-w64-mingw32 cross compiler
#     (Debian/Ubuntu: gcc-mingw-w64-x86-64).
#   * Output: packaging/busybox-w32/bin/busybox.exe with LICENSE (GPL-2.0)
#     and COMMIT naming the exact upstream source.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIN="$ROOT/tools/busybox-w32.pin"
field() { awk -F= -v key="$2" '$1 == key { print substr($0, length(key) + 2); exit }' "$1"; }
URL="$(field "$PIN" url)"
COMMIT="$(field "$PIN" commit)"
SRC="${SHADOWCODE_BUSYBOX_SRC:-$ROOT/tools/busybox-w32}"
OUT="$ROOT/packaging/busybox-w32/bin"
if [[ ! -d "$SRC/.git" ]]; then
  git clone --filter=blob:none "$URL" "$SRC"
fi
git -C "$SRC" remote set-url origin "$URL"
if ! git -C "$SRC" cat-file -e "$COMMIT^{commit}" 2>/dev/null; then
  git -C "$SRC" fetch --depth 1 origin "$COMMIT"
fi
git -C "$SRC" checkout -q --detach "$COMMIT"
make -C "$SRC" -s mingw64_defconfig >/dev/null
make -C "$SRC" -s -j"$(nproc)" CROSS_COMPILE=x86_64-w64-mingw32-
[[ -f "$SRC/busybox.exe" ]] || { echo "busybox-w32 build produced no busybox.exe" >&2; exit 1; }
rm -rf "$OUT.new"
mkdir -p "$OUT.new"
cp "$SRC/busybox.exe" "$OUT.new/busybox.exe"
cp "$SRC/LICENSE" "$OUT.new/LICENSE"
printf 'url=%s\ncommit=%s\nbuilt=%s\n' "$URL" "$COMMIT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$OUT.new/COMMIT"
rm -rf "$OUT"
mv "$OUT.new" "$OUT"
sha256sum "$OUT/busybox.exe"
