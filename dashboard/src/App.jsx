/* eslint-disable react/prop-types */
import React, { useCallback, useEffect, useState } from 'react'

export default function App() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [clusters, setClusters] = useState([])
  const [clusterDetails, setClusterDetails] = useState({})
  const [selectedCluster, setSelectedCluster] = useState(null)
  const [activeTab, setActiveTab] = useState('clusters')
  const [showAddPrompt, setShowAddPrompt] = useState(false)

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
  const trendsUp = clusters.reduce((sum, c) => sum + Math.round((c.citation_rate || 0) * 0.6), 0)
  const trendsDown = clusters.reduce((sum, c) => sum + Math.round((100 - (c.citation_rate || 0)) * 0.3), 0)

  let content
  if (loading) {
    content = <LoadingState />
  } else if (error) {
    content = <div className="empty-state">{error}</div>
  } else if (selectedCluster) {
    const detail = clusterDetails[selectedCluster]
    content = (
      <ClusterDetailView 
        detail={detail} 
        onBack={() => setSelectedCluster(null)} 
        onAddPrompt={() => setShowAddPrompt(true)}
      />
    )
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
        onAddPrompt={() => setShowAddPrompt(true)}
      />
    )
  }

  return (
    <div className="app-container">
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <div className="logo-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
          <button className="header-btn" onClick={loadData}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
            Refresh
          </button>
          <button className="header-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <div className="sidebar-title">SERVICE VERTICALS</div>
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
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  </svg>
                </span>
                <div className="nav-content">
                  <span className="nav-label">{c.name}</span>
                  <span className="nav-meta">
                    {c.prompt_count} prompts • <span className="rate">{c.citation_rate}%</span>
                  </span>
                </div>
                <div className="nav-models">
                  <ModelLogo model="gpt" size={14} />
                  <ModelLogo model="claude" size={14} />
                  <ModelLogo model="perplexity" size={14} />
                </div>
              </button>
            ))}
          </nav>
        </aside>

        <main className="main">
          {content}
        </main>
      </div>

      {showAddPrompt && (
        <AddPromptModal 
          clusters={clusters}
          selectedCluster={selectedCluster}
          onClose={() => setShowAddPrompt(false)}
          onSubmit={(data) => {
            console.log('Adding prompt:', data)
            setShowAddPrompt(false)
          }}
        />
      )}
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

