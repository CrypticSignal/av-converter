<div align="center">

# AV converter

Convert audio and video files right in your browser using FFmpeg and WebAssembly. Nothing is uploaded.

**Try this web app at [av-converter.com](https://av-converter.com)**

  <img src="https://img.shields.io/badge/React-000000?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-000000?style=for-the-badge&logo=typescript&logoColor=3178C6" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-000000?style=for-the-badge&logo=vite&logoColor=A78BFA" alt="Vite" />
  <img src="https://img.shields.io/badge/Material%20UI-000000?style=for-the-badge&logo=mui&logoColor=007FFF" alt="Material UI" />
  <img src="https://img.shields.io/badge/Tailwind-000000?style=for-the-badge&logo=tailwind-css&logoColor=38B2AC" alt="Tailwind" />
  <img src="https://img.shields.io/badge/Node.js-000000?style=for-the-badge&logo=node.js&logoColor=5FA04E" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=FFFFFF" alt="Express" />
  <img src="https://img.shields.io/badge/Python-000000?style=for-the-badge&logo=python&logoColor=3776AB" alt="Python" />
  <img src="https://img.shields.io/badge/FFmpeg-000000?style=for-the-badge&logo=ffmpeg&logoColor=007808" alt="FFmpeg" />
  <img src="https://img.shields.io/badge/Docker-000000?style=for-the-badge&logo=docker&logoColor=0DB7ED" alt="Docker" />

  <img src="screenshot.png" alt="converter screenshot" width="480" />
</div>

# Table of contents

- [Audio/Video Converter](#audiovideo-converter)
- [Video Downloader](#video-downloader)
  - [YouTube cookies](#youtube-cookies)
  - [Password](#password)
  - [Limits](#limits)
- [Run locally](#run-locally)
  - [With Docker](#with-docker)
  - [Without Docker](#without-docker)
- [Production](#production)
- [Tests](#tests)
- [Benchmarking encoders](#benchmarking-encoders)
- [Code layout](#code-layout)

## Audio/Video Converter

Convert audio files or the audio tracks in a video using FFmpeg in your browser. Supports AAC, AC3, ALAC, DTS, FLAC, MP3, Opus, Vorbis, and WAV. The output contains exactly one audio track: the first, unless you pick another once the file's information has loaded (the picker appears for files with several). MKA, and outputs that keep the video, can instead hold all audio tracks; MKA does so by default. Keeping the video copies it unchanged, and for MKV to MKV also copies the subtitles and attachments. Manual command mode uses your own stream mapping.

Choose **Video** instead of Audio to re-encode the video with any of the video encoders in FFmpeg's WebAssembly build (H.264, H.265, AV1, VP8, VP9, MPEG-4, Theora, ProRes, DNxHR, FFV1, GIF, animated WebP and PNG, and many older, uncompressed and image codecs). Each encoder offers only the containers it can be written to, and has its own quality settings where it has any. The audio can be re-encoded to any audio format the container can hold, with that format's settings (AAC by default where the container allows it), left as it is (the default for MKV and NUT, which hold almost any audio format), or removed. Audio formats that hold at most two channels, such as MP3, always downmix audio with more to stereo. Encoders that only allow certain frame sizes (such as DV, H.261 and H.263) resize the video to fit. Every encoder can also change the frame rate, width and height (all "Original" by default; with only the width or the height set, the other keeps the aspect ratio). To convert only part of the video, drag the start and end handles under the video preview. Browsers can't preview every format FFmpeg reads, but the handles still work then.

AV1 can be encoded with libaom or SVT-AV1, and AV1 input is decoded with dav1d. The FFmpeg cores in `vendor/ffmpeg-core` include all three (see its README). libaom is the first choice: in our benchmark it was faster than SVT-AV1 in the browser, and it also works without multi-threading. SVT-AV1 and H.265 need a browser that allows multi-threading (the page must be cross-origin isolated).

There's no limit on the input file's size: FFmpeg reads it directly from disk. The converted file, though, is held in the browser's memory until it's saved (about twice over at the peak), so a very large output, such as a long video with "Keep the video", can make the browser run out of memory. The page warns about this beforehand (in browsers that report the device's memory), and explains it if the tab crashes during a conversion.

## Video Downloader

#### YouTube cookies

If YouTube asks yt-dlp to sign in, export your YouTube cookies in Netscape format and save them as `cookies.txt` in the project root. Without the file, downloads are anonymous. Cookies are login credentials, so never commit them, and expect to replace them when they expire.

#### Password

The video downloader (`/download`) is private: it isn't linked from the site, and every download needs its password.

**How it works**: the password's SHA-256 hash is kept on the server, in `downloader-password.env` in the project root, and never committed. Docker Compose passes it to the downloader as the `DOWNLOADER_PASSWORD_SHA256` environment variable. The download page sends the password with each download request, and the downloader hashes it and compares it with the saved hash. If no hash is set, every download is refused.

**To set or change the password**, run this on the server, from the project root:

```sh
python3 set_password.py
```

It asks for the new password, saves its hash, and restarts the downloader if it's running, so the new password applies straight away. `setup.sh` runs it the first time, and `deploy.py` stops if no password has been set.

Locally, run `python3 set_password.py` too. The Docker setup picks the file up automatically; without Docker, start the backend with `env $(cat downloader-password.env) python downloader/server.py`.

#### Limits

There's no limit on how many downloads run at once. Downloads have no file-size limit, and live recordings have no duration limit. A download stops if free disk space drops below 1 GiB.

A completed download is kept for up to ten minutes. Its link can be used once; the file is removed when that transfer ends, or when the link expires.

## Run locally

#### With Docker

```sh
docker compose -f docker/dev/docker-compose.yml up --build --watch
```

Open http://localhost:3000. Watch mode syncs frontend changes and restarts or rebuilds services when needed. Downloader rebuilds interrupt active downloads and recordings. Restart the command after changing the Compose configuration.

#### Without Docker

Install Python 3.12+, Node.js 26+, Yarn, and FFmpeg, with the executables on your PATH. Start the backend:

```sh
python -m pip install -r downloader/requirements.txt
python downloader/server.py
```

In another terminal, start the frontend:

```sh
yarn install
yarn dev
```

Open http://localhost:3000. Vite proxies download requests to http://127.0.0.1:8000; set `DOWNLOADER_URL` to use another backend. Local downloads need the Vite development server, not the static preview server.

## Production

**First-time setup** of an Ubuntu server, from your normal account:

```sh
sudo bash setup.sh
```

It installs Docker and Node.js, opens ports 80 and 443, builds the site, gets a TLS certificate for the domain set at the top of `setup.sh`, and schedules certificate renewal (`docker/prod/renew-cert.sh`). The domain's DNS must already point at the server. Use `sudo bash setup.sh --local` for HTTP only, without a certificate.

**Updates**: run `yarn deploy` (or `python3 deploy.py`). It pulls the latest code, rebuilds the backend images and the website, restarts what changed and reloads Nginx. Each step is commented in `deploy.py`. There is no automatic rollback, and active downloads are interrupted.

Production requires `cookies.txt` in the project root (`setup.sh` creates an empty one). After replacing it, run:

```sh
docker compose -f docker/prod/docker-compose.yml up -d downloader
```

## Tests

Run backend tests (offline; yt-dlp is never run):

```sh
python -m unittest discover -s downloader -p "test_*.py"
```

Run frontend tests:

```sh
yarn test
```

GitHub Actions runs both suites and the frontend build on every push to master and on pull requests.

## Benchmarking encoders

`scripts/benchmark-encoders.mjs` converts a video with several encoders through the converter itself (the production build, in Chromium, with the same FFmpeg WebAssembly cores as visitors get) and reports each one's time, file size and quality (PSNR against the input):

```sh
yarn build
npx playwright install chromium   # once
yarn benchmark path/to/video.mp4
```

It compares both AV1 encoders (libaom and SVT-AV1) at several speeds with VP9, H.264 and H.265, using the converter's settings for each. `--single-threaded` uses the single-threaded core, as in browsers that don't allow multi-threading; `--only AV1` runs just the encoders whose name contains "AV1"; `--keep <dir>` saves the outputs. The quality column needs `ffmpeg` on your PATH. A few seconds of real footage at the resolution you care about gives the most useful numbers.

## Code layout

| Path | What it does |
| --- | --- |
| `src/formats.tsx` | One entry per output format: its label, extension, FFmpeg arguments and settings panel. |
| `src/videoEncoders.tsx` | One entry per video encoder: its label, the containers it can be written to, its FFmpeg arguments and settings panel. |
| `src/components/` | Small shared form controls (select, slider, yes/no radio, file input), the status panel, and the video trimmer. |
| `src/utils/createFFmpegArgs.ts` | Builds the full FFmpeg command: which streams to include (`-map`), the format's arguments, and the shared options (keep the video, downmix to stereo). |
| `src/utils/convertFile.ts` | Runs FFmpeg (WebAssembly) in the browser and downloads the result. |
| `scripts/benchmark-encoders.mjs` | Compares video encoders' speed, file size and quality in the converter (`yarn benchmark`). |
| `src/pages/Homepage.tsx` | The converter page. |
| `src/utils/manualCommand.ts` | Checks and builds the arguments for a manual FFmpeg command. |
| `src/pages/DownloadPage.tsx` | The video downloader page, which streams progress from the backend. |
| `downloader/server.py` | The yt-dlp backend. |
| `set_password.py` | Sets the downloader's password, saving its hash in `downloader-password.env`. |
| `docker/prod/nginx.conf`, `nginx-http.conf` | Nginx for HTTPS, and HTTP only (local mode and first certificate). Both include `locations.conf`, the site's routes. |
| `logging/index.ts` | Records page visits in Loki, viewable in Grafana at `/grafana/`. |
| `vendor/ffmpeg-core/` | The multi-threaded and single-threaded FFmpeg WebAssembly cores, which Vite bundles as content-hashed assets. Pages that aren't cross-origin isolated (no SharedArrayBuffer) fall back to the single-threaded core. They're built from ffmpeg.wasm's source: the npm release's Opus encoder crashes, and it can't decode or encode AV1. Its README explains why and how to rebuild them. |
| `vendor/ffmpeg-core/patches/` | The patches that add AV1 support to those cores, applied to ffmpeg.wasm when they're rebuilt. See its README. |

To add an output format:

1. Add its name to `Codec` in `src/formats.tsx`.
2. Add any settings it needs to `FormatSettings` and `DEFAULT_SETTINGS` (prefixed with the format's name, e.g. `mp3Bitrate`).
3. Add an entry to `FORMATS` with its label, extension, FFmpeg `args` and settings `Panel`.
4. Add a case to the `formats` list in `src/utils/createFFmpegArgs.test.ts`, with the arguments it should produce.

To add a video encoder:

1. Add an entry to `VIDEO_ENCODERS` in `src/videoEncoders.tsx`, keyed by its FFmpeg name. Give it
   the containers it can be written to (the first is the default), its FFmpeg `args`, and a settings
   `Panel` if it has any.
2. Add any settings it needs to `FormatSettings` and `DEFAULT_SETTINGS` in `src/formats.tsx`.
3. Check that the cores can write each container you list. The encoder has to be in the build (see
   `vendor/ffmpeg-core/README.md`).
