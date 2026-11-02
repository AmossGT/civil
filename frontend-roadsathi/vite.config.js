import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
    plugins: [react()],
    // Publish the React portal into the FastAPI static root. Keep existing
    // admin/department pages and their scripts alongside the new public UI.
    build: {
      outDir: '../public',
      emptyOutDir: false,
    },
    server: {
      proxy: {
        '/api': {
          target: env.VITE_BACKEND_ORIGIN || 'http://localhost:8000',
          changeOrigin: true,
        },
      },
    },
  }
})
