# Audio/video converter

<div align="center">
  <img src="https://img.shields.io/badge/Node.js-0F9A41?style=for-the-badge&logo=node&color=black" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express-0F9A41?style=for-the-badge&logo=express&color=black" alt="Express" />
  <img src="https://img.shields.io/badge/React-000000?style=for-the-badge&logo=react&logoColor=60DAFB" alt="React" />
  <img src="https://img.shields.io/badge/FFmpeg-000000?style=for-the-badge&logo=ffmpeg&logoColor=green" alt="FFmpeg" />
  <img src="https://img.shields.io/badge/Docker-000000?style=for-the-badge&logo=docker&logoColor=0db7ed" alt="Docker" />
  <img src="https://img.shields.io/badge/Tailwind-black?style=for-the-badge&logo=tailwind-css&logoColor=38B2AC" alt="Tailwind" />

  ![converter screenshot](screenshot.png)
</div>

# Table of contents

- [Audio/Video Converter](#audiovideo-converter)
- [Video Downloader](#video-downloader)
- [Run locally](#run-locally)
  - [With Docker](#with-docker)
  - [Without Docker](#without-docker)
- [YouTube cookies](#youtube-cookies)
- [Downloader limits](#downloader-limits)
- [Tests](#tests)
- [Code layout](#code-layout)

## Audio/Video Converter

Convert audio files or the audio tracks in a video using FFmpeg in your browser. Supports AAC, AC3, ALAC, DTS, FLAC, MP3, Opus, Vorbis, and WAV. After file information loads, choose an audio track by its stream index, language/title (when available), codec, and channel details. Leaving the default preserves the format's existing mapping, explained below the selector; choosing a track includes only that audio stream. Manual command mode uses your own stream mapping.

## Video Downloader

Click on Video Downloader in the navigation bar (or visit /download). This is essentially a [yt-dlp](https://github.com/yt-dlp/yt-dlp) wrapper.
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

## YouTube cookies

For private, access-controlled deployments, a Netscape-format cookie export can help with YouTube sign-in challenges. **Cookies are login credentials:** never commit them, expose them to visitors, or use a personal session on a public downloader. Sessions can expire or fail to authenticate.

Without Docker, use `downloader/cookies.txt`. Each request gets a temporary copy so the original stays unchanged. Development Docker and non-Docker setups work anonymously when no cookie file is supplied.

## Downloader limits

Each IP address can run two downloads at once, with a configurable server-wide cap of four active jobs by default. Jobs include metadata lookup, media download, and postprocessing; completed file transfers do not occupy a job slot. Downloads have no file-size limit, and live recordings have no duration limit. A free-space reserve protects the disk.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `DOWNLOAD_MAX_CONCURRENT` | `4` | Maximum active jobs across all IPs; must be a positive integer |
| `DOWNLOAD_STORAGE_DIR` | OS temp directory + `av-downloader` | Storage root for downloads |
| `DOWNLOAD_MIN_FREE_BYTES` | `1073741824` (1 GiB) | Free space reserve; zero disables it |
| `DOWNLOAD_STORAGE_CHECK_SECONDS` | `1` | Storage check interval; greater than 0, at most 60 seconds |

Free space is checked when a job starts, at stage boundaries, and once per interval while its metadata or media subprocess is running. There is no background check while idle. Falling below the reserve stops the affected job and removes its files; checks are periodic, so free space can briefly dip below the reserve. Requests over the per-IP limit return HTTP 429; a full server returns HTTP 503 with `Retry-After: 5`; requests rejected for insufficient free space return HTTP 507.

A completed download is kept for up to ten minutes after it becomes ready. Its link can be claimed once; its files are removed when that transfer finishes or disconnects. Unclaimed links expire and their files are removed. Run only one backend process per storage root.

## Tests

Run backend tests with mocked downloads and no external network access:

```sh
python -m unittest discover -s downloader -p "test_*.py"
```

Run frontend tests:

```sh
yarn test
```

GitHub Actions runs both suites and the frontend build on every push to master and on pull requests.

## Code layout

| Path | What it does |
| --- | --- |
| `src/formats.tsx` | One entry per output format: its label, extension, FFmpeg arguments and settings panel. |
| `src/utils/createFFmpegArgs.ts` | Combines a format's arguments with the shared options: keep the video, downmix to stereo. |
| `src/utils/convertFile.ts` | Runs FFmpeg (WebAssembly) in the browser and downloads the result. |
| `src/pages/Homepage.tsx` | The converter page. |
| `src/pages/DownloadPage.tsx` | The video downloader page, which streams progress from the backend. |
| `downloader/server.py` | The yt-dlp backend. |
| `docker/prod/locations.conf` | Shared Nginx routes for HTTP-only and HTTPS deployments. |
| `@ffmpeg/core-mt`, `@ffmpeg/core` | The multi-threaded and single-threaded FFmpeg WebAssembly cores, which Vite bundles as content-hashed assets. Pages that aren't cross-origin isolated (no SharedArrayBuffer) fall back to the single-threaded core. |

To add an output format, add its name to `Codec` and an entry to `FORMATS` in `src/formats.tsx`, then add a row to the table in `src/utils/createFFmpegArgs.test.ts`.
