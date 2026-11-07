#!/usr/bin/env bash
# Rebuilds the FFmpeg WebAssembly cores in this directory from ffmpeg.wasm's source.
#
# Why: the latest @ffmpeg/core release on npm (0.12.10, January 2025) predates
# https://github.com/ffmpegwasm/ffmpeg.wasm/pull/824, which raises the stack size to 5 MB.
# Without it, libopus fails with "RuntimeError: memory access out of bounds".
#
# Needs Docker with buildx. Takes about 30 minutes on 4 cores, and several GB of disk.
# Usage: vendor/ffmpeg-core/build.sh [commit]
# The commit can be on any branch, in a pull request, or in a fork of ffmpeg.wasm (give its full SHA).
set -euo pipefail

# The ffmpeg.wasm commit to build. Update it (and the README) to pick up upstream changes.
COMMIT="${1:-f876f907c7e9b9bf51d4ed0b913a855a63ae63fc}"
DEST="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf -- "$WORK"' EXIT

git clone --quiet https://github.com/ffmpegwasm/ffmpeg.wasm.git "$WORK/ffmpeg.wasm"
cd "$WORK/ffmpeg.wasm"
# A commit on no upstream branch (from a pull request or a fork) isn't cloned, but GitHub
# serves any commit in ffmpeg.wasm's fork network by its full SHA.
if ! git checkout --quiet "$COMMIT" 2>/dev/null; then
  git fetch --quiet origin "$COMMIT"
  git checkout --quiet FETCH_HEAD
fi

# The same production builds upstream publishes as @ffmpeg/core and @ffmpeg/core-mt.
make prd
make prd-mt

# The app only uses the ES module builds.
cp packages/core/dist/esm/ffmpeg-core.js packages/core/dist/esm/ffmpeg-core.wasm "$DEST/st/"
cp packages/core-mt/dist/esm/ffmpeg-core.js packages/core-mt/dist/esm/ffmpeg-core.wasm \
  packages/core-mt/dist/esm/ffmpeg-core.worker.js "$DEST/mt/"
echo "Built ffmpeg.wasm $COMMIT into $DEST"
