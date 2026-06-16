import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:7860',
      '/ws': {
        target: 'ws://localhost:7860',
        ws: true
      }
    }
  }
})
