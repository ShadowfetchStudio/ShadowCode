#!/bin/bash
# Executed by flatpak-builder without network access. Sources and caches are
# staged from the lockfiles by scripts/build-flatpak.py.
set -euo pipefail
npm --prefix ui ci --offline --ignore-scripts --cache "$PWD/.npm-cache"
npm --prefix ui run build
# Source archives use canonical timestamps. Compare content before reusing
# the application's crates; packaging-only retries retain their finished link.
source_hash=$( { printf '%s\n' "${SHADOWCODE_COMMIT:-}"; find native/core/src src-tauri/src ui/dist NOTICE TRADEMARKS.md Cargo.toml Cargo.lock native/core/Cargo.toml src-tauri/Cargo.toml src-tauri/build.rs src-tauri/tauri.conf.json -type f -print0 | sort -z | xargs -0 sha256sum; } | sha256sum | cut -d' ' -f1)
fingerprint="${CARGO_TARGET_DIR:-target}/shadowcode-source.sha256"
if [[ ! -f "$fingerprint" || "$(cat "$fingerprint")" != "$source_hash" ]]; then
  cargo clean --release -p shadowcode-core -p shadowcode-desktop
fi
cargo build --offline --locked --release -p shadowcode-desktop
printf '%s\n' "$source_hash" > "$fingerprint"
install -Dm755 "${CARGO_TARGET_DIR:-target}/release/shadowcode" /app/bin/shadowcode-native
install -Dm755 packaging/flatpak/shadowcode-launch /app/bin/shadowcode
install -Dm755 packaging/flatpak/shadowcode-host /app/libexec/shadowcode-host
cc -static -Os -Wall -Wextra -Werror packaging/flatpak/host-monitor.c -o /app/libexec/shadowcode-host-monitor
strip /app/libexec/shadowcode-host-monitor
install -Dm644 packaging/flatpak/host-monitor.c /app/share/licenses/shadowcode/host-monitor.c

native_cache="${SHADOWCODE_NATIVE_CACHE:-$PWD/target}"
spirv_commit=$(sed -n 's/^spirv_headers_commit=//p' tools/llama.cpp.pin)
llama_commit=$(sed -n 's/^commit=//p' tools/llama.cpp.pin)
spirv_prefix="$native_cache/spirv-$spirv_commit"
llama_build="$native_cache/llama-$llama_commit"
cmake -S tools/spirv-headers -B "$native_cache/spirv-build-$spirv_commit" -G Ninja -DCMAKE_INSTALL_PREFIX="$spirv_prefix"
cmake --install "$native_cache/spirv-build-$spirv_commit"
cmake -S tools/llama.cpp -B "$llama_build" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON \
  -DLLAMA_BUILD_COMMIT="$llama_commit" \
  -DGGML_BACKEND_DL=ON -DGGML_CPU_ALL_VARIANTS=ON -DGGML_NATIVE=OFF \
  -DGGML_CUDA=OFF -DGGML_VULKAN=ON -DVulkan_GLSLC_EXECUTABLE=/usr/bin/glslc \
  -DCMAKE_PREFIX_PATH="$spirv_prefix" \
  -DCMAKE_C_FLAGS="-isystem $spirv_prefix/include" \
  -DCMAKE_CXX_FLAGS="-isystem $spirv_prefix/include" \
  -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_TOOLS=ON \
  -DLLAMA_BUILD_SERVER=ON -DLLAMA_BUILD_UI=OFF -DLLAMA_USE_PREBUILT_UI=OFF -DLLAMA_CURL=OFF \
  -DCMAKE_INSTALL_RPATH='$ORIGIN' -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON
