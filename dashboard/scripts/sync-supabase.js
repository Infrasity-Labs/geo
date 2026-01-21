import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const configDir = path.join(repoRoot, 'config')
const logsDir = path.join(repoRoot, 'logs')

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const SUPABASE_COMPANY_ID = process.env.SUPABASE_COMPANY_ID || ''
const LABEL = process.env.SUPABASE_LABEL || 'default'

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_COMPANY_ID) {
  console.error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_COMPANY_ID')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function readJson(filePath) {
  const buf = await fs.readFile(filePath)
  return JSON.parse(buf.toString())
}

function normalize(str) {
  return (str || '').toLowerCase().trim()
}

function clusterMatchesPrompt(clusterPrompts, prompt) {
  const lp = normalize(prompt)
  if (clusterPrompts.has(lp)) return true
  for (const cp of clusterPrompts) {
    if (cp.includes(lp) || lp.includes(cp)) return true
  }
  return false
}

function parseTimestamp(ts) {
  if (!ts || ts.length < 15) return null
  try {
    const year = ts.slice(0, 4)
    const month = ts.slice(4, 6)
    const day = ts.slice(6, 8)
    const hour = ts.slice(9, 11)
    const min = ts.slice(11, 13)
    const sec = ts.slice(13, 15)
    return `${year}-${month}-${day}T${hour}:${min}:${sec}Z`
  } catch {
    return null
  }
}

function formatResult(result) {
  const matches = Array.isArray(result?.matches) ? result.matches : []
  const citedUrls = []
  const targetUrls = []
  const matchedUrls = []
  const ranks = []

  matches.forEach((m) => {
    ;(m.target_urls || []).forEach((u) => { if (u && !targetUrls.includes(u)) targetUrls.push(u) })
    ;(m.cited_urls || m.matched_urls || []).forEach((u) => { if (u && !citedUrls.includes(u)) citedUrls.push(u) })
    ;(m.matched_urls || []).forEach((u) => { if (u && !matchedUrls.includes(u)) matchedUrls.push(u) })
    ;(m.ranks || []).forEach((r) => { if (r !== undefined && !ranks.includes(r)) ranks.push(r) })
  })

  const citedSet = new Set(citedUrls.map((u) => u.replace(/\/$/, '')))
  const otherUrls = []
  Object.entries(result?.domain_urls || {}).forEach(([, urls]) => {
    (urls || []).forEach((u) => {
      const normalized = (u || '').replace(/\/$/, '')
      if (normalized && !citedSet.has(normalized)) otherUrls.push(u)
    })
  })

  const domains = Array.isArray(result?.domains) ? result.domains : []
  const domainRanks = result?.domain_ranks || null
  const domainUrls = result?.domain_urls || null

  return {
    prompt: result?.prompt || '',
    target_domain: targetUrls[0] ? targetUrls[0].replace(/^https?:\/\//, '').split('/')[0] : null,
    target_urls: targetUrls,
    cited_urls: citedUrls,
    matched_urls: matchedUrls,
    ranks,
    other_urls: Array.from(new Set(otherUrls)).slice(0, 20),
    domains,
    domain_ranks: domainRanks,
    domain_urls: domainUrls,
    matches: matches.length ? matches : null,
    raw: result?.raw || null,
    parsed: result?.parsed || null,
    json_valid: Boolean(result?.json_valid),
  }
}

async function loadClusters() {
  const clusters = await readJson(path.join(configDir, 'clusters.json'))
  return (clusters.clusters || []).map((c) => ({ ...c }))
}

async function loadPrompts(fileName) {
  if (!fileName) return []
  const filePath = path.join(configDir, fileName)
  try {
    const data = await fs.readFile(filePath, 'utf-8')
    return data.split('\n').map((l) => l.trim()).filter(Boolean)
  } catch {
    return []
  }
}

async function upsertClusters(clusters) {
  const rows = clusters.map((c) => ({
    company_id: SUPABASE_COMPANY_ID,
    label: LABEL,
    slug: c.id,
    name: c.name,
    description: c.description || '',
    prompts: c.__prompts || [],
    created_at: c.created_at,
    updated_at: new Date().toISOString(),
  }))

  const { error } = await supabase.from('geo_clusters').upsert(rows, { onConflict: 'company_id,label,slug' })
  if (error) throw error
}

async function deleteResultsForRun(runId) {
  const { error } = await supabase.from('geo_run_results').delete().eq('run_id', runId)
  if (error) throw error
}

async function upsertRun(runRow) {
  const { data, error } = await supabase
    .from('geo_runs')
    .upsert(runRow, { onConflict: 'company_id,label,cluster_slug,run_timestamp,model' })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

async function insertResults(runId, results) {
  if (!results.length) return
  const rows = results.map((r) => ({ ...r, run_id: runId }))
  const { error } = await supabase.from('geo_run_results').insert(rows)
  if (error) throw error
}

async function syncRuns(clusters) {
  const files = (await fs.readdir(logsDir)).filter((f) => f.startsWith('run_') && f.endsWith('.json'))
  files.sort((a, b) => b.localeCompare(a))

  for (const file of files) {
    const payload = await readJson(path.join(logsDir, file))
    const ts = payload.timestamp || file.replace(/^run_|\.json$/g, '')
    const runTimestamp = parseTimestamp(ts)
    const provider = payload.provider || 'unknown'
    const model = payload.model || 'unknown'
    const results = Array.isArray(payload.results) ? payload.results : []

    for (const cluster of clusters) {
      const filtered = results.filter((r) => clusterMatchesPrompt(cluster.__promptSet, r.prompt || ''))
      const runRow = {
        company_id: SUPABASE_COMPANY_ID,
        label: LABEL,
        cluster_slug: cluster.id,
        run_timestamp: runTimestamp,
        provider,
        model,
        summary_md: null,
        raw_log_path: file,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const runId = await upsertRun(runRow)
      await deleteResultsForRun(runId)
      const shaped = filtered.map(formatResult)
      await insertResults(runId, shaped)
    }
  }
}

async function main() {
  const clusters = await loadClusters()
  for (const c of clusters) {
    c.__prompts = await loadPrompts(c.prompts_file)
    c.__promptSet = new Set((c.__prompts || []).map((p) => p.toLowerCase().trim()))
  }

  await upsertClusters(clusters)
  await syncRuns(clusters)

  console.log('Supabase sync complete')
}

main().catch((err) => {
  console.error('Supabase sync failed:', err)
  process.exit(1)
})
