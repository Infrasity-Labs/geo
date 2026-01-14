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
    
    runsByTimestamp.get(targetTs).models.push({
      model: run.model,
      provider: run.provider,
      results: run.results,
      cited_count: run.results.filter((r) => r.cited).length,
      total_count: run.results.length
    })
  })

  const sortedRuns = Array.from(runsByTimestamp.values()).sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
  const latestRun = sortedRuns[0] || { timestamp: null, models: [] }

  const allModels = config.models || []
  
  // Deduplicate models - keep only the first occurrence of each model
  const seen = new Set()
  const uniqueModels = []
  for (const m of latestRun.models) {
    if (m.model && !seen.has(m.model)) {
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

    const clusterDetailMatch = pathname.match(/^\/api\/clusters\/([^/]+)$/)
    if (clusterDetailMatch && req.method === 'GET') {
      const detail = buildClusterDetail(clusterDetailMatch[1])
      if (!detail) return sendJson(res, 404, { detail: 'Cluster not found' })
      return sendJson(res, 200, detail)
    }

    return sendJson(res, 404, { error: 'Not found' })
  } catch (err) {
    console.error('API error', err)
    return sendJson(res, 500, { error: 'internal_error', message: err?.message || String(err) })
  }
}
