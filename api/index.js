const fs = require('fs')
const path = require('path')

function findBaseDir() {
  const candidates = [
    process.cwd(),
    path.join(__dirname, '..'),
    path.join(__dirname, '../..'),
    '/var/task'
  ]
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'config', 'clusters.json'))) return dir
  }
  return process.cwd()
}

const BASE_DIR = findBaseDir()
const CONFIG_DIR = path.join(BASE_DIR, 'config')
const LOGS_DIR = path.join(BASE_DIR, 'logs')

function readJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    console.error(`Failed to read ${filePath}:`, err)
    return fallback
  }
}

function loadClustersConfig() {
  return readJson(path.join(CONFIG_DIR, 'clusters.json'), { clusters: [], models: [] })
}

function loadPromptsFromFile(filename) {
  const filePath = path.join(CONFIG_DIR, filename)
  if (!fs.existsSync(filePath)) return []
  return fs
    .readFileSync(filePath, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function loadTargetsFromFile(filename) {
  const filePath = path.join(CONFIG_DIR, filename)
  if (!fs.existsSync(filePath)) return []
  return readJson(filePath, [])
}

function getLogFiles() {
  if (!fs.existsSync(LOGS_DIR)) return []
  return fs
    .readdirSync(LOGS_DIR)
    .filter((name) => name.startsWith('run_') && name.endsWith('.json'))
    .sort((a, b) => b.localeCompare(a))
    .map((name) => path.join(LOGS_DIR, name))
}

function parseLogFile(filePath) {
  return readJson(filePath, {})
}

function normalize(str) {
  return (str || '').toLowerCase().trim()
}

function resultMatchesCluster(prompt, promptsSet) {
  const lp = normalize(prompt)
  for (const cp of promptsSet) {
    const lcp = normalize(cp)
    if (!lcp) continue
    if (lp === lcp || lp.includes(lcp) || lcp.includes(lp)) return true
  }
  return false
}

function flattenDomainUrls(domainUrls, citedUrls) {
  const citedSet = new Set((citedUrls || []).map((u) => u.replace(/\/$/, '')))
  const others = []
  Object.entries(domainUrls || {}).forEach(([, urls]) => {
    (urls || []).forEach((url) => {
      const normalized = (url || '').replace(/\/$/, '')
      if (normalized && !citedSet.has(normalized)) others.push(url)
    })
  })
  return Array.from(new Set(others)).slice(0, 10)
}

function shapeResult(result) {
  const matches = Array.isArray(result?.matches) ? result.matches : []
  const cited = matches.length > 0
  const targetUrls = []
  const citedUrls = []
  const ranks = []

  matches.forEach((match) => {
    ;(match.target_urls || []).forEach((url) => {
      if (url && !targetUrls.includes(url)) targetUrls.push(url)
    })
    ;(match.cited_urls || match.matched_urls || []).forEach((url) => {
      if (url && !citedUrls.includes(url)) citedUrls.push(url)
    })
    ;(match.ranks || []).forEach((r) => {
      if (r !== undefined && !ranks.includes(r)) ranks.push(r)
    })
  })

  const otherUrls = flattenDomainUrls(result?.domain_urls || {}, citedUrls)

  const status = cited && citedUrls.length
    ? `cited URL(s): ${citedUrls.join(', ')}${ranks.length ? `\nrank(s): ${ranks.sort((a, b) => a - b).join(', ')}` : ''}`
    : 'no target URLs cited'

  return {
    prompt: result?.prompt || '',
    cited,
    target_urls: targetUrls,
    cited_urls: citedUrls,
    ranks: ranks.length ? ranks.sort((a, b) => a - b) : null,
    other_urls: otherUrls,
    status
  }
}

function getRunsByCluster(cluster, config) {
  const prompts = new Set(loadPromptsFromFile(cluster.prompts_file || ''))
  if (!prompts.size) return []

  const runs = []
  for (const filePath of getLogFiles()) {
    const log = parseLogFile(filePath)
    const filteredResults = (log.results || []).filter((r) => resultMatchesCluster(r.prompt, prompts))
    if (!filteredResults.length) continue
    runs.push({
      timestamp: log.timestamp,
      model: log.model,
      provider: log.provider,
      results: filteredResults.map(shapeResult)
    })
  }
  return runs
}

function buildClustersResponse() {
  const config = loadClustersConfig()
  const clusters = []
  for (const cluster of config.clusters || []) {
    const prompts = loadPromptsFromFile(cluster.prompts_file || '')
    const runs = getRunsByCluster(cluster, config)
    let totalRuns = 0
    let totalCited = 0
    runs.forEach((run) => {
      totalRuns += run.results.length
      totalCited += run.results.filter((r) => r.cited).length
    })
    const citationRate = totalRuns > 0 ? Math.round((totalCited / totalRuns) * 1000) / 10 : 0
    clusters.push({
      id: cluster.id,
      name: cluster.name,
      description: cluster.description || '',
      prompt_count: prompts.length,
      citation_rate: citationRate,
      prompts_file: cluster.prompts_file,
      targets_file: cluster.targets_file,
      workflow: cluster.workflow
    })
  }
  return { clusters }
}

function buildClusterDetail(clusterId) {
  const config = loadClustersConfig()
  const cluster = (config.clusters || []).find((c) => c.id === clusterId)
  if (!cluster) return null

  const prompts = loadPromptsFromFile(cluster.prompts_file || '')
  const targets = cluster.targets_file ? loadTargetsFromFile(cluster.targets_file) : []
  const runs = getRunsByCluster(cluster, config)

  // Group runs by timestamp, considering runs within 10 minutes as one logical workflow run
  // Sort runs by timestamp first (earliest first) for proper grouping
  const sortedRunsInput = [...runs].sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''))
  
  const runsByTimestamp = new Map()
  
  sortedRunsInput.forEach((run) => {
    const ts = run.timestamp
    if (!ts) return
    
    // Try to find existing group within 10 minutes
    let groupedTs = null
    for (const existingTs of Array.from(runsByTimestamp.keys()).sort()) {
      try {
        // Parse timestamps: 20260113T160308Z -> 2026-01-13T16:03:08Z
        const parseTs = (t) => {
          const m = t.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/)
          if (!m) return null
          return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`)
        }
        
        const tsDate = parseTs(ts)
        const existingDate = parseTs(existingTs)
        if (!tsDate || !existingDate) continue
        
        const diffMs = Math.abs(tsDate - existingDate)
        if (diffMs < 600000) { // 10 minutes in milliseconds
          // Always use the earlier timestamp as the group key
          groupedTs = tsDate < existingDate ? ts : existingTs
          // If we need to use an earlier timestamp, move the existing group
          if (groupedTs === ts && groupedTs !== existingTs) {
            const existingGroup = runsByTimestamp.get(existingTs)
            runsByTimestamp.set(ts, { ...existingGroup, timestamp: ts })
            runsByTimestamp.delete(existingTs)
          }
          break
        }
      } catch (e) {
        // If date parsing fails, just use the timestamp as-is
      }
    }
    
    const targetTs = groupedTs || ts
    if (!runsByTimestamp.has(targetTs)) {
      runsByTimestamp.set(targetTs, { timestamp: targetTs, models: [] })
    }
    
    // Check if this model already exists in this group - if so, merge results instead of duplicating
    const existingGroup = runsByTimestamp.get(targetTs)
    const existingModelIndex = existingGroup.models.findIndex(m => m.model === run.model)
    
    if (existingModelIndex >= 0) {
      // Merge with existing model - keep the one with more results or later timestamp
      const existing = existingGroup.models[existingModelIndex]
      if (run.results.length > existing.results.length) {
        // Replace with the run that has more results
        existingGroup.models[existingModelIndex] = {
          model: run.model,
          provider: run.provider,
          results: run.results,
          cited_count: run.results.filter((r) => r.cited).length,
          total_count: run.results.length
        }
      }
      // Otherwise keep the existing one
    } else {
      // Add new model
      existingGroup.models.push({
        model: run.model,
        provider: run.provider,
        results: run.results,
        cited_count: run.results.filter((r) => r.cited).length,
        total_count: run.results.length
      })
    }
  })

  const sortedRuns = Array.from(runsByTimestamp.values()).sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
  const latestRun = sortedRuns[0] || { timestamp: null, models: [] }

  const allModels = config.models || []
  
  // Deduplicate models - keep only the first occurrence of each model (safety check)
  const seen = new Set()
  const uniqueModels = []
  for (const m of latestRun.models) {
    if (m && m.model && !seen.has(m.model)) {
      seen.add(m.model)
      uniqueModels.push(m)
    }
  }
  
  // Add missing models as empty placeholders
  const modelOrder = ['gpt-oss-20b-free-online', 'claude-3.5-haiku-online', 'perplexity-sonar-online']
  for (const modelName of modelOrder) {
    if (!seen.has(modelName)) {
      const modelConfig = allModels.find((m) => m.name === modelName)
      if (modelConfig) {
        uniqueModels.push({
          model: modelName,
          provider: modelConfig.provider,
          results: [],
          cited_count: 0,
          total_count: 0
        })
      }
    }
  }
  
  // Sort by model order and ensure exactly 3 models
  latestRun.models = uniqueModels
    .filter((m) => modelOrder.includes(m.model))
    .sort((a, b) => {
      const ia = modelOrder.indexOf(a.model)
      const ib = modelOrder.indexOf(b.model)
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
    })
    .slice(0, 3)

  return {
    cluster: {
      id: cluster.id,
      name: cluster.name,
      description: cluster.description || '',
      workflow: cluster.workflow
    },
    prompts,
    targets,
    runs: sortedRuns.slice(0, 10),
    latest_run: latestRun,
    all_models: allModels
  }
}

function healthz() {
  const configExists = fs.existsSync(path.join(CONFIG_DIR, 'clusters.json'))
  const logsExists = fs.existsSync(LOGS_DIR)
  const logFiles = getLogFiles()
  return {
    status: 'ok',
    base_dir: BASE_DIR,
    config_dir: CONFIG_DIR,
    logs_dir: LOGS_DIR,
    config_exists: configExists,
    logs_exists: logsExists,
    log_files_count: logFiles.length,
    sample_log_files: logFiles.slice(0, 5).map((f) => path.basename(f)),
    cwd: process.cwd()
  }
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    const pathname = url.pathname

    if (pathname === '/api/healthz') {
      return sendJson(res, 200, healthz())
    }

    if (pathname === '/api/clusters' && req.method === 'GET') {
      return sendJson(res, 200, buildClustersResponse())
    }

    // POST /api/clusters - Create cluster
    if (pathname === '/api/clusters' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        try {
          const data = JSON.parse(body)
          const clusterId = (data.id || '').trim()
          const clusterName = (data.name || '').trim()
          const clusterDescription = (data.description || '').trim()

          if (!clusterId) {
            return sendJson(res, 400, { detail: 'Cluster ID is required' })
          }

          if (!clusterName) {
            return sendJson(res, 400, { detail: 'Cluster name is required' })
          }

          const config = loadClustersConfig()
          const clusters = config.clusters || []

          // Check if cluster ID already exists
          if (clusters.some((c) => c.id === clusterId)) {
            return sendJson(res, 400, { detail: `Cluster with id '${clusterId}' already exists` })
          }

          // Create prompts file for the cluster
          const promptsFilename = `prompts_${clusterId}.txt`
          const promptsPath = path.join(CONFIG_DIR, promptsFilename)
          if (!fs.existsSync(promptsPath)) {
            fs.writeFileSync(promptsPath, '# Add your prompts here, one per line\n')
          }

          // Add new cluster
          const newCluster = {
            id: clusterId,
            name: clusterName,
            description: clusterDescription || `Prompts for ${clusterName}`,
            prompts_file: promptsFilename,
            targets_file: 'targets_fanout.json',
            workflow: `citation-check-${clusterId}.yml`
          }

          clusters.push(newCluster)
          config.clusters = clusters

          // Save clusters config
          const configPath = path.join(CONFIG_DIR, 'clusters.json')
          fs.writeFileSync(configPath, JSON.stringify(config, null, 2))

          return sendJson(res, 200, { cluster: newCluster, message: 'Cluster created successfully' })
        } catch (err) {
          console.error('Error creating cluster:', err)
          return sendJson(res, 500, { detail: err.message || 'Internal server error' })
        }
      })
      return
    }

    // DELETE /api/clusters/:cluster_id - Delete cluster
    const deleteClusterMatch = pathname.match(/^\/api\/clusters\/([^/]+)$/)
    if (deleteClusterMatch && req.method === 'DELETE') {
      try {
        const clusterId = deleteClusterMatch[1]
        const config = loadClustersConfig()
        const clusters = config.clusters || []
        const originalLen = clusters.length

        config.clusters = clusters.filter((c) => c.id !== clusterId)

        if (config.clusters.length === originalLen) {
          return sendJson(res, 404, { detail: `Cluster '${clusterId}' not found` })
        }

        // Save clusters config
        const configPath = path.join(CONFIG_DIR, 'clusters.json')
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2))

        return sendJson(res, 200, { message: `Cluster '${clusterId}' deleted successfully` })
      } catch (err) {
        console.error('Error deleting cluster:', err)
        return sendJson(res, 500, { detail: err.message || 'Internal server error' })
      }
    }

    const clusterDetailMatch = pathname.match(/^\/api\/clusters\/([^/]+)$/)
    if (clusterDetailMatch && req.method === 'GET') {
      const detail = buildClusterDetail(clusterDetailMatch[1])
      if (!detail) return sendJson(res, 404, { detail: 'Cluster not found' })
      return sendJson(res, 200, detail)
    }

    // POST /api/prompts - Add prompt
    if (pathname === '/api/prompts' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        try {
          const data = JSON.parse(body)
          const clusterId = data.cluster_id || data.cluster
          const promptText = (data.prompt || '').trim()

          if (!promptText) {
            return sendJson(res, 400, { detail: 'Prompt cannot be empty' })
          }

          if (!clusterId) {
            return sendJson(res, 400, { detail: 'Cluster ID is required' })
          }

          const config = loadClustersConfig()
          const cluster = (config.clusters || []).find((c) => c.id === clusterId)

          if (!cluster) {
            return sendJson(res, 404, { detail: `Cluster '${clusterId}' not found` })
          }

          const promptsFile = cluster.prompts_file || `prompts_${clusterId}.txt`
          const promptsPath = path.join(CONFIG_DIR, promptsFile)

          // Read existing prompts to avoid duplicates
          let existingPrompts = []
          if (fs.existsSync(promptsPath)) {
            existingPrompts = loadPromptsFromFile(promptsFile)
          }

          if (existingPrompts.includes(promptText)) {
            return sendJson(res, 400, { detail: 'Prompt already exists in this cluster' })
          }

          // Append new prompt
          fs.appendFileSync(promptsPath, `\n${promptText}`)

          return sendJson(res, 200, { message: 'Prompt added successfully', prompt: promptText, cluster_id: clusterId })
        } catch (err) {
          console.error('Error adding prompt:', err)
          return sendJson(res, 500, { detail: err.message || 'Internal server error' })
        }
      })
      return
    }

    // PUT /api/prompts/:cluster_id - Edit prompt
    if (pathname.match(/^\/api\/prompts\/([^/]+)$/) && req.method === 'PUT') {
      const editMatch = pathname.match(/^\/api\/prompts\/([^/]+)$/)
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        try {
          const data = JSON.parse(body)
          const clusterId = editMatch[1]
          const oldPrompt = (data.old_prompt || '').trim()
          const newPrompt = (data.new_prompt || data.prompt || '').trim()

          if (!oldPrompt) {
            return sendJson(res, 400, { detail: 'old_prompt is required' })
          }

          if (!newPrompt) {
            return sendJson(res, 400, { detail: 'new_prompt cannot be empty' })
          }

          if (oldPrompt === newPrompt) {
            return sendJson(res, 400, { detail: 'New prompt must be different from old prompt' })
          }

          const config = loadClustersConfig()
          const cluster = (config.clusters || []).find((c) => c.id === clusterId)

          if (!cluster) {
            return sendJson(res, 404, { detail: `Cluster '${clusterId}' not found` })
          }

          const promptsFile = cluster.prompts_file || `prompts_${clusterId}.txt`
          const promptsPath = path.join(CONFIG_DIR, promptsFile)

          if (!fs.existsSync(promptsPath)) {
            return sendJson(res, 404, { detail: 'Prompts file not found' })
          }

          // Read existing prompts
          const content = fs.readFileSync(promptsPath, 'utf-8')
          const lines = content.split('\n')

          // Find and replace the prompt
          let found = false
          const updatedLines = []
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            const stripped = line.trim()
            // Skip empty lines and comments
            if (!stripped || stripped.startsWith('#')) {
              updatedLines.push(i === lines.length - 1 ? line : line + '\n')
              continue
            }
            // Check if this is the prompt to replace
            if (stripped === oldPrompt) {
              found = true
              updatedLines.push(newPrompt + (i === lines.length - 1 ? '' : '\n'))
            } else {
              updatedLines.push(i === lines.length - 1 ? line : line + '\n')
            }
          }

          if (!found) {
            return sendJson(res, 404, { detail: `Prompt not found: ${oldPrompt.substring(0, 50)}` })
          }

          // Check if new prompt already exists (duplicate check)
          // Get original prompts from file to check if new_prompt exists elsewhere
          const originalPrompts = lines
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#'))
          // Remove old_prompt from the list when checking
          const otherPrompts = originalPrompts.filter((p) => p !== oldPrompt)
          if (otherPrompts.includes(newPrompt)) {
            return sendJson(res, 400, { detail: 'New prompt already exists in this cluster' })
          }

          // Write back the updated lines
          fs.writeFileSync(promptsPath, updatedLines.join(''))

          return sendJson(res, 200, {
            message: 'Prompt updated successfully',
            old_prompt: oldPrompt,
            new_prompt: newPrompt
          })
        } catch (err) {
          console.error('Error editing prompt:', err)
          return sendJson(res, 500, { detail: err.message || 'Internal server error' })
        }
      })
      return
    }

    // DELETE /api/prompts/:cluster_id?prompt_text=... - Delete prompt
    const deletePromptMatch = pathname.match(/^\/api\/prompts\/([^/]+)$/)
    if (deletePromptMatch && req.method === 'DELETE') {
      try {
        const clusterId = deletePromptMatch[1]
        const promptText = url.searchParams.get('prompt_text')
        if (!promptText) {
          return sendJson(res, 400, { detail: 'prompt_text query parameter is required' })
        }
        const decodedPromptText = (decodeURIComponent(promptText) || '').trim()

        if (!decodedPromptText) {
          return sendJson(res, 400, { detail: 'prompt_text cannot be empty' })
        }

        const config = loadClustersConfig()
        const cluster = (config.clusters || []).find((c) => c.id === clusterId)

        if (!cluster) {
          return sendJson(res, 404, { detail: `Cluster '${clusterId}' not found` })
        }

        const promptsFile = cluster.prompts_file || `prompts_${clusterId}.txt`
        const promptsPath = path.join(CONFIG_DIR, promptsFile)

        if (!fs.existsSync(promptsPath)) {
          return sendJson(res, 404, { detail: 'Prompts file not found' })
        }

        // Read existing prompts
        const content = fs.readFileSync(promptsPath, 'utf-8')
        const lines = content.split('\n')

        // Filter out the prompt to delete (exact match after stripping)
        const filteredLines = []
        let found = false
        for (const line of lines) {
          const stripped = line.trim()
          // Skip empty lines and comments
          if (!stripped || stripped.startsWith('#')) {
            filteredLines.push(line)
            continue
          }
          // Compare stripped versions
          if (stripped === decodedPromptText) {
            found = true
            continue // Skip this line
          }
          filteredLines.push(line)
        }

        if (!found) {
          return sendJson(res, 404, { detail: 'Prompt not found' })
        }

        // Write back the filtered lines
        fs.writeFileSync(promptsPath, filteredLines.join('\n'))

        return sendJson(res, 200, { message: 'Prompt deleted successfully' })
      } catch (err) {
        console.error('Error deleting prompt:', err)
        return sendJson(res, 500, { detail: err.message || 'Internal server error' })
      }
    }

    return sendJson(res, 404, { error: 'Not found' })
  } catch (err) {
    console.error('API error', err)
    return sendJson(res, 500, { error: 'internal_error', message: err?.message || String(err) })
  }
}
