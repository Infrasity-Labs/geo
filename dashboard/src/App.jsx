import { useCallback, useEffect, useState } from 'react'

const API_BASE = '/api'
const SNAPSHOT_URL = '/data.json'

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light')
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])
  return { theme, toggleTheme: () => setTheme(t => t === 'light' ? 'dark' : 'light') }
}

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const [loading, setLoading] = useState(true)
  const [clusters, setClusters] = useState([])
  const [selectedCluster, setSelectedCluster] = useState(null)
  const [clusterDetail, setClusterDetail] = useState(null)

  const fetchClusters = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/clusters`)
      if (res.ok) {
        setClusters((await res.json()).clusters || [])
        setLoading(false)
        return
      }
    } catch (err) {
      console.warn('API clusters fetch failed, falling back to snapshot', err)
    }

    // Fallback to static snapshot built at deploy time
    try {
      const snap = await fetch(SNAPSHOT_URL).then(r => r.json())
      setClusters(snap.clusters || [])
      // stash snapshot for detail fallback
      window.__SNAPSHOT = snap
    } catch (err) {
      console.error('Snapshot fetch failed:', err)
    }
    setLoading(false)
  }, [])

  const fetchClusterDetail = useCallback(async (clusterId) => {
    try {
      const res = await fetch(`${API_BASE}/clusters/${clusterId}`)
      if (res.ok) {
        setClusterDetail(await res.json())
        return
      }
    } catch (err) {
      console.warn('API cluster detail fetch failed, falling back to snapshot', err)
    }

    // Fallback to snapshot if available
    const snap = window.__SNAPSHOT
    if (snap && snap.cluster_details && snap.cluster_details[clusterId]) {
      setClusterDetail(snap.cluster_details[clusterId])
    }
  }, [])

  useEffect(() => { fetchClusters() }, [fetchClusters])

  useEffect(() => {
    if (selectedCluster) fetchClusterDetail(selectedCluster)
    else setClusterDetail(null)
  }, [selectedCluster, fetchClusterDetail])

  const totalPrompts = clusters.reduce((sum, c) => sum + (c.prompt_count || 0), 0)

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo">
            <div className="logo-icon">📊</div>
            <div className="logo-text">
              <h1>Prompt Tracker</h1>
              <p>Citation monitoring</p>
            </div>
          </div>
          <div className="header-actions">
            <button className="icon-btn" onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          </div>
        </div>
        <div className="sidebar-nav">
          <h3>Workflows</h3>
          <nav className="nav-list">
            <button
              className={`nav-item ${!selectedCluster ? 'active' : ''}`}
              onClick={() => setSelectedCluster(null)}
            >
              <span>📋</span>
              <div>
                <div>All Clusters</div>
                <div className="nav-meta">{totalPrompts} prompts</div>
              </div>
            </button>
            {clusters.map(c => (
              <button
                key={c.id}
                className={`nav-item ${selectedCluster === c.id ? 'active' : ''}`}
                onClick={() => setSelectedCluster(c.id)}
              >
                <span>📁</span>
                <div>
                  <div>{c.name}</div>
                  <div className="nav-meta">{c.prompt_count} prompts · <span className="rate">{c.citation_rate}%</span></div>
                </div>
              </button>
            ))}
          </nav>
        </div>
      </aside>

      <main className="main-content">
        {loading ? (
          <div className="loading"><div className="spinner"></div> Loading...</div>
        ) : selectedCluster && clusterDetail ? (
          <ClusterDetailView
            detail={clusterDetail}
            onBack={() => setSelectedCluster(null)}
          />
        ) : (
          <OverviewView clusters={clusters} onSelect={setSelectedCluster} />
        )}
      </main>
    </div>
  )
}

function OverviewView({ clusters, onSelect }) {
  return (
    <div>
      <div className="page-header">
        <h1>All Workflows</h1>
        <p className="page-header-sub">Citation check workflows for all service verticals</p>
      </div>
      <div className="cluster-list">
        {clusters.map(c => (
          <button key={c.id} className="cluster-row" onClick={() => onSelect(c.id)}>
            <span className="cluster-icon">📁</span>
            <span className="cluster-name">{c.name}</span>
            <span className="cluster-desc">{c.description}</span>
            <div className="cluster-stats">
              <span className="cluster-prompts">{c.prompt_count} prompts</span>
              <span className="cluster-rate">{c.citation_rate}%</span>
            </div>
            <span className="cluster-arrow">→</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function ClusterDetailView({ detail, onBack }) {
  const cluster = detail?.cluster
  const latestRun = detail?.latest_run
  const allModels = detail?.all_models || []
  const models = latestRun?.models || []
  const workflowFile = cluster?.workflow || `citation-check-${cluster?.id}.yml`

  if (!cluster) return null

  // Ensure we always have all three models (GPT, Claude, Perplexity)
  const modelOrder = ["gpt-oss-20b-free-online", "claude-3.5-haiku-online", "perplexity-sonar-online"]
  const allModelsData = modelOrder.map(modelName => {
    const existing = models.find(m => m.model === modelName)
    if (existing) return existing

    // Find model config
    const modelConfig = allModels.find(m => m.name === modelName)
    return {
      model: modelName,
      provider: modelConfig?.provider || "openrouter",
      results: [],
      cited_count: 0,
      total_count: 0
    }
  })

  return (
    <div>
      <button className="back-btn" onClick={onBack}>← All workflows</button>

      {/* Workflow Header - like GitHub Actions */}
      <div className="workflow-header">
        <div className="workflow-title">{workflowFile}</div>
        <div className="workflow-meta">on: workflow_dispatch</div>
      </div>

      {/* Pipeline Steps - Always show all three models */}
      <div className="pipeline">
        {allModelsData.map((m, i) => {
          const shortName = getShortModelName(m.model)
          const hasData = m.results && m.results.length > 0
          return (
            <React.Fragment key={m.model || i}>
              {i > 0 && <span className="pipeline-connector">•</span>}
              <div className={`pipeline-step ${hasData ? 'success' : ''}`}>
                <span className={`step-icon ${hasData ? 'success' : 'pending'}`}>
                  {hasData ? '✓' : '○'}
                </span>
                <span className="step-name">run-{shortName}-...</span>
                <span className="step-time">{hasData ? '1m 30s' : '-'}</span>
              </div>
            </React.Fragment>
          )
        })}
        <span className="pipeline-connector">•</span>
        <div className={`pipeline-step ${models.length > 0 ? 'success' : ''}`}>
          <span className={`step-icon ${models.length > 0 ? 'success' : 'pending'}`}>
            {models.length > 0 ? '✓' : '○'}
          </span>
          <span className="step-name">commit-logs-...</span>
          <span className="step-time">{models.length > 0 ? '5s' : '-'}</span>
        </div>
      </div>

      {/* Job Summaries - one per model, always show all three */}
      {allModelsData.map((modelData, index) => (
        <JobSummary
          key={modelData.model || index}
          modelData={modelData}
          clusterId={cluster.id}
          timestamp={latestRun?.timestamp}
        />
      ))}
    </div>
  )
}

function JobSummary({ modelData, clusterId, timestamp }) {
  const [isOpen, setIsOpen] = useState(true)

  const shortName = getShortModelName(modelData.model)
  const jobTitle = `run-${shortName}-${clusterId} summary`
  const hasResults = modelData.results && modelData.results.length > 0

  return (
    <div className="job-section">
      <div
        className={`job-header ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className={`job-expand ${isOpen ? 'open' : ''}`}>▶</span>
        <span className="job-title">{jobTitle}</span>
      </div>

      {isOpen && (
        <div className="job-content">
          {hasResults ? (
            <>
              <div className="run-meta">
                <div className="run-timestamp">{timestamp || 'N/A'}</div>
                <div className="run-info">
                  <strong>Provider:</strong> {modelData.provider} | <strong>Model:</strong> {modelData.model}
                </div>
                <div className="run-info">
                  <strong>Model summary:</strong> cited targets in {modelData.cited_count}/{modelData.total_count} prompts
                </div>
              </div>

              <table className="results-table">
                <thead>
                  <tr>
                    <th>Prompt</th>
                    <th>Target URL</th>
                    <th>Status</th>
                    <th>Rank</th>
                    <th>Other cited URLs</th>
                  </tr>
                </thead>
                <tbody>
                  {modelData.results.map((result, idx) => (
                    <ResultRow key={idx} result={result} />
                  ))}
                </tbody>
              </table>

              <div className="job-summary-link">
                <a href="#">Job summary generated at run-time</a>
              </div>
            </>
          ) : (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p>No runs available yet. Click "Run All Models" to start.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ResultRow({ result }) {
  const cited = result.cited
  const targetUrls = result.target_urls || []  // For Target URL column
  const citedUrls = result.cited_urls || []  // For Status column
  const otherUrls = result.other_urls || []
  const ranks = result.ranks || []

  return (
    <tr className={cited ? 'row-cited' : ''}>
      <td className="col-prompt">{result.prompt}</td>
      <td className="col-target">
        {targetUrls.length > 0 ? (
          targetUrls.map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noopener noreferrer">
              {url}
            </a>
          ))
        ) : null}
      </td>
      <td className="col-status">
        {cited && citedUrls.length > 0 ? (
          <span className="status-cited">
            cited URL(s): {citedUrls.map((url, i) => (
              <span key={i}>
                {i > 0 && ', '}
                <a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
              </span>
            ))}
          </span>
        ) : (
          <span className="status-not-cited">no target URLs cited</span>
        )}
      </td>
      <td className="col-rank">
        {ranks && ranks.length > 0 ? (
          <span className="rank-value">{ranks.join(', ')}</span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        )}
      </td>
      <td className="col-other">
        {otherUrls.length > 0 ? (
          otherUrls.map((url, i) => (
            <a key={i} href={url.startsWith('http') ? url : `https://${url}`} target="_blank" rel="noopener noreferrer">
              {url.startsWith('http') ? url : `https://${url}`}
            </a>
          ))
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        )}
      </td>
    </tr>
  )
}

function getShortModelName(model) {
  if (!model) return 'unknown'
  if (model.includes('gpt')) return 'gpt-oss'
  if (model.includes('claude')) return 'claude-haiku'
  if (model.includes('perplexity') || model.includes('sonar')) return 'perplexity-sonar'
  return model.split('/').pop()?.split(':')[0] || model
}

// Need React for fragments
import React from 'react'
