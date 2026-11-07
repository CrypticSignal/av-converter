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
- [Production](#production)
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

In production, put the file at `cookies.txt` in the project root; without Docker, use `downloader/cookies.txt`. Each request gets a temporary copy so the original stays unchanged. Without a cookie file, downloads are anonymous.

## Downloader limits

Each IP address can run two downloads at once, and at most four run across the whole server; both limits are constants at the top of `downloader/server.py`. Downloads have no file-size limit, and live recordings have no duration limit. A download stops if free disk space drops below 1 GiB.

A completed download is kept for up to ten minutes. Its link can be used once; the file is removed when that transfer ends, or when the link expires.

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

## Code layout

| Path | What it does |
| --- | --- |
| `src/formats.tsx` | One entry per output format: its label, extension, FFmpeg arguments and settings panel. |
| `src/utils/createFFmpegArgs.ts` | Combines a format's arguments with the shared options: keep the video, downmix to stereo. |
| `src/utils/convertFile.ts` | Runs FFmpeg (WebAssembly) in the browser and downloads the result. |
| `src/pages/Homepage.tsx` | The converter page. |
| `src/pages/DownloadPage.tsx` | The video downloader page, which streams progress from the backend. |
| `downloader/server.py` | The yt-dlp backend. |
| `docker/prod/nginx.conf`, `nginx-http.conf` | Nginx for HTTPS, and HTTP only (local mode and first certificate). Both include `locations.conf`, the site's routes. |
| `logging/index.ts` | Records page visits in Loki, viewable in Grafana at `/grafana/`. |
| `@ffmpeg/core-mt`, `@ffmpeg/core` | The multi-threaded and single-threaded FFmpeg WebAssembly cores, which Vite bundles as content-hashed assets. Pages that aren't cross-origin isolated (no SharedArrayBuffer) fall back to the single-threaded core. |

To add an output format, add its name to `Codec` and an entry to `FORMATS` in `src/formats.tsx`, then add a row to the table in `src/utils/createFFmpegArgs.test.ts`.
