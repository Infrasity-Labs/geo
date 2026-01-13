import { useState, useEffect, useCallback } from 'react'

const API_BASE = '/api'

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark')
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])
  return { theme, toggleTheme: () => setTheme(t => t === 'dark' ? 'light' : 'dark') }
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
      if (res.ok) setClusters((await res.json()).clusters || [])
    } catch (err) {
      console.error('Failed to fetch clusters:', err)
    }
    setLoading(false)
  }, [])

  const fetchClusterDetail = useCallback(async (clusterId) => {
    try {
      const res = await fetch(`${API_BASE}/clusters/${clusterId}`)
      if (res.ok) setClusterDetail(await res.json())
    } catch (err) {
      console.error('Failed to fetch cluster detail:', err)
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
            <div className="logo-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20V10M18 20V4M6 20v-4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="logo-text">
              <h1>Prompt Tracker</h1>
              <p>Monitor citation performance across AI models</p>
            </div>
          </div>
          <div className="header-actions">
            <button className="icon-btn" onClick={fetchClusters}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
              Refresh
            </button>
            <button className="icon-btn" onClick={toggleTheme}>
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          </div>
        </div>
        <div className="sidebar-nav">
          <h3 className="nav-label">SERVICE VERTICALS</h3>
          <nav className="nav-list">
            <button className={`nav-item ${!selectedCluster ? 'active' : ''}`} onClick={() => setSelectedCluster(null)}>
              <span>📊</span>
              <div className="nav-text">
                <span className="nav-name">All Clusters</span>
                <span className="nav-meta">{totalPrompts} prompts</span>
              </div>
            </button>
            {clusters.map(c => (
              <button key={c.id} className={`nav-item ${selectedCluster === c.id ? 'active' : ''}`} onClick={() => setSelectedCluster(c.id)}>
                <span>📁</span>
                <div className="nav-text">
                  <span className="nav-name">{c.name}</span>
                  <span className="nav-meta">{c.prompt_count} prompts · <span className="rate">{c.citation_rate}%</span></span>
                </div>
              </button>
            ))}
          </nav>
        </div>
      </aside>

      <main className="main-content">
        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : selectedCluster && clusterDetail ? (
          <ClusterView detail={clusterDetail} onBack={() => setSelectedCluster(null)} />
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
      <header className="page-header">
        <div>
          <h2>Overview</h2>
          <p>Monitor citation performance across all service verticals</p>
        </div>
        <div className="header-buttons">
          <button className="btn btn-outline">+ Add Prompt</button>
          <button className="btn btn-primary">Run All</button>
        </div>
      </header>
      <div className="clusters-list">
        {clusters.map(c => (
          <button key={c.id} className="cluster-row" onClick={() => onSelect(c.id)}>
            <span>📁</span>
            <span className="cluster-name">{c.name}</span>
            <span className="cluster-desc">{c.description}</span>
            <span className="cluster-prompts">{c.prompt_count} prompts</span>
            <span className="cluster-rate">{c.citation_rate}%</span>
            <span>→</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function ClusterView({ detail, onBack }) {
  const cluster = detail?.cluster
  const prompts = detail?.prompts || []
  const latestRun = detail?.latest_run
  const models = latestRun?.models || []
  
  if (!cluster) return null

  const clusterSlug = cluster.id

  return (
    <div className="cluster-view">
      <header className="cluster-header">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <div className="header-buttons">
          <button className="btn btn-outline">+ Add Prompt</button>
          <button className="btn btn-primary">Run All Models</button>
        </div>
      </header>

      <div className="cluster-title">
        <span style={{ fontSize: 32 }}>📁</span>
        <div>
          <h2>{cluster.name}</h2>
          <p>{cluster.description}</p>
        </div>
      </div>

      {/* Pipeline - like GitHub Actions */}
      <div className="pipeline">
        <PipelineStep name={`run-gpt-oss-${clusterSlug}`} time="2m 28s" status="done" />
        <span className="pipeline-connector">---</span>
        <PipelineStep name={`run-claude-haiku-${clusterSlug}`} time="20s" status="done" />
        <span className="pipeline-connector">---</span>
        <PipelineStep name={`run-perplexity-sonar-${clusterSlug}`} time="19s" status="done" />
        <span className="pipeline-connector">---</span>
        <PipelineStep name={`commit-logs-${clusterSlug}`} time="4s" status="done" />
      </div>

      {/* Model Summaries - Collapsible sections like GitHub Actions */}
      <div className="model-summaries">
        {models.length > 0 ? (
          models.map((modelData, index) => (
            <ModelSummary 
              key={modelData.model || index} 
              modelData={modelData} 
              clusterSlug={clusterSlug}
              timestamp={latestRun?.timestamp}
            />
          ))
        ) : (
          // Show placeholder when no runs
          <>
            <ModelSummaryPlaceholder name={`run-gpt-oss-${clusterSlug}`} prompts={prompts} />
            <ModelSummaryPlaceholder name={`run-claude-haiku-${clusterSlug}`} prompts={prompts} />
            <ModelSummaryPlaceholder name={`run-perplexity-sonar-${clusterSlug}`} prompts={prompts} />
          </>
        )}
      </div>
    </div>
  )
}

function PipelineStep({ name, time, status }) {
  return (
    <div className="pipeline-step">
      <span className={`step-status ${status}`}>
        {status === 'done' ? '✓' : status === 'running' ? '⟳' : '○'}
      </span>
      <span className="step-name">{name}</span>
      <span className="step-time">⏱ {time}</span>
    </div>
  )
}

function ModelSummary({ modelData, clusterSlug, timestamp }) {
  const [isOpen, setIsOpen] = useState(false)
  
  const modelName = modelData.model || 'unknown'
  const shortName = modelName.includes('gpt') ? 'gpt-oss' : 
                    modelName.includes('claude') ? 'claude-haiku' : 
                    modelName.includes('perplexity') ? 'perplexity-sonar' : modelName
  
  const summaryName = `run-${shortName}-${clusterSlug} summary`

  return (
    <div className="model-section">
      <div 
        className="model-header"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span>{summaryName}</span>
        <span className="expand-icon">{isOpen ? '▲' : '▼'}</span>
      </div>
      
      {isOpen && (
        <div className="model-content">
          <div className="run-meta">
            <h3 className="run-timestamp">{timestamp || 'N/A'}</h3>
            <p className="run-provider">
              <strong>Provider:</strong> {modelData.provider} | <strong>Model:</strong> {modelData.model}
            </p>
            <p className="run-summary">
              <strong>Model summary:</strong> cited targets in {modelData.cited_count}/{modelData.total_count} prompts
            </p>
          </div>

          <table className="results-table">
            <thead>
              <tr>
                <th>Prompt</th>
                <th>Target URL</th>
                <th>Status</th>
                <th>Other cited URLs</th>
              </tr>
            </thead>
            <tbody>
              {(modelData.results || []).map((result, idx) => (
                <ResultRow key={idx} result={result} />
              ))}
              {(!modelData.results || modelData.results.length === 0) && (
                <tr>
                  <td colSpan="4" className="empty-cell">No results available</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ModelSummaryPlaceholder({ name, prompts }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="model-section">
      <div 
        className="model-header"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span>{name} summary</span>
        <span className="expand-icon">{isOpen ? '▲' : '▼'}</span>
      </div>
      
      {isOpen && (
        <div className="model-content">
          <div className="run-meta">
            <p className="run-summary">No runs available yet. Click "Run All Models" to start.</p>
          </div>

          <table className="results-table">
            <thead>
              <tr>
                <th>Prompt</th>
                <th>Target URL</th>
                <th>Status</th>
                <th>Other cited URLs</th>
              </tr>
            </thead>
            <tbody>
              {prompts.slice(0, 5).map((prompt, idx) => (
                <tr key={idx}>
                  <td>{prompt}</td>
                  <td>—</td>
                  <td className="status-pending">pending</td>
                  <td>—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ResultRow({ result }) {
  const cited = result.cited
  const citedUrls = result.cited_urls || []
  const otherUrls = result.other_urls || []
  
  return (
    <tr className={cited ? 'row-cited' : ''}>
      <td className="col-prompt">{result.prompt}</td>
      <td className="col-target">
        {citedUrls.length > 0 ? (
          <a href={citedUrls[0]} target="_blank" rel="noopener noreferrer">
            {citedUrls[0]}
          </a>
        ) : ''}
      </td>
      <td className="col-status">
        {cited ? (
          <div>
            <span className="status-cited">cited URL(s): </span>
            {citedUrls.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="cited-link">
                {url}
              </a>
            ))}
            {result.rank && <span className="rank-info">rank(s): {result.rank}</span>}
          </div>
        ) : (
          <span className="status-not-cited">no target URLs cited</span>
        )}
      </td>
      <td className="col-other">
        {otherUrls.length > 0 ? (
          <div className="other-urls-list">
            {otherUrls.map((url, i) => (
              <a key={i} href={url.startsWith('http') ? url : `https://${url}`} target="_blank" rel="noopener noreferrer">
                {url}
              </a>
            ))}
          </div>
        ) : '—'}
      </td>
    </tr>
  )
}
