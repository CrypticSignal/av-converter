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
- [Automatic production deployment](#automatic-production-deployment)
- [YouTube cookies](#youtube-cookies)
- [Downloader limits](#downloader-limits)
- [Tests](#tests)
- [Code layout](#code-layout)

## Audio/Video Converter

Convert audio files or the audio tracks in a video using FFmpeg in your browser. Supports AAC, AC3, ALAC, DTS, FLAC, MP3, Opus, Vorbis, and WAV.

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

Open http://localhost:3000. Vite proxies download requests to http://127.0.0.1:8000; set `DOWNLOADER_URL` to use another backend. Downloads need the Vite development server or production Nginx, not the static preview server.

## YouTube cookies

For private, access-controlled deployments, a Netscape-format cookie export can help with YouTube sign-in challenges. **Cookies are login credentials:** never commit them, expose them to visitors, or use a personal session on a public downloader. Sessions can expire or fail to authenticate.

Production Docker requires `cookies.txt` in the project root. Create it before starting the service and make it readable by the container's `downloader` user, using restrictive permissions. It is mounted read-only, not included in the image. After adding or replacing it, run:

```sh
docker compose -f docker/prod/docker-compose.yml up -d --build downloader
docker compose -f docker/prod/docker-compose.yml exec -T nginx nginx -s reload
```

Without Docker, use `downloader/cookies.txt`. Each request gets a temporary copy so the original stays unchanged. Development Docker and non-Docker setups work anonymously when no cookie file is supplied.

## Downloader limits

Each IP address can run five downloads at once; there is no overall limit. Behind Nginx, the backend reads the visitor's address from `X-Real-IP`, which it accepts only from private or loopback addresses. Live recordings have no duration limit, but storage limits still apply.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `DOWNLOAD_STORAGE_DIR` | OS temp directory + `av-downloader` | Storage root for downloads |
| `DOWNLOAD_STORAGE_QUOTA_BYTES` | `10737418240` (10 GiB) | Maximum total stored bytes; must be positive |
| `DOWNLOAD_MIN_FREE_BYTES` | `1073741824` (1 GiB) | Free space reserve; zero disables it |
| `DOWNLOAD_STORAGE_CHECK_SECONDS` | `1` | Storage check interval; greater than 0, at most 60 seconds |

Storage checks include partial files, completed files awaiting collection (up to ten minutes), and active transfers. Exceeding a limit stops the affected job and removes its files; retained downloads aren't evicted to make room. Requests over the per-IP limit return HTTP 429; requests rejected for storage limits return HTTP 507.

Checks are periodic, so usage can briefly exceed the limit. Use a filesystem or container storage quota for a strict ceiling, and run only one backend process per storage root.

Production Docker limits the downloader to two CPUs and 2 GiB of memory, and keeps its port private.

## Tests

Run backend tests with mocked downloads and no external network access:

```sh
python -m unittest discover -s downloader -p "test_*.py"
```

Run frontend tests:

```sh
yarn test
```

GitHub Actions runs both suites and the production build on every push to master and on pull requests.

## Code layout

| Path | What it does |
| --- | --- |
| `src/formats.tsx` | One entry per output format: its label, extension, FFmpeg arguments and settings panel. |
| `src/utils/createFFmpegArgs.ts` | Combines a format's arguments with the shared options: keep the video, downmix to stereo. |
| `src/utils/convertFile.ts` | Runs FFmpeg (WebAssembly) in the browser and downloads the result. |
| `src/pages/Homepage.tsx` | The converter page. |
| `src/pages/DownloadPage.tsx` | The video downloader page, which streams progress from the backend. |
| `downloader/server.py` | The yt-dlp backend. |
| `@ffmpeg/core-mt`, `@ffmpeg/core` | The multi-threaded and single-threaded FFmpeg WebAssembly cores, which Vite bundles as content-hashed assets. Pages that aren't cross-origin isolated (no SharedArrayBuffer) fall back to the single-threaded core. |

To add an output format, add its name to `Codec` and an entry to `FORMATS` in `src/formats.tsx`, then add a row to the table in `src/utils/createFFmpegArgs.test.ts`.

## Automatic production deployment

The `deploy` job in `.github/workflows/ci.yml` can deploy automatically over SSH
when a commit reaches `master` and both CI test jobs pass. Pull requests never
run this job. Deployment is disabled until the repository variable
`DEPLOY_ENABLED` is set to `true`.

### Server setup

1. Set up production using the existing Docker configuration first, including
   `cookies.txt`, certificates, and an initial working deployment.
2. Keep a dedicated clone of this repository on the server, with `origin`
   pointing at this GitHub repository. The deployment user must own the checkout,
   be able to fetch from `origin` without prompts, and have permission to run
   Docker Compose. Do not use this checkout for editing source files.
3. Ensure Bash, Git, `flock` (util-linux), Node.js 26+, Yarn, and Docker Compose
   are on this user's **noninteractive SSH PATH**. Tools installed only through
   interactive shell profiles, such as some nvm setups, need explicit PATH setup.
4. Create a dedicated SSH key for deployments. Add its public key to the user's
   `~/.ssh/authorized_keys`; store the private key in GitHub, not in the repo.
   The server's SSH port must be reachable from GitHub-hosted runners.

### GitHub setup

In **Settings → Secrets and variables → Actions**, add these repository secrets:

| Secret | Value |
| --- | --- |
| `DEPLOY_HOST` | Server hostname or IP address |
| `DEPLOY_USER` | SSH deployment username |
| `DEPLOY_SSH_KEY` | Dedicated private key, including its header/footer; no passphrase |
| `DEPLOY_KNOWN_HOSTS` | Verified OpenSSH known_hosts entry for the server |

Obtain the server's SSH host public key through a trusted connection and verify
its fingerprint. For a nonstandard port, the known_hosts entry uses
`[hostname]:port`. The workflow checks this pinned key instead of trusting a new
key fetched during deployment.

Add these repository **variables**:

| Variable | Value |
| --- | --- |
| `DEPLOY_PATH` | Absolute repository path, e.g. `/srv/av-converter` (letters, digits, `_`, `.`, `-`, and `/` only) |
| `DEPLOY_PORT` | SSH port; optional, defaults to `22` |
| `DEPLOY_ENABLED` | Set to `true` after setup to enable deployment; `false` disables it |

The job uses the GitHub `production` environment. You may configure environment
protection rules; required reviewers make deployment wait for approval. For fully
automatic deployment, do not require manual approval. Changes to the enable flag
apply on the next push to `master`; enabling it alone does not trigger a run.

### Deployment behavior

The server runs `scripts/deploy.sh` with the full commit SHA that passed CI. It
fetches `master`, skips superseded commits, refuses to overwrite tracked local
edits, checks out the tested commit in detached HEAD mode, then runs:

```sh
yarn install --frozen-lockfile
yarn deploy-all
```

GitHub serializes deployments without cancelling an active deployment. A server
lock also prevents concurrent invocations of the deployment script. Ignored
cookies and other production files remain in place. Follow deployments in the
**Actions → CI → deploy** job logs.

A failed command fails the job; there is no automatic rollback. Container
recreation can interrupt active downloads, just as a manual `yarn deploy-all`
would. To retry after correcting a server problem, rerun the failed deployment
job in Actions. An older commit is skipped if `master` has since advanced.

Run deployment-script tests locally without SSH, containers, or internet access:

```sh
python -m unittest discover -s scripts -p 'test_*.py'
```
