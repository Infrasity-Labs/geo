import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// Custom plugin to serve data.json as API endpoints
function staticApiPlugin() {
  return {
    name: 'static-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/api/clusters') {
          const dataPath = path.resolve(__dirname, 'public/data.json')
          try {
            const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ clusters: data.clusters || [] }))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: 'Failed to load data' }))
          }
          return
        }
        
        const clusterMatch = req.url?.match(/^\/api\/clusters\/([^/]+)$/)
        if (clusterMatch) {
          const clusterId = clusterMatch[1]
          const dataPath = path.resolve(__dirname, 'public/data.json')
          try {
            const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
            const detail = data.cluster_details?.[clusterId]
            if (detail) {
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(detail))
            } else {
              res.statusCode = 404
              res.end(JSON.stringify({ error: 'Cluster not found' }))
            }
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
  },
  build: {
    outDir: 'dist',
  },
})
