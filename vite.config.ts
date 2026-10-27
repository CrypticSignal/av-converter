import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { ViteDevServer } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'game-route',
      configureServer(server: ViteDevServer) {
        server.middlewares.use((req: any, res: any, next: any) => {
          if (req.url === '/game') {
            req.url = '/game/game.html';
          }
          next();
        });
      }
    }
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
