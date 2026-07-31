import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // AI Coach（统一走 api_server.py :19998，重写后带 /api/coach 前缀）
      '/coach': {
        target: 'http://127.0.0.1:19998',
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
      // SecondBrain (api_server.py :19998，契约 v1)
      '/secondbrain': {
        target: 'http://127.0.0.1:19998',
        changeOrigin: true,
      },
      '/patina': {
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