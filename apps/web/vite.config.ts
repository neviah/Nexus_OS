import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiPort = process.env.NEXUS_API_PORT ?? '8080'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
})
