import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['pwa-icon.svg'],
      manifest: {
        name: 'StudyPet 学习伴侣',
        short_name: 'StudyPet',
        description: '广东专插本备考：刷题、FSRS 复习、AI 教练、屏幕追踪、SecondBrain 联动',
        lang: 'zh-CN',
        theme_color: '#4F46E5',
        background_color: '#111827',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
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