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
        target: 'https://localhost:5923',
        secure: false,
        changeOrigin: true,
      },
      '/ws/mux': {
        target: 'https://localhost:5923',
        secure: false,
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
