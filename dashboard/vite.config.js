import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// Custom plugin to serve data.json as API endpoints (fallback only)
function staticApiPlugin() {
  return {
    name: 'static-api',
    configureServer(server) {
      // Only serve static data.json if backend is not available
      // The proxy will handle most API requests
      server.middlewares.use((req, res, next) => {
        // Let proxy handle all /api requests except /data.json
        if (req.url?.startsWith('/api/') && req.url !== '/data.json') {
          return next() // Let proxy handle it
        }
        
        if (req.url === '/data.json') {
          const dataPath = path.resolve(__dirname, 'public/data.json')
          try {
            const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(data))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: 'Failed to load data' }))
          }
          return
        }
        
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), staticApiPlugin()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
})
