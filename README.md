<div align="center">
  <img src="https://img.shields.io/badge/Node.js-0F9A41?style=for-the-badge&logo=node&color=black" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express-0F9A41?style=for-the-badge&logo=express&color=black" alt="Express" />
  <img src="https://img.shields.io/badge/React-000000?style=for-the-badge&logo=react&logoColor=60DAFB" alt="React" />
  <img src="https://img.shields.io/badge/FFmpeg-000000?style=for-the-badge&logo=ffmpeg&logoColor=green" alt="FFmpeg" />
  <img src="https://img.shields.io/badge/Docker-000000?style=for-the-badge&logo=docker&logoColor=0db7ed" alt="Docker" />
  <img src="https://img.shields.io/badge/Tailwind-black?style=for-the-badge&logo=tailwind-css&logoColor=38B2AC" alt="Tailwind">

  ![](screenshot.png)
</div>

## Table of contents

- [Audio/video converter](#audiovideo-converter)
- [Video Downloader](#video-downloader)
  - [YouTube cookies](#youtube-cookies)
- [Development](#development)
  - [Docker](#docker)
  - [Without Docker](#without-docker)
- [Testing](#testing)

## Audio/video converter

  Convert an audio file, or the audio streams in a video file, to one of the following formats:
  - AAC
  - AC3 (Dolby Digital)
  - ALAC
  - DTS
  - FLAC
  - MP3
  - Opus
  - Vorbis
  - WAV

## Video Downloader

Click on **Video Downloader** in the navigation bar (or visit `/download`). This is essentially a [yt-dlp](https://github.com/yt-dlp/yt-dlp) wrapper.

### YouTube cookies

For a private, access-controlled deployment, an exported Netscape-format cookie
file can help with YouTube sign-in challenges. Cookies are login credentials:
never commit them, expose them to visitors, or attach a personal session to an
unrestricted public downloader. Authentication may still fail or expire.

Production requires `cookies.txt` in the project root on the host. The production
Compose configuration mounts it read-only into the downloader; it is never baked
into the image. After securely supplying the export, recreate the downloader and
reload Nginx:

```sh
docker compose -f docker/prod/docker-compose.yml up -d --build downloader
docker compose -f docker/prod/docker-compose.yml exec -T nginx nginx -s reload
```

The source must already exist and be readable by the container's `downloader`
user; use restrictive ownership/permissions rather than making it world-readable.
A missing source causes startup to fail instead of creating a directory.
Development Docker runs remain anonymous by default and do not require the file.

Without Docker, place the file at `downloader/cookies.txt`. If present, it is
copied into each request's temporary directory and used for both metadata and
media extraction. This allows yt-dlp to update its working cookies without
changing the original or sharing writes between requests. The copy is cleaned up
with the download; replace the source export when its session expires. Outside
the production Docker setup, requests without a cookie file continue anonymously.

### Downloader resource protection

The backend limits concurrent extractions to two and rate-limits new download
requests per client (HTTP 429). Live recordings have **no overall duration
limit**: admission rate limits do not interrupt existing recordings. Storage
limits can stop any extraction, recording, or postprocessing operation.

Environment settings (byte values are integers):

| Setting | Default | Meaning |
| --- | --- | --- |
| `DOWNLOAD_STORAGE_DIR` | OS temporary directory + `av-downloader` | Dedicated root for active, partial, retained completed, and transferring files |
| `DOWNLOAD_STORAGE_QUOTA_BYTES` | `10737418240` (10 GiB) | Total logical file bytes across the entire root; must be positive |
| `DOWNLOAD_MIN_FREE_BYTES` | `1073741824` (1 GiB) | Minimum filesystem free bytes; zero disables this reserve |
| `DOWNLOAD_STORAGE_CHECK_SECONDS` | `1` | Watchdog interval, greater than zero and at most 60 seconds |
| `DOWNLOAD_RATE_LIMIT` | `10` | Maximum POST attempts per client per fixed window |
| `DOWNLOAD_RATE_WINDOW_SECONDS` | `60` | Positive admission window in seconds |
| `DOWNLOAD_TRUSTED_PROXIES` | empty | Comma-separated trusted IPv4/IPv6 proxy CIDRs; otherwise forwarding headers are ignored |

Storage is checked before admission, before media extraction, periodically while
the media subprocess runs (even without output), and before issuing a file link.
A breach terminates the media process group including FFmpeg and removes the
failed request's files. Admission storage failures return HTTP 507; failures after
streaming starts use the existing error event. Completed files awaiting their
one-use link (up to ten minutes) and files currently transferring still count.
Retained files are not evicted to admit new work. Scanning failures fail closed.
These are polling safeguards, not a filesystem hard quota: writes can overshoot
between checks. Use a dedicated filesystem/container storage quota for a strict
ceiling, and run only one backend process per storage root/rate-limit policy.

Production Compose caps the downloader at two CPUs and 2 GiB memory. It uses a
dedicated proxy network with Nginx at `172.30.50.2`, trusts only that address,
and does not publish the backend port. Nginx replaces incoming forwarding headers
with the actual peer address; the backend walks trusted hops right-to-left.
If that subnet conflicts with your host network, change both the Compose network
and trusted CIDR together. Do not trust arbitrary private networks. A deployment
behind another load balancer must explicitly configure Nginx's trusted real-IP
sources before forwarding its resolved client address. Direct/non-Docker setups
trust no proxies by default. The client map is capped at 10,000 unexpired entries;
new identities are rejected when full. State is in-memory and resets on restart.

## Development

### Docker

Run the frontend and downloader with:

```sh
docker compose -f docker/dev/docker-compose.yml up --build --watch
```

Access the web app at http://localhost:3000.

While watch mode is running:

- Changes in `src/`, `public/`, and `index.html` sync automatically without
  rebuilding containers. Vite usually updates the page automatically; refresh if needed.
- Changes to `vite.config.ts`, `tsconfig.json`, or `tailwind.config.js` sync and
  restart the frontend container without rebuilding it.
- Changes to `package.json` or `yarn.lock` automatically rebuild the frontend container.
- Changes to `downloader/server.py`, `downloader/requirements.txt`, or
  `downloader/Dockerfile` automatically rebuild and restart the downloader container.
  This interrupts active downloads and recordings.
- Changes to the Compose configuration require stopping and rerunning the command.

These watch rules apply to development only; production changes require deployment.

### Without Docker

Install Python 3.12+, FFmpeg, and a current Node.js (22+) on your PATH, then run:

```sh
python -m pip install -r downloader/requirements.txt
python downloader/server.py
```

In another terminal, install the frontend dependencies and start Vite:

```sh
yarn install
yarn dev
```

Visit http://localhost:3000/download. Vite proxies API requests to
http://127.0.0.1:8000. Set `DOWNLOADER_URL` to override that address. Use the Vite
development server or production Nginx, not the static preview server, for downloads.

## Testing

Run backend tests (mocked downloads, no external network required):

```sh
python -m unittest discover -s downloader -p "test_*.py"
```
