import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  if (mode === 'production') {
    const value = env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '') || ''
    let url
    try { url = new URL(value) } catch { url = null }
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('Production build configuration error: set VITE_API_BASE_URL to an absolute HTTPS backend URL with no credentials, query, or fragment.')
    }
  }
  const localProxyTarget = env.BACKEND_PROXY_TARGET || 'http://127.0.0.1:8000'
  // Local development only. The browser never needs permissive backend CORS.
  const proxy = {
    '/backend': {
      target: localProxyTarget,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/backend/, ''),
    },
  }
  // Production builds must not silently embed the local proxy path. The client
  // validates VITE_API_BASE_URL while this proxy remains local-only plumbing.
  return { plugins: [react()], server: { proxy }, preview: { proxy } }
})
