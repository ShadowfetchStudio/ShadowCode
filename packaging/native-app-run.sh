#!/usr/bin/env bash
# Keep the caller's directory and language-runtime environment. The generic
# AppImageKit launcher changes to AppDir/usr and injects a nonexistent Python home.
set -eo pipefail
APPDIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
export APPDIR
# The bundled GTK hook defaults to X11. Preserve an explicit caller choice,
# including Wayland, while keeping that default when no backend was selected.
shadowcode_gdk_backend="${GDK_BACKEND-}"
source "$APPDIR/apprun-hooks/linuxdeploy-plugin-gtk.sh"
if [ -n "$shadowcode_gdk_backend" ]; then
    export GDK_BACKEND="$shadowcode_gdk_backend"
fi
unset shadowcode_gdk_backend
# The bundler copies host libraries into the Debian multiarch directory of the
# architecture the AppImage was built on (x86_64 or aarch64).
shadowcode_multiarch=x86_64-linux-gnu
if [ -d "$APPDIR/usr/lib/aarch64-linux-gnu" ]; then
    shadowcode_multiarch=aarch64-linux-gnu
fi
export LD_LIBRARY_PATH="$APPDIR/usr/lib:$APPDIR/usr/lib/$shadowcode_multiarch:$APPDIR/usr/lib64${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
unset shadowcode_multiarch
exec "$APPDIR/usr/bin/shadowcode" "$@"
