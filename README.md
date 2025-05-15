<div align="center">
  <img src="https://img.shields.io/badge/Node.js-0F9A41?style=for-the-badge&logo=node&color=black" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express-0F9A41?style=for-the-badge&logo=express&color=black" alt="Express" />
  <img src="https://img.shields.io/badge/React-000000?style=for-the-badge&logo=react&logoColor=60DAFB" alt="React" />
  <img src="https://img.shields.io/badge/FFmpeg-000000?style=for-the-badge&logo=ffmpeg&logoColor=green" alt="FFmpeg" />
  <img src="https://img.shields.io/badge/Docker-000000?style=for-the-badge&logo=docker&logoColor=0db7ed" alt="Docker" />

  ![Screenshot of audio/video converter](screenshot.png)

  Convert an audio or video file to AAC, AC3 (Dolby Digital), ALAC, DTS, FLAC, MP3, Opus, Vorbis or WAV.

_Note: converting a video to one of the above formats will turn it into an audio-only file. You can also convert a video to MP4 or MKV._

## Docker
You can run this web app locally with a single command:
```
cd docker/dev && docker compose up --build --watch
```
Or if using PowerShell:
```powershell
Set-Location docker/dev; if ($?) { docker compose up --build --watch }
```
Then, visit http://localhost:3001

_Any changes you make in `/src` will be reflected without having to rebuild any containers. Simply refresh your web browser._
</div>