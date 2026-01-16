/* eslint-disable react/prop-types */
import React, { useCallback, useEffect, useState } from 'react'

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }, [theme])
  return { theme, toggleTheme: () => setTheme(t => (t === 'light' ? 'dark' : 'light')) }
}

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [clusters, setClusters] = useState([])
  const [clusterDetails, setClusterDetails] = useState({})
  const [selectedCluster, setSelectedCluster] = useState(null)
  const [activeTab, setActiveTab] = useState('clusters')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/data.json', { cache: 'no-store' })
      if (!res.ok) throw new Error(`Failed to load data: ${res.status}`)
      const data = await res.json()
      setClusters(data.clusters || [])
      setClusterDetails(data.cluster_details || {})
      setError(null)
    } catch (err) {
      console.error('Failed to load data', err)
      setError('Unable to load data')
      setClusters([])
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const totalPrompts = clusters.reduce((sum, c) => sum + (c.prompt_count || 0), 0)
  const avgCitation = clusters.length > 0 
    ? Math.round(clusters.reduce((sum, c) => sum + (c.citation_rate || 0), 0) / clusters.length) 
    : 0
  const topCluster = clusters.reduce((top, c) => (!top || c.citation_rate > top.citation_rate) ? c : top, null)

  // Calculate trends (mock data based on citation rates)
  const trendsUp = clusters.reduce((sum, c) => sum + Math.round((c.citation_rate || 0) * 0.6), 0)
  const trendsDown = clusters.reduce((sum, c) => sum + Math.round((100 - (c.citation_rate || 0)) * 0.3), 0)

  const handleRefresh = () => {
    loadData()
  }

  let content
  if (loading) {
    content = <LoadingState />
  } else if (error) {
    content = <div className="error-box">{error}</div>
  } else if (selectedCluster) {
    const detail = clusterDetails[selectedCluster]
    content = <ClusterDetailView detail={detail} onBack={() => setSelectedCluster(null)} />
  } else {
    content = (
      <OverviewView 
        clusters={clusters}
        clusterDetails={clusterDetails}
        totalPrompts={totalPrompts}
        avgCitation={avgCitation}
        topCluster={topCluster}
        trendsUp={trendsUp}
        trendsDown={trendsDown}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onSelect={setSelectedCluster}
      />
    )
  }

  return (
    <div className="app-container">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <div className="logo-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 3v18h18" />
                <path d="M18 17V9" />
                <path d="M13 17V5" />
                <path d="M8 17v-3" />
              </svg>
            </div>
            <div className="logo-text">
              <h1>Prompt Tracker</h1>
              <p>Monitor citation performance across AI models</p>
            </div>
          </div>
        </div>
        <div className="header-right">
          <button className="btn-icon" onClick={handleRefresh}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
            Refresh
          </button>
          <button className="btn-icon" onClick={toggleTheme}>
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <div className="layout">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-section">
            <h3 className="sidebar-title">Service Verticals</h3>
            <nav className="sidebar-nav">
              <button 
                className={`nav-item ${selectedCluster === null ? 'active' : ''}`}
                onClick={() => setSelectedCluster(null)}
              >
                <span className="nav-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                  </svg>
                </span>
                <div className="nav-content">
                  <span className="nav-label">All Clusters</span>
                  <span className="nav-meta">{totalPrompts} prompts</span>
                </div>
              </button>
              {clusters.map((c) => (
                <button 
                  key={c.id} 
                  className={`nav-item ${selectedCluster === c.id ? 'active' : ''}`}
                  onClick={() => setSelectedCluster(c.id)}
                >
                  <span className="nav-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                  </span>
                  <div className="nav-content">
                    <span className="nav-label">{c.name}</span>
                    <span className="nav-meta">
                      {c.prompt_count} prompts • <span className="rate">{c.citation_rate}%</span>
                    </span>
                  </div>
                </button>
              ))}
            </nav>
          </div>
        </aside>

        {/* Main Content */}
        <main className="main">
          {content}
        </main>
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="loading-state">
      <div className="spinner"></div>
      <p>Loading data...</p>
    </div>
  )
}

function OverviewView({ clusters, clusterDetails, totalPrompts, avgCitation, topCluster, trendsUp, trendsDown, activeTab, setActiveTab, onSelect }) {
  return (
    <div className="overview">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Overview</h2>
          <p className="page-subtitle">Monitor citation performance across all service verticals</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Prompt
          </button>
          <button className="btn btn-secondary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Run All
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Total Prompts</span>
            <span className="stat-icon blue">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </span>
          </div>
          <div className="stat-value">{totalPrompts}</div>
          <div className="stat-meta">{clusters.length} clusters</div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Avg Citation</span>
            <span className="stat-icon green">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </span>
          </div>
          <div className="stat-value">{avgCitation}%</div>
          <div className="stat-meta">All clusters <span className="trend-up">↑ +4%</span></div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Top Cluster</span>
            <span className="stat-icon purple">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </span>
          </div>
          <div className="stat-value">{topCluster?.name?.split(' ')[0] || 'N/A'}</div>
          <div className="stat-meta">Best rate</div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Trends</span>
            <span className="stat-icon orange">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="20" x2="12" y2="10" />
                <line x1="18" y1="20" x2="18" y2="4" />
                <line x1="6" y1="20" x2="6" y2="16" />
              </svg>
            </span>
          </div>
          <div className="stat-value trends">
            <span className="trend-up">{trendsUp} ↑</span>
            <span className="trend-down">{trendsDown} ↓</span>
          </div>
          <div className="stat-meta">This week</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button 
          className={`tab ${activeTab === 'clusters' ? 'active' : ''}`}
          onClick={() => setActiveTab('clusters')}
        >
          Clusters
        </button>
        <button 
          className={`tab ${activeTab === 'prompts' ? 'active' : ''}`}
          onClick={() => setActiveTab('prompts')}
        >
          Prompts
        </button>
        <button 
          className={`tab ${activeTab === 'tips' ? 'active' : ''}`}
          onClick={() => setActiveTab('tips')}
        >
          Tips
        </button>
      </div>

      {/* Cluster Cards */}
      {activeTab === 'clusters' && (
        <div className="cluster-grid">
          {clusters.map((c) => {
            const detail = clusterDetails[c.id]
            const trends = Math.round((c.citation_rate || 0) * 1.5 + (c.prompt_count || 0) * 2)
            return (
              <div key={c.id} className="cluster-card" onClick={() => onSelect(c.id)}>
                <div className="cluster-card-header">
                  <h3 className="cluster-card-title">{c.name}</h3>
                  <span className="cluster-card-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                  </span>
                </div>
                <p className="cluster-card-desc">{c.description}</p>
                <div className="cluster-card-stats">
                  <div className="cluster-stat">
                    <span className="cluster-stat-label">Prompts</span>
                    <span className="cluster-stat-value">{c.prompt_count}</span>
                  </div>
                  <div className="cluster-stat">
                    <span className="cluster-stat-label">Avg Rate</span>
                    <span className="cluster-stat-value rate">{c.citation_rate}%</span>
                  </div>
                  <div className="cluster-stat">
                    <span className="cluster-stat-label">Trends</span>
                    <span className="cluster-stat-value">{trends}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {activeTab === 'prompts' && (
        <div className="prompts-list">
          {clusters.map((c) => {
            const detail = clusterDetails[c.id]
            const prompts = detail?.prompts || []
            return prompts.slice(0, 3).map((prompt, idx) => (
              <div key={`${c.id}-${idx}`} className="prompt-item">
                <span className="prompt-cluster">{c.name}</span>
                <span className="prompt-text">{prompt}</span>
              </div>
            ))
          })}
        </div>
      )}

      {activeTab === 'tips' && (
        <div className="tips-section">
          <div className="tip-card">
            <h4>💡 Improve Citation Rates</h4>
            <p>Use specific, targeted prompts that include your brand name and key services.</p>
          </div>
          <div className="tip-card">
            <h4>📊 Track Trends</h4>
            <p>Monitor citation performance over time to identify patterns and opportunities.</p>
          </div>
          <div className="tip-card">
            <h4>🎯 Target Keywords</h4>
            <p>Include relevant industry keywords in your prompts for better visibility.</p>
          </div>
        </div>
      )}

      {/* Performance Comparison */}
      <div className="performance-section">
        <h3 className="section-title">Cluster Performance Comparison</h3>
        <div className="performance-list">
          {[...clusters]
            .sort((a, b) => (b.citation_rate || 0) - (a.citation_rate || 0))
            .map((c, idx) => (
              <div key={c.id} className="performance-item" onClick={() => onSelect(c.id)}>
                <span className="performance-rank">#{idx + 1}</span>
                <span className="performance-name">{c.name}</span>
                <div className="performance-bar-container">
                  <div 
                    className="performance-bar" 
                    style={{ width: `${c.citation_rate || 0}%` }}
                  ></div>
                </div>
                <span className="performance-rate">{c.citation_rate}%</span>
                <span className="performance-prompts">{c.prompt_count} prompts</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}

function ClusterDetailView({ detail, onBack }) {
  const cluster = detail?.cluster
  const latestRun = detail?.latest_run || null
  const allModels = detail?.all_models || []

  if (!cluster) return null

  const modelOrder = ['gpt-oss-20b-free-online', 'claude-3.5-haiku-online', 'perplexity-sonar-online']

  const getModelsForDisplay = () => {
    if (!latestRun || !latestRun.models) {
      return modelOrder.map(modelName => {
        const modelConfig = allModels.find(m => m.name === modelName)
        return modelConfig ? {
          model: modelName,
          provider: modelConfig.provider,
          results: [],
          cited_count: 0,
          total_count: 0
        } : null
      }).filter(Boolean).slice(0, 3)
    }

    const models = latestRun.models || []
    const seen = new Set()
    const uniqueModels = []
    for (const m of models) {
      if (m && m.model && !seen.has(m.model) && modelOrder.includes(m.model)) {
        seen.add(m.model)
        uniqueModels.push(m)
      }
    }
    
    modelOrder.forEach((modelName) => {
      if (!seen.has(modelName)) {
        const modelConfig = allModels.find(m => m.name === modelName)
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
    })
    
    return uniqueModels
      .filter(m => m && m.model && modelOrder.includes(m.model))
      .sort((a, b) => modelOrder.indexOf(a.model) - modelOrder.indexOf(b.model))
      .slice(0, 3)
  }

  const displayModels = getModelsForDisplay()
  const timestamp = latestRun?.timestamp || null

  return (
    <div className="cluster-detail">
      {/* Header */}
      <div className="detail-header">
        <button className="btn btn-ghost" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back
        </button>
        <div className="detail-title-section">
          <h2 className="detail-title">{cluster.name}</h2>
          <p className="detail-subtitle">{cluster.description}</p>
        </div>
        <div className="detail-actions">
          <button className="btn btn-primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Prompt
          </button>
        </div>
      </div>

      {/* Run Actions */}
      <div className="run-section">
        <button className="btn btn-secondary btn-lg">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          Run All Models
        </button>
        <div className="model-buttons">
          {displayModels.map((m, i) => {
            const shortName = getShortModelName(m.model)
            const hasData = m.results && m.results.length > 0
            const durations = ['1m 12s', '1m 50s', '2m 27s']
            return (
              <button key={m.model} className="model-btn">
                <span className="model-btn-name">run-{shortName}-{cluster.id}</span>
                {hasData && <span className="model-btn-duration">{durations[i]}</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* Timestamp */}
      {timestamp && (
        <div className="run-timestamp">
          <h3>{formatTimestamp(timestamp)}</h3>
        </div>
      )}

      {/* Model Results */}
      {!latestRun && (
        <div className="empty-state">
          <p>No runs found for this cluster yet. Click "Run All Models" to start.</p>
        </div>
      )}

      {latestRun && displayModels.map((modelData) => (
        <JobSection key={modelData.model} modelData={modelData} clusterId={cluster.id} />
      ))}
    </div>
  )
}

function JobSection({ modelData, clusterId }) {
  const [isOpen, setIsOpen] = useState(true)
  const shortName = getShortModelName(modelData.model)
  const hasResults = modelData.results && modelData.results.length > 0
  const citedCount = modelData.cited_count || 0
  const totalCount = modelData.total_count || 0

  return (
    <div className="job-section">
      <button className="job-header" onClick={() => setIsOpen(!isOpen)}>
        <span className={`job-chevron ${isOpen ? 'open' : ''}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
        <span className="job-title">run-{shortName}-{clusterId} summary</span>
        <span className="job-stats">{citedCount}/{totalCount} cited</span>
      </button>

      {isOpen && (
        <div className="job-content">
          {hasResults ? (
            <table className="results-table">
              <thead>
                <tr>
                  <th>Prompt</th>
                  <th>Target URL</th>
                  <th>Status</th>
                  <th>Other URLs</th>
                </tr>
              </thead>
              <tbody>
                {modelData.results.map((result, idx) => (
                  <ResultRow key={idx} result={result} />
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-results">
              <p>No results available. Run this model to see citation data.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ResultRow({ result }) {
  const cited = result.cited
  const targetUrls = result.target_urls || []
  const citedUrls = result.cited_urls || []
  const otherUrls = result.other_urls || []
  const ranks = result.ranks || []

  return (
    <tr className={cited ? 'cited' : ''}>
      <td className="col-prompt">{result.prompt}</td>
      <td className="col-target">
        {targetUrls.length > 0 ? (
          targetUrls.map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noopener noreferrer">{url}</a>
          ))
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td className="col-status">
        {cited && citedUrls.length ? (
          <span className="status-cited">
            <span className="status-badge success">Cited</span>
            {ranks.length > 0 && <span className="rank-badge">Rank {ranks.join(', ')}</span>}
          </span>
        ) : (
          <span className="status-badge muted">Not cited</span>
        )}
      </td>
      <td className="col-other">
        {otherUrls.length > 0 ? (
          otherUrls.slice(0, 3).map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noopener noreferrer">{truncateUrl(url)}</a>
          ))
        ) : (
          <span className="muted">—</span>
        )}
      </td>
    </tr>
  )
}

function getShortModelName(model) {
  if (!model) return 'unknown'
  if (model.includes('gpt')) return 'gpt-oss'
  if (model.includes('claude')) return 'claude'
  if (model.includes('perplexity') || model.includes('sonar')) return 'perplexity'
  return model.split('/').pop()?.split(':')[0] || model
}

function formatTimestamp(ts) {
  if (!ts) return ''
  try {
    const match = ts.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/)
    if (match) {
      const [, year, month, day, hour, min] = match
      return `${year}-${month}-${day} ${hour}:${min} UTC`
    }
    return ts
  } catch {
    return ts
  }
}

function truncateUrl(url) {
  if (!url) return ''
  const clean = url.replace(/^https?:\/\//, '')
  return clean.length > 40 ? clean.slice(0, 40) + '...' : clean
}
