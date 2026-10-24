import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Local development only. The browser never needs permissive backend CORS.
  const proxy = {
    '/backend': {
      target: env.BACKEND_PROXY_TARGET || 'http://127.0.0.1:8000',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/backend/, ''),
    },
  }
  return { plugins: [react()], server: { proxy }, preview: { proxy } }
})
