<div align="center">
  <img src="https://img.shields.io/badge/Node.js-0F9A41?style=for-the-badge&logo=node&color=black" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express-0F9A41?style=for-the-badge&logo=express&color=black" alt="Express" />
  <img src="https://img.shields.io/badge/React-000000?style=for-the-badge&logo=react&logoColor=60DAFB" alt="React" />
  <img src="https://img.shields.io/badge/FFmpeg-000000?style=for-the-badge&logo=ffmpeg&logoColor=green" alt="FFmpeg" />
  <img src="https://img.shields.io/badge/Docker-000000?style=for-the-badge&logo=docker&logoColor=0db7ed" alt="Docker" />
  <img src="https://img.shields.io/badge/Tailwind-black?style=for-the-badge&logo=tailwind-css&logoColor=38B2AC" alt="Tailwind">
</div>

![](screenshot.png)

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

## Docker
You can run this web app in a Docker container with a single command. Switch to the `docker/dev` directory, then run:
```
docker compose up --build --watch
```
Access the web app at http://localhost:3001

_Any changes you make in `/src` will be reflected without having to rebuild any containers. Simply refresh your web browser._