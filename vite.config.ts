import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { constants, gzip } from 'node:zlib'

const gzipAsync = promisify(gzip)
/** Files worth compressing. Images and fonts are already compressed. */
const COMPRESSIBLE = /\.(js|mjs|css|wasm|json|svg|txt|html)$/

/**
 * Write a gzipped copy (file.gz) next to each built asset, which Nginx serves with
 * gzip_static (see docker/prod/locations.conf). The FFmpeg cores shrink from about 42 MB
 * to 12 MB, and compressing once at build time spares Nginx doing it on every request.
 */
const precompress = (): Plugin => ({
  name: 'precompress',
  apply: 'build',
  async closeBundle() {
    const dir = join('build', 'assets')
    const files = (await readdir(dir)).filter(name => COMPRESSIBLE.test(name))
    await Promise.all(files.map(async name => {
      const path = join(dir, name)
      const compressed = await gzipAsync(await readFile(path), { level: constants.Z_BEST_COMPRESSION })
      await writeFile(`${path}.gz`, compressed)
    }))
  },
})

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    precompress(),
    {
      // Serve the game at /game in development, as Nginx does in production.
      name: 'game-route',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/game') req.url = '/game/game.html';
          next();
        });
      },
    },
  ],
  server: {
    proxy: {
      '/api/': {
        target: process.env.DOWNLOADER_URL || 'http://127.0.0.1:8000',
        // No development proxy timeout while yt-dlp downloads or records a live source.
        timeout: 0,
        proxyTimeout: 0,
      },
    },
    port: 3000,
    host: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  build: {
    outDir: 'build'
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
})