cmake --build "$llama_build" --target llama-server llama-cli --parallel "${SHADOWCODE_BUILD_JOBS:-4}"
mkdir -p /app/lib/shadowcode/NOTICES
install -m755 "$llama_build/bin/llama-server" "$llama_build/bin/llama-cli" /app/lib/shadowcode/
cp -a "$llama_build/bin/"*.so* /app/lib/shadowcode/
cp tools/llama.cpp.pin /app/lib/shadowcode/COMMIT
printf 'built=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> /app/lib/shadowcode/COMMIT
cp tools/llama.cpp/LICENSE /app/lib/shadowcode/NOTICES/llama.cpp-LICENSE
cp tools/llama.cpp/licenses/LICENSE-jsonhpp /app/lib/shadowcode/NOTICES/nlohmann-json-LICENSE
cp tools/llama.cpp/vendor/cpp-httplib/LICENSE /app/lib/shadowcode/NOTICES/cpp-httplib-LICENSE
sed -n '/This software is available under 2 licenses/,$p' tools/llama.cpp/vendor/stb/stb_image.h > /app/lib/shadowcode/NOTICES/stb_image-LICENSE
sed -n '/This software is available as a choice of the following licenses/,$p' tools/llama.cpp/vendor/miniaudio/miniaudio.h > /app/lib/shadowcode/NOTICES/miniaudio-LICENSE
sed -n '1,/For more information, please refer to/p' tools/llama.cpp/vendor/sheredom/subprocess.h > /app/lib/shadowcode/NOTICES/subprocess.h-LICENSE
cp tools/spirv-headers/LICENSE /app/lib/shadowcode/NOTICES/SPIRV-Headers-LICENSE
sed -n '/LLM_ARCH_NAMES = {/,/^};/p' tools/llama.cpp/src/llama-arch.cpp | sed -n 's/.*"\([^"]*\)".*/\1/p' > /app/lib/shadowcode/architectures.txt

# Git and Node are fallbacks when a host installation is absent. Host tools
# discovered by the launcher take precedence for normal developer workflows.
install -Dm755 /usr/bin/git /app/libexec/git-native
cp -a /usr/libexec/git-core /app/libexec/git-core
printf '#!/bin/sh\nGIT_EXEC_PATH=/app/libexec/git-core exec /app/libexec/git-native "$@"\n' > /app/bin/git
chmod 755 /app/bin/git
install -Dm755 /usr/lib/sdk/node24/bin/node /app/bin/node
cp -a /usr/lib/sdk/node24/lib/node_modules /app/lib/
printf '#!/bin/sh\nexec /app/bin/node /app/lib/node_modules/npm/bin/npm-cli.js "$@"\n' > /app/bin/npm
chmod 755 /app/bin/npm

install -Dm644 packaging/flatpak/com.shadowfetch.shadowcode.desktop /app/share/applications/com.shadowfetch.shadowcode.desktop
install -Dm644 packaging/com.shadowfetch.shadowcode.appdata.xml /app/share/metainfo/com.shadowfetch.shadowcode.appdata.xml
for size in 32 128 256 512; do
  install -Dm644 "assets/icons/shadow-agent-$size.png" "/app/share/icons/hicolor/${size}x${size}/apps/com.shadowfetch.shadowcode.png"
done
install -Dm644 LICENSE /app/share/licenses/shadowcode/LICENSE
install -Dm644 NOTICE /app/share/licenses/shadowcode/NOTICE
install -Dm644 TRADEMARKS.md /app/share/licenses/shadowcode/TRADEMARKS.md
cp -a licenses/native /app/share/licenses/shadowcode/native
cp -a vendor/glib-0.18.5/LICENSE /app/share/licenses/shadowcode/glib-LICENSE
cp -a /usr/lib/sdk/node24/share/licenses /app/share/licenses/shadowcode/node-sdk
for component in glibc gcc git; do
  cp -a "/usr/share/licenses/freedesktop-sdk/$component" "/app/share/licenses/shadowcode/sdk-$component"
done
ln -s /app/lib/shadowcode packaging/llama.cpp/bin
node --input-type=module -e 'import {applicationNotices} from "./scripts/native-notices.mjs"; import {readManagedRuntime} from "./scripts/llama-runtime.mjs"; await applicationNotices("/app/share/licenses/shadowcode/third-party", await readManagedRuntime(), "/usr/lib/sdk/rust-stable/share/doc/rust");'
appstreamcli validate --no-net /app/share/metainfo/com.shadowfetch.shadowcode.appdata.xml
/app/bin/shadowcode-native --version
/app/lib/shadowcode/llama-server --version