function OverviewView({ clusters, clusterDetails, totalPrompts, avgCitation, topCluster, trendsUp, trendsDown, activeTab, setActiveTab, onSelect, onAddPrompt }) {
  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3v18h18" />
              <path d="M18 17V9" />
              <path d="M13 17V5" />
              <path d="M8 17v-3" />
            </svg>
          </div>
          <div>
            <h1 className="page-title">Overview</h1>
            <p className="page-subtitle">Monitor citation performance across all service verticals</p>
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={onAddPrompt}>
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

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Total Prompts</span>
            <span className="stat-icon blue">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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

      <div className="tabs">
        <button className={`tab ${activeTab === 'clusters' ? 'active' : ''}`} onClick={() => setActiveTab('clusters')}>
          Clusters
        </button>
        <button className={`tab ${activeTab === 'prompts' ? 'active' : ''}`} onClick={() => setActiveTab('prompts')}>
          Prompts
        </button>
        <button className={`tab ${activeTab === 'tips' ? 'active' : ''}`} onClick={() => setActiveTab('tips')}>
          Tips
        </button>
      </div>

      {activeTab === 'clusters' && (
        <div className="cluster-grid">
          {clusters.map((c) => {
            const trends = Math.round((c.citation_rate || 0) * 1.5 + (c.prompt_count || 0) * 2)
            return (
              <div key={c.id} className="cluster-card" onClick={() => onSelect(c.id)}>
                <div className="cluster-card-header">
                  <h3 className="cluster-card-title">{c.name}</h3>
                  <span className="cluster-card-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
                  <div className="performance-bar" style={{ width: `${c.citation_rate || 0}%` }}></div>
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

function ClusterDetailView({ detail, onBack, onAddPrompt }) {
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
      }).filter(Boolean)
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
  }

  const displayModels = getModelsForDisplay()
  const timestamp = latestRun?.timestamp || null

  return (
    <div>
      <button className="back-btn" onClick={onBack}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
        Back
      </button>

      <div className="page-header">
        <div className="page-header-left">
          <div className="page-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            </svg>
          </div>
          <div>
            <h1 className="page-title">{cluster.name}</h1>
            <p className="page-subtitle">{cluster.description}</p>
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={onAddPrompt}>
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
            Run All Models
          </button>
        </div>
      </div>

      {/* Pipeline */}
      <div className="pipeline">
        {displayModels.map((m, i) => {
          const shortName = getShortModelName(m.model)
          const hasData = m.results && m.results.length > 0
          const durations = ['2m 15s', '2m 27s', '1m 8s']
          return (
            <React.Fragment key={m.model}>
              <div className={`pipeline-step ${i === 0 ? 'active' : ''}`}>
                <ModelLogo model={m.model} />
                <span className="step-name">run-{shortName}-{cluster.id}</span>
                {hasData && <span className="step-time">⏱ {durations[i]}</span>}
              </div>
              {i < displayModels.length - 1 && <div className="pipeline-connector"></div>}
            </React.Fragment>
          )
        })}
      </div>

      {/* Model Results */}
      {!latestRun && (
        <div className="empty-state">
          <p>No runs found for this cluster yet. Click "Run All Models" to start.</p>
        </div>
      )}

      {latestRun && displayModels.map((modelData) => (
        <JobSection 
          key={modelData.model} 
          modelData={modelData} 
          clusterId={cluster.id}
          timestamp={timestamp}
        />
      ))}
    </div>
  )
}

function JobSection({ modelData, clusterId, timestamp }) {
  const [isOpen, setIsOpen] = useState(true)
  const displayName = getModelDisplayName(modelData.model)
  const hasResults = modelData.results && modelData.results.length > 0
  const citedCount = modelData.cited_count || 0
  const totalCount = modelData.total_count || 0

  return (
    <div className="job-section">
      <button className="job-header" onClick={() => setIsOpen(!isOpen)}>
        <div className="job-header-left">
          <ModelLogo model={modelData.model} size={20} />
          <span className="job-title">{displayName} Summary</span>
        </div>
        <span className={`job-chevron ${isOpen ? 'open' : ''}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {isOpen && (
        <div className="job-content">
          {hasResults ? (
            <>
              <div className="run-info">
                <div className="run-summary">
                  Cited targets in {citedCount}/{totalCount} prompts
                </div>
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
                  {modelData.results.map((result, idx) => (
                    <ResultRow key={idx} result={result} />
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="empty-state">
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
    <tr>
      <td className="col-prompt">{result.prompt}</td>
      <td className="col-target">
        {targetUrls.length > 0 ? (
          targetUrls.map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noopener noreferrer">
              {getDomain(url)}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          ))
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        )}
      </td>
      <td className="col-status">
        {cited && citedUrls.length ? (
          <div className="status-cited">
            <div>cited URL(s):</div>
            {citedUrls.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer">{getDomain(url)}</a>
            ))}
            {ranks.length > 0 && <div className="status-rank">rank(s): <span className="rank-numbers">{ranks.join(', ')}</span></div>}
          </div>
        ) : (
          <span className="status-not-cited">no target URLs cited</span>
        )}
      </td>
      <td className="col-other">
        {otherUrls.length > 0 ? (
          otherUrls.slice(0, 3).map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noopener noreferrer">{getDomain(url)}</a>
          ))
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        )}
      </td>
    </tr>
  )
}

function AddPromptModal({ clusters, selectedCluster, onClose, onSubmit }) {
  const [prompt, setPrompt] = useState('')
  const [cluster, setCluster] = useState(selectedCluster || (clusters[0]?.id || ''))
  const [targetUrl, setTargetUrl] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!prompt.trim()) return
    setIsSubmitting(true)
    await new Promise(resolve => setTimeout(resolve, 500))
    onSubmit({ prompt: prompt.trim(), cluster, targetUrl: targetUrl.trim() || null })
    setIsSubmitting(false)
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">Add New Prompt</h2>
          <button className="modal-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Prompt Text</label>
              <textarea
                className="form-textarea"
                placeholder="Enter your prompt text..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                autoFocus
              />
              <p className="form-hint">Enter the search query or prompt you want to track.</p>
            </div>
            <div className="form-group">
              <label className="form-label">Cluster</label>
              <select className="form-select" value={cluster} onChange={(e) => setCluster(e.target.value)}>
                {clusters.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Target URL <span className="form-optional">(optional)</span></label>
              <input
                type="url"
                className="form-input"
                placeholder="https://example.com/page"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!prompt.trim() || isSubmitting}>
              {isSubmitting ? <><span className="btn-spinner"></span> Adding...</> : 'Add Prompt'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Model Logo Component - Official logos
function ModelLogo({ model, size = 18 }) {
  if (!model) return <span className="status-dot"></span>
  
  // Perplexity AI official logo (geometric arrows/cross pattern)
  if (model.includes('perplexity') || model.includes('sonar')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="model-logo perplexity">
        <path d="M12 2L12 8M12 16L12 22" stroke="#1a7f7a" strokeWidth="2" strokeLinecap="round"/>
        <path d="M2 12L8 12M16 12L22 12" stroke="#1a7f7a" strokeWidth="2" strokeLinecap="round"/>
        <path d="M12 2L7 7M12 2L17 7" stroke="#1a7f7a" strokeWidth="2" strokeLinecap="round"/>
        <path d="M12 22L7 17M12 22L17 17" stroke="#1a7f7a" strokeWidth="2" strokeLinecap="round"/>
        <path d="M2 12L7 7M2 12L7 17" stroke="#1a7f7a" strokeWidth="2" strokeLinecap="round"/>
        <path d="M22 12L17 7M22 12L17 17" stroke="#1a7f7a" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    )
  }
  
  // Claude/Anthropic official logo (starburst/sparkle)
  if (model.includes('claude')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="model-logo claude">
        <path d="M12 2L12 22" stroke="#da7756" strokeWidth="2" strokeLinecap="round"/>
        <path d="M2 12L22 12" stroke="#da7756" strokeWidth="2" strokeLinecap="round"/>
        <path d="M4.93 4.93L19.07 19.07" stroke="#da7756" strokeWidth="2" strokeLinecap="round"/>
        <path d="M19.07 4.93L4.93 19.07" stroke="#da7756" strokeWidth="2" strokeLinecap="round"/>
        <path d="M12 5L12 19" stroke="#da7756" strokeWidth="2" strokeLinecap="round"/>
        <path d="M5 12L19 12" stroke="#da7756" strokeWidth="2" strokeLinecap="round"/>
        <path d="M7.05 7.05L16.95 16.95" stroke="#da7756" strokeWidth="2" strokeLinecap="round"/>
        <path d="M16.95 7.05L7.05 16.95" stroke="#da7756" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    )
  }
  
  // OpenAI/ChatGPT official logo (interlocking hexagonal knot)
  if (model.includes('gpt') || model.includes('openai')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="model-logo gpt">
        <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364l2.0201-1.1638a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.4043-.6813zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" fill="#10a37f"/>
      </svg>
    )
  }
  
  return <span className="status-dot"></span>
}

function getShortModelName(model) {
  if (!model) return 'unknown'
  if (model.includes('perplexity') || model.includes('sonar')) return 'perplexity'
  if (model.includes('claude')) return 'claude'
  if (model.includes('gpt')) return 'gpt'
  return model.split('/').pop()?.split(':')[0] || model
}

function getModelDisplayName(model) {
  if (!model) return 'Unknown'
  if (model.includes('perplexity') || model.includes('sonar')) return 'Perplexity'
  if (model.includes('claude')) return 'Claude'
  if (model.includes('gpt') || model.includes('openai')) return 'GPT'
  return model.split('/').pop()?.split(':')[0] || model
}

function formatTimestamp(ts) {
  if (!ts) return ''
  return ts
}

function getDomain(url) {
  if (!url) return ''
  try {
    const u = new URL(url)
    return u.hostname.replace('www.', '')
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0]
  }
}
