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

The npm cores also can't decode AV1 at all: FFmpeg's own AV1 decoder only hands frames to a
hardware decoder, which WebAssembly doesn't have, so converting AV1 video fails with
`Failed to get pixel format`. Nor can they encode AV1.

These files are upstream's own production builds (`make prd` and `make prd-mt`) of ffmpeg.wasm
commit [`f876f90`](https://github.com/ffmpegwasm/ffmpeg.wasm/commit/f876f907c7e9b9bf51d4ed0b913a855a63ae63fc)
(16 September 2025), with the patches in `patches/` applied (see below). Only the ES module files
are kept, as that's all the app uses. The JavaScript API is the same as 0.12.10's, so they work with
`@ffmpeg/ffmpeg` 0.12.x.

Like the npm packages, the cores are built with `--enable-gpl` and are licensed under the GPL (v2 or
later).

## Patches

The changes to ffmpeg.wasm are kept here as a series of patches applied to the pinned upstream
commit, rather than in a fork of it. Each patch is one change, with a message explaining it (made
with `git format-patch`), so each can be reviewed, updated, dropped or sent upstream on its own.
They add three libraries to ffmpeg.wasm's Docker build, each built by a script in `build/` and
enabled in FFmpeg's configure. FFmpeg is still n5.1.4, which supports all three.

1. **`0001-Build-dav1d-to-decode-AV1.patch`**:
   [dav1d](https://github.com/videolan/dav1d) 1.2.1 (`--enable-libdav1d`) decodes AV1, in both
   cores.
2. **`0002-Build-SVT-AV1-to-encode-AV1-in-the-multi-threaded-co.patch`**:
   [SVT-AV1](https://gitlab.com/AOMediaCodec/SVT-AV1) 1.2.1 (`--enable-libsvtav1`) encodes AV1, in
   the multi-threaded core only: it always encodes with threads, and doesn't link without them. Its
   build script makes two changes to its source for WebAssembly:
   - It removes `-fstack-protector-strong`, as Emscripten has no stack protector.
   - It corrects three declarations that say a function returns `void` when it returns
     `EbErrorType`. Native code tolerates the mismatch, but in WebAssembly calling a function
     through the wrong signature traps.

   The converter runs it with `-svtav1-params lp=1`. With more threads, SVT-AV1 starts more than
   the core's fixed pool of web workers and waits forever at the first frame. Limited to that, and
   without SIMD, it's slower than libaom here for the same quality (see below), but it's offered as
   a choice.
3. **`0003-Build-libaom-to-encode-AV1.patch`**:
   [libaom](https://aomedia.googlesource.com/aom) 3.9.1 (`--enable-libaom`) encodes AV1, in both
   cores. It's downloaded as the official release tarball, pinned by its SHA-256 checksum (its
   contents match the `v3.9.1` tag). ffmpeg.wasm already had a build script for it, `build/aom.sh`,
   but no Docker stage; the patch adds the stage and changes the script:
   - It sets `CMAKE_BUILD_TYPE`, which libaom 3.x needs.
   - It leaves out libaom's decoder (dav1d decodes AV1), and FFmpeg's wrapper for it
     (`--disable-decoder=libaom_av1`).
   - It builds libaom for realtime mode only (`CONFIG_REALTIME_ONLY`). In WebAssembly, its "good"
     mode took about 13 times as long as realtime mode at the fastest setting, for a file about 6%
     smaller and about 1 dB better on the benchmark clip.

   It works in both cores, unlike SVT-AV1, and was faster than SVT-AV1 for the same quality in the
   multi-threaded core, on the two clips we tested. In Chromium, for 5 s of 720p, libaom at speed 6 (`-cpu-used 6`) made a file
   the same size as SVT-AV1 at preset 10 with 1.5 dB higher PSNR, in half the time (15 s against
   29 s); libaom at speed 8 took 5 s. To compare them yourself, see "Benchmarking encoders" in the
   project README.

A line-by-line walkthrough of the patches, and of how they apply, is in
[`patches/README.md`](patches/README.md).

The patches make the single-threaded core 38.0 MB (from 32.2 MB: dav1d 0.6 MB, libaom 5.1 MB) and
the multi-threaded core 41.8 MB (from 32.7 MB: SVT-AV1 adds about 4.2 MB more).

## Rebuilding

Once ffmpeg.wasm publishes a release with the Opus fix and AV1 support, these files can be deleted
in favour of the npm packages again. Until then, to rebuild (e.g. to pick up a newer upstream
commit), run this with Docker and buildx installed:

```bash
vendor/ffmpeg-core/build.sh [ffmpeg.wasm commit]
```

The commit can be on any branch of ffmpeg.wasm, or (by its full SHA) in a pull request or a fork
of it, e.g. to try a fix before it's merged. It clones ffmpeg.wasm, applies the patches in order,
runs both builds (about 15 minutes each on 4 cores) and copies the files here. Update the commit in
`build.sh` and this README to match.

To change a patch, or to update the series for a newer upstream commit, apply it as commits, edit
or rebase them, and export them again:

```bash
git clone https://github.com/ffmpegwasm/ffmpeg.wasm.git && cd ffmpeg.wasm
git checkout -b patches f876f907c7e9b9bf51d4ed0b913a855a63ae63fc
git am /path/to/av-converter/vendor/ffmpeg-core/patches/*.patch
# ... edit and commit, or: git rebase <newer commit>
git format-patch --zero-commit --no-signature -o /tmp/new-patches f876f907c7e9b9bf51d4ed0b913a855a63ae63fc..patches
```

Then, in the av-converter repo, delete the old `.patch` files in `patches/` and copy in the new ones
from `/tmp/new-patches`. Check the new files first (`git diff` shows what changed), and rebuild
before committing, so the cores match the patches. `patches/README.md` stays.
