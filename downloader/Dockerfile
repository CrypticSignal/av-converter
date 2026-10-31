FROM node:25-bookworm-slim AS node-runtime

FROM python:3.12-slim-bookworm
# Use a supported Node release; Debian's nodejs package can be too old for yt-dlp.
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libstdc++6 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .
RUN useradd --create-home downloader
USER downloader
ENV HOST=0.0.0.0
EXPOSE 8000
CMD ["python", "server.py"]
