#!/usr/bin/env bash
# Bundle the resolved host dependency notices into one browsable archive for
# the Mac and Windows installers. llama.cpp ships its own NOTICES alongside it.
set -euo pipefail
cd "$(dirname "$0")/.."
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
node scripts/native-notices.mjs application "$stage"
mkdir -p artifacts/desktop-notices
(cd "$stage" && "${SHADOWCODE_CMAKE:-cmake}" -E tar cf notices.zip --format=zip -- application.json README.txt ShadowCode-LICENSE ShadowCode-NOTICE rust npm upstream)
mv "$stage/notices.zip" artifacts/desktop-notices/notices.zip
