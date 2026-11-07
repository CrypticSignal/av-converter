# FFmpeg WebAssembly cores

`st/` (single-threaded) and `mt/` (multi-threaded) hold the FFmpeg WebAssembly cores the converter
loads, in place of the `@ffmpeg/core` and `@ffmpeg/core-mt` npm packages. `src/utils/convertFile.ts`
imports them, and Vite bundles them as content-hashed assets.

## Why they're built from source

The latest npm release of the cores (0.12.10, January 2025) uses Emscripten's default 64 KB stack.
libopus needs more than that, so encoding to Opus fails with
`RuntimeError: memory access out of bounds`, for example for stereo audio at the default compression
level, or at 16 kbps. ffmpeg.wasm fixed this in
[ffmpegwasm/ffmpeg.wasm#824](https://github.com/ffmpegwasm/ffmpeg.wasm/pull/824) (a 5 MB stack),
merged in April 2025, but hasn't published a release with it.

These files are upstream's own production builds (`make prd` and `make prd-mt`) of ffmpeg.wasm
commit [`f876f90`](https://github.com/ffmpegwasm/ffmpeg.wasm/commit/f876f907c7e9b9bf51d4ed0b913a855a63ae63fc)
(16 September 2025), with no changes to the source. Only the ES module files are kept, as that's all
the app uses. The JavaScript API is the same as 0.12.10's, so they work with `@ffmpeg/ffmpeg` 0.12.x.

Like the npm packages, the cores are built with `--enable-gpl` and are licensed under the GPL (v2 or
later).

## Rebuilding

Once ffmpeg.wasm publishes a release with the fix, these files can be deleted in favour of the npm
packages again. Until then, to rebuild (e.g. to pick up a newer upstream commit), run this with
Docker and buildx installed:

```bash
vendor/ffmpeg-core/build.sh [ffmpeg.wasm commit]
```

The commit can be on any branch of ffmpeg.wasm, or (by its full SHA) in a pull request or a fork
of it, e.g. to try a fix before it's merged. It clones ffmpeg.wasm, runs both builds (about 15 minutes each on 4 cores) and copies the files here.
Update the commit in `build.sh` and this README to match.
