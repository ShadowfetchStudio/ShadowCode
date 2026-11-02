#!/usr/bin/env bash
# Keep the caller's directory and language-runtime environment. The generic
# AppImageKit launcher changes to AppDir/usr and injects a nonexistent Python home.
set -eo pipefail
APPDIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
export APPDIR
# Rolling distributions can have a newer Mesa/WebKit stack whose EGL libraries
# cannot be mixed with the bundled Debian GTK stack. Prefer a complete host stack
# when its helper layout differs, never a half-host set of libraries. Release
# WebKit ignores WEBKIT_EXEC_PATH, so inspect the compiled path in the library.
shadowcode_stack="${SHADOWCODE_APPIMAGE_STACK:-auto}"
case "$shadowcode_stack" in auto|host|bundled) ;; *) echo 'SHADOWCODE_APPIMAGE_STACK must be auto, host or bundled' >&2; exit 1;; esac
shadowcode_gui=0
[[ $# == 0 ]] && shadowcode_gui=1
for shadowcode_arg in "$@"; do [[ "$shadowcode_arg" == ui ]] && shadowcode_gui=1; done
shadowcode_host_path="/usr/lib:/usr/lib64:/lib:/lib64:/usr/lib/x86_64-linux-gnu:/lib/x86_64-linux-gnu:/usr/lib/aarch64-linux-gnu:/lib/aarch64-linux-gnu"
shadowcode_use_host=0
if [[ "$shadowcode_gui" == 1 && "$shadowcode_stack" != bundled && -x /usr/bin/ldd && -x /usr/bin/strings ]]; then
    shadowcode_deps="$(LC_ALL=C LD_LIBRARY_PATH="$shadowcode_host_path" /usr/bin/ldd "$APPDIR/usr/bin/shadowcode" 2>/dev/null || true)"
    shadowcode_complete=1
    [[ -n "$shadowcode_deps" && "$shadowcode_deps" != *"not found"* && "$shadowcode_deps" != *"$APPDIR"* ]] || shadowcode_complete=0
    for shadowcode_lib in libwebkit2gtk-4.1.so.0 libjavascriptcoregtk-4.1.so.0 libgtk-3.so.0 libgdk-3.so.0 libglib-2.0.so.0 libgio-2.0.so.0 libgobject-2.0.so.0 libepoxy.so.0; do
        [[ "$shadowcode_deps" == *"$shadowcode_lib => /"* ]] || shadowcode_complete=0
    done
    shadowcode_webkit="$(printf '%s\n' "$shadowcode_deps" | awk '$1 == "libwebkit2gtk-4.1.so.0" && $2 == "=>" {print $3; exit}')"
    shadowcode_helpers=""
    if [[ "$shadowcode_complete" == 1 && -f "$shadowcode_webkit" ]]; then
        shadowcode_helpers="$(/usr/bin/strings "$shadowcode_webkit" | grep -m1 -E '^/[^[:space:]]*/webkit2gtk-4\.1/?$' || true)"
    fi
    if [[ -x "$shadowcode_helpers/WebKitWebProcess" && -x "$shadowcode_helpers/WebKitNetworkProcess" ]]; then
        if [[ "$shadowcode_stack" == host || ( "$shadowcode_helpers" != /usr/lib/x86_64-linux-gnu/webkit2gtk-4.1 && "$shadowcode_helpers" != /usr/lib/aarch64-linux-gnu/webkit2gtk-4.1 ) ]]; then
            shadowcode_use_host=1
        fi
    fi
fi
if [[ "$shadowcode_stack" == host && "$shadowcode_gui" == 1 && "$shadowcode_use_host" != 1 ]]; then
    echo 'A complete compatible host WebKitGTK stack and both helpers are required.' >&2
    exit 1
fi
if [[ "$shadowcode_use_host" == 1 ]]; then
    # Keep APPDIR/APPIMAGE so extraction ownership and cleanup remain intact.
    export LD_LIBRARY_PATH="$shadowcode_host_path"
    exec "$APPDIR/usr/bin/shadowcode" "$@"
fi
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
