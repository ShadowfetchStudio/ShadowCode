#!/usr/bin/env bash
# Build busybox-w32 (a native Windows sh and the usual tools in one .exe)
# from the commit pinned in tools/busybox-w32.pin, cross-compiled with
# mingw-w64 as upstream does. It is the shell inside ShadowCode's Windows
# sandbox: Git for Windows' bash (MSYS2) cannot start in an AppContainer.
#
#   * Needs git, make, gcc, bzip2 and the x86_64-w64-mingw32 cross compiler
#     (Debian/Ubuntu: gcc-mingw-w64-x86-64).
#   * The patches in tools/busybox-w32-patches are applied (and shipped with
#     the source notice): the null device opens inside an AppContainer.
#   * Output: packaging/busybox-w32/bin/busybox.exe with LICENSE (GPL-2.0),
#     COMMIT naming the exact upstream source, and the applied patches.
#   * --source-archive FILE also writes the complete corresponding source
#     (the upstream tree at the pinned commit, ShadowCode's patches and the
#     pin) as a .tar.gz, published beside each Windows release.
set -euo pipefail
ARCHIVE=""
while (($#)); do
  case "$1" in
    --source-archive) ARCHIVE="${2:?--source-archive needs a file}"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
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
git -C "$SRC" checkout -q --force --detach "$COMMIT"
# ShadowCode's patches (tools/busybox-w32-patches), applied in order.
for patch in "$ROOT"/tools/busybox-w32-patches/*.patch; do
  git -C "$SRC" apply "$patch"
done
make -C "$SRC" -s mingw64_defconfig >/dev/null
make -C "$SRC" -s -j"$(nproc)" CROSS_COMPILE=x86_64-w64-mingw32-
[[ -f "$SRC/busybox.exe" ]] || { echo "busybox-w32 build produced no busybox.exe" >&2; exit 1; }
rm -rf "$OUT.new"
mkdir -p "$OUT.new"
cp "$SRC/busybox.exe" "$OUT.new/busybox.exe"
cp "$SRC/LICENSE" "$OUT.new/LICENSE"
mkdir -p "$OUT.new/patches"
cp "$ROOT"/tools/busybox-w32-patches/*.patch "$OUT.new/patches/"
printf 'url=%s\ncommit=%s\nbuilt=%s\n' "$URL" "$COMMIT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$OUT.new/COMMIT"
rm -rf "$OUT"
mv "$OUT.new" "$OUT"
sha256sum "$OUT/busybox.exe"
if [[ -n "$ARCHIVE" ]]; then
  STAGE="$(mktemp -d)"
  trap 'rm -rf "$STAGE"' EXIT
  NAME="busybox-w32-${COMMIT:0:12}"
  mkdir -p "$STAGE/$NAME/shadowcode-patches"
  git -C "$SRC" archive --format=tar "$COMMIT" | tar -x -C "$STAGE/$NAME"
  cp "$ROOT"/tools/busybox-w32-patches/*.patch "$STAGE/$NAME/shadowcode-patches/"
  cp "$PIN" "$STAGE/$NAME/shadowcode-patches/busybox-w32.pin"
  cat > "$STAGE/$NAME/shadowcode-patches/README" <<NOTE
busybox-w32 as shipped in ShadowCode for Windows (busybox.exe, GPL-2.0).
Source: $URL at commit $COMMIT, unmodified in this folder's parent.
ShadowCode applies the patches here in order (git apply), then builds with
  make mingw64_defconfig && make CROSS_COMPILE=x86_64-w64-mingw32-
(see scripts/build-busybox-w32.sh in ShadowCode's source).
NOTE
  mkdir -p "$(dirname "$ARCHIVE")"
  tar -C "$STAGE" --sort=name --owner=0 --group=0 --numeric-owner \
    --mtime="@$(git -C "$SRC" show -s --format=%ct "$COMMIT")" -cf - "$NAME" | gzip -n -9 > "$ARCHIVE"
  sha256sum "$ARCHIVE"
fi
