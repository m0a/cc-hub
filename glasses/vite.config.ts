import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: 'dist',
  },
  server: {
    host: '0.0.0.0',
    port: 8391,
    proxy: {
      '/api': {
        target: process.env.CCHUB_URL || 'https://localhost:3456',
        secure: false,
        changeOrigin: true,
      },
      '/ws/mux': {
        target: process.env.CCHUB_URL || 'https://localhost:3456',
        secure: false,
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
