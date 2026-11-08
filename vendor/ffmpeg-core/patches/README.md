# FFmpeg WebAssembly patches

These three patches add AV1 support to the FFmpeg WebAssembly cores that the converter uses. They
apply to ffmpeg.wasm at the commit pinned in `../build.sh` (`f876f907`), in this order:

1. `0001-Build-dav1d-to-decode-AV1.patch`: decodes AV1.
2. `0002-Build-SVT-AV1-to-encode-AV1-in-the-multi-threaded-co.patch`: encodes AV1, multi-threaded core only.
3. `0003-Build-libaom-to-encode-AV1.patch`: encodes AV1, both cores.

`build.sh` applies them to a temporary clone of ffmpeg.wasm and builds from there. Nothing in this
repo is patched; see [Where the patches apply](#where-the-patches-apply).

## Reading a patch

Each file is an email in mbox format, made with `git format-patch`:

- **Header** (`From`, `Date`, `Subject`): the commit's author and title. `[PATCH 1/3]` means patch 1
  of 3. `From 0000…` is a placeholder for the commit hash, written with `--zero-commit` so the file
  doesn't depend on a local commit.
- **Commit message**: the explanation, up to the `---` line.
- **Diffstat**: how many lines each file changes. Informational only.
- **`diff --git a/X b/X`**: starts the changes to file X. `a/` is the old file and `b/` the new one.
- **`index abc..def mode`**: content hashes before and after, and the file mode. Used by git only.
- **`--- a/X` / `+++ b/X`**: the old and new file names. `--- /dev/null` means the file is new.
- **`@@ -132,6 +132,14 @@`**: a hunk. `-132,6` means 6 lines of the old file starting at line 132;
  `+132,14` means 14 lines of the new file. The text after the second `@@` is the nearest
  function or section, for display only.
- **Lines inside a hunk**: a leading space is unchanged context (three lines either side of each
  change, so the patch can find its place); `-` is removed; `+` is added.

## Where the patches apply

The file names below (`Dockerfile`, `build/*.sh`) are in ffmpeg.wasm's repository. The patches
change them only in the temporary clone that `build.sh` makes.

`build.sh`:

1. clones ffmpeg.wasm into a temporary directory and checks out `f876f907`;
2. runs `git apply` on each patch, in order, which edits that clone's `Dockerfile` and `build/*.sh`;
3. runs `make prd` and `make prd-mt`, which run `docker buildx build` on the clone's patched `Dockerfile`;
4. copies the resulting `ffmpeg-core.js` and `.wasm` files into `../st/` and `../mt/`, and deletes the clone.

So the patched `Dockerfile` and the new `build/*.sh` scripts exist only during the build.

## 0001: dav1d (AV1 decoding)

**Why:** FFmpeg's own AV1 decoder hands frames to a hardware decoder, which WebAssembly doesn't
have, so AV1 input failed with `Failed to get pixel format`. dav1d decodes AV1 in software.

**Files:** `Dockerfile` (changed) and `build/dav1d.sh` (new).

Key changes to the `Dockerfile`:

- A new stage, `dav1d-builder`, based on `emsdk-base`. It installs `meson` and `ninja-build`, which
  dav1d uses, fetches dav1d 1.2.1 with `ADD` from GitHub, and runs `build/dav1d.sh`.
- `COPY --from=dav1d-builder` brings dav1d's installed files into the `ffmpeg-base` stage, where
  FFmpeg is configured and built.
- `--enable-libdav1d` is added to FFmpeg's configure flags.
- `-ldav1d` is added to `FFMPEG_LIBS`, the libraries linked into the core.

`build/dav1d.sh` builds dav1d with Meson, using a cross file that tells Meson to use Emscripten's
compilers. Its `to_list` function turns `-O3 -msimd128` into the quoted list Meson's cross-file
syntax needs. The Meson options turn off assembly (dav1d's assembly is x86 and Arm only) and the
tools, tests and examples.

## 0002: SVT-AV1 (AV1 encoding, multi-threaded core)

**Why:** SVT-AV1 is a second AV1 encoder. It's usually faster than libaom on native machines, but in
WebAssembly it always uses threads, so it's only built into the multi-threaded core.

**Files:** `Dockerfile` (changed) and `build/svtav1.sh` (new).

Key changes to the `Dockerfile`:

- A new `svtav1-builder` stage, fetching SVT-AV1 v1.2.1 from GitLab.
- `${FFMPEG_MT:+--enable-libsvtav1}` in FFmpeg's configure flags. The shell expression adds the
  flag only when `FFMPEG_MT` is set and not empty. ffmpeg.wasm's `Makefile` sets it in the
  `build-mt` target, so the single-threaded core doesn't get SVT-AV1.
- `${FFMPEG_MT:+-lSvtAv1Enc}` in both link commands, for the same reason.

`build/svtav1.sh` builds only the encoder library, in portable C:

- `BUILD_APPS`, `BUILD_DEC` and `BUILD_TESTING` are off, and `COMPILE_C_ONLY` turns off assembly.
- `sed -i '/check_both_flags_add(-fstack-protector-strong)/d'` removes `-fstack-protector-strong`
  from SVT-AV1's `CMakeLists.txt`. Emscripten doesn't support it, because WebAssembly has no stack
  protector.
- Three `sed -i` lines change `void` to `EbErrorType` in three function declarations in SVT-AV1's
  source. The functions are defined as returning `EbErrorType`, but declared as `void` elsewhere.
  Native code tolerates the mismatch; in WebAssembly, a call through the wrong signature traps.
  The callers ignore the result, so the change is safe.
- The `grep -q` lines stop the build if any of those edits didn't apply, for example after a
  version change.

The converter runs SVT-AV1 with `-svtav1-params lp=1`. With more threads, SVT-AV1 starts more
workers than the core's pool of 32 web workers, and waits forever at the first frame.

## 0003: libaom (AV1 encoding, both cores)

**Why:** libaom is the reference AV1 encoder, and it works without threads. In our benchmark in the
browser, its realtime mode gave a better quality-for-time trade-off than SVT-AV1 (see the vendor
README).

**Files:** `Dockerfile` (changed) and `build/aom.sh` (changed; the file already existed upstream).

Key changes to the `Dockerfile`:

- A new `aom-builder` stage. Unlike the other libraries, libaom is fetched as its release tarball,
  not from git: `ADD --checksum=sha256:…` makes the build fail if the download isn't that exact file.
- `tar … --strip-components=1` unpacks the tarball into `/src` without its top-level folder.
- `--enable-libaom` and `--disable-decoder=libaom_av1` are added to FFmpeg's configure. The second
  flag stops FFmpeg from building its wrapper for libaom's decoder, which isn't needed because dav1d
  decodes AV1.
- `-laom` is added to the link libraries.

Changes to `build/aom.sh`:

- `-DCMAKE_BUILD_TYPE=Release`: libaom 3.x needs a build type set.
- `-DCONFIG_AV1_DECODER=0`: no decoder, since dav1d decodes.
- `-DCONFIG_REALTIME_ONLY=1`: only realtime mode. In WebAssembly, the "good" mode took about 13
  times as long, for about 1 dB better quality on the test clip used for the benchmark.

## Viewing the changes as commits

Apply the patches to a clone of ffmpeg.wasm with `git am`, and each becomes a commit you can read
with `git log -p`, `git show`, or any Git client:

```sh
git clone https://github.com/ffmpegwasm/ffmpeg.wasm.git && cd ffmpeg.wasm
git checkout -b patches f876f907c7e9b9bf51d4ed0b913a855a63ae63fc
git am /path/to/av-converter/vendor/ffmpeg-core/patches/*.patch
```

To change a patch, see [Rebuilding](../README.md#rebuilding) in the vendor README (`vendor/ffmpeg-core/README.md`).
