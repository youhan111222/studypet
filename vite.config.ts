import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // AI Coach (deepseek_service.py :19999) — 独立路径，重写后带 /api/coach 前缀
      '/coach': {
        target: 'http://127.0.0.1:19999',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/coach/, '/api/coach'),
      },
      // Activity tracker & utility API (api_server.py :19998)
      '/activity': {
        target: 'http://127.0.0.1:19998',
        changeOrigin: true,
      },
      '/deepseek': {
        target: 'http://127.0.0.1:19998',
        changeOrigin: true,
      },
      '/search': {
        target: 'http://127.0.0.1:19998',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://127.0.0.1:19998',
        changeOrigin: true,
      },
    },
  },
})