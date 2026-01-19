/* eslint-disable react/prop-types */
import React, { useCallback, useEffect, useState, useRef } from 'react'
import ReactDOM from 'react-dom'

export default function App() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [clusters, setClusters] = useState([])
  const [clusterDetails, setClusterDetails] = useState({})
  const [selectedCluster, setSelectedCluster] = useState(null)
  const [activeTab, setActiveTab] = useState('clusters')
  const [showAddPrompt, setShowAddPrompt] = useState(false)
  const [showAddCluster, setShowAddCluster] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null) // { id, name } or null

  const loadData = useCallback(async (refresh = false) => {
    setLoading(true)
    try {
      // Load clusters list from API
      const clustersRes = await fetch('/api/clusters', { cache: 'no-store' })
      if (!clustersRes.ok) throw new Error(`Failed to load clusters: ${clustersRes.status}`)
      const clustersData = await clustersRes.json()
      const clustersList = clustersData.clusters || []
      setClusters(clustersList)
      
      // Load details for each cluster from API
      const details = {}
      for (const cluster of clustersList) {
        try {
          const detailRes = await fetch(`/api/clusters/${cluster.id}`, { cache: 'no-store' })
          if (detailRes.ok) {
            const detailData = await detailRes.json()
            details[cluster.id] = detailData
          }
        } catch (e) {
          console.error(`Failed to load details for ${cluster.id}:`, e)
        }
      }
      setClusterDetails(details)
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
          <button className="header-btn" onClick={() => loadData(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
            Refresh
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
              <ClusterNavItem
                key={c.id}
                cluster={c}
                isActive={selectedCluster === c.id}
                onSelect={() => setSelectedCluster(c.id)}
                onDelete={() => setDeleteConfirm({ id: c.id, name: c.name })}
              />
            ))}
            <button 
              className="nav-item nav-item-add"
              onClick={() => setShowAddCluster(true)}
            >
              <span className="nav-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </span>
              <div className="nav-content">
                <span className="nav-label">Add Cluster</span>
              </div>
            </button>
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
          onSubmit={async (data) => {
            try {
              const res = await fetch('/api/prompts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: data.prompt, cluster_id: data.cluster })
              })
              if (!res.ok) {
                const err = await res.json()
                alert(err.detail || 'Failed to add prompt')
                return
              }
              setShowAddPrompt(false)
              // Wait a moment for the file to be written and data regenerated
              await new Promise(resolve => setTimeout(resolve, 1000))
              loadData(true) // Refresh data
            } catch (err) {
              console.error('Failed to add prompt:', err)
              alert('Failed to add prompt. Please try again.')
            }
          }}
        />
      )}

      {showAddCluster && (
        <AddClusterModal 
          onClose={() => setShowAddCluster(false)}
          onSubmit={async (data) => {
            try {
              const res = await fetch('/api/clusters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
              })
              if (!res.ok) {
                const err = await res.json()
                alert(err.detail || 'Failed to create cluster')
                return
              }
              setShowAddCluster(false)
              loadData(true) // Refresh data
            } catch (err) {
              console.error('Failed to create cluster:', err)
              alert('Failed to create cluster. Please try again.')
            }
          }}
        />
      )}

      {deleteConfirm && (
        <DeleteConfirmModal
          clusterName={deleteConfirm.name}
          onClose={() => setDeleteConfirm(null)}
          onConfirm={async () => {
            try {
              const res = await fetch(`/api/clusters/${deleteConfirm.id}`, { method: 'DELETE' })
              if (!res.ok) {
                const err = await res.json()
                alert(err.detail || 'Failed to delete cluster')
                return
              }
              if (selectedCluster === deleteConfirm.id) setSelectedCluster(null)
              setDeleteConfirm(null)
              loadData(true)
            } catch (err) {
              console.error('Failed to delete cluster:', err)
              alert('Failed to delete cluster. Please try again.')
            }
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

// Helper functions for analytics
function computeModelBreakdown(latestRun) {
  if (!latestRun || !latestRun.models) return []
  return latestRun.models.map(m => ({
    model: m.model,
    displayName: getModelDisplayName(m.model),
    citedCount: m.cited_count || 0,
    totalCount: m.total_count || 0,
    rate: m.total_count > 0 ? Math.round((m.cited_count / m.total_count) * 100) : 0
  }))
}

function computeRecentDrivers(runs) {
  if (!runs || runs.length < 2) return []
  
  const latest = runs[0]
  const previous = runs[1]
  const drivers = []
  
  if (!latest?.models || !previous?.models) return drivers
  
  // Compare each model
  for (const latestModel of latest.models) {
    const prevModel = previous.models.find(m => m.model === latestModel.model)
    if (!prevModel) continue
    
    const latestCited = latestModel.cited_count || 0
    const prevCited = prevModel.cited_count || 0
    const diff = latestCited - prevCited
    
    if (diff !== 0) {
      // Find which prompts changed
      for (const latestResult of (latestModel.results || [])) {
        const prevResult = (prevModel.results || []).find(r => 
          r.prompt?.toLowerCase() === latestResult.prompt?.toLowerCase()
        )
        
        if (latestResult.cited && (!prevResult || !prevResult.cited)) {
          drivers.push({
            type: 'gain',
            model: getModelDisplayName(latestModel.model),
            prompt: truncatePrompt(latestResult.prompt),
            rank: latestResult.ranks?.[0] || null
          })
        } else if (!latestResult.cited && prevResult?.cited) {
          drivers.push({
            type: 'loss',
            model: getModelDisplayName(latestModel.model),
            prompt: truncatePrompt(latestResult.prompt),
            rank: null
          })
        } else if (latestResult.cited && prevResult?.cited) {
          const latestRank = latestResult.ranks?.[0]
          const prevRank = prevResult.ranks?.[0]
          if (latestRank && prevRank && latestRank !== prevRank) {
            drivers.push({
              type: latestRank < prevRank ? 'rank_up' : 'rank_down',
              model: getModelDisplayName(latestModel.model),
              prompt: truncatePrompt(latestResult.prompt),
              rankChange: `${prevRank} → ${latestRank}`
            })
          }
        }
      }
    }
  }
  
  return drivers.slice(0, 5)
}

function computeVolatility(runs) {
  if (!runs || runs.length < 3) return { level: 'unknown', label: 'Insufficient data' }
  
  let changes = 0
  const recentRuns = runs.slice(0, 5)
  
  for (let i = 0; i < recentRuns.length - 1; i++) {
    const current = recentRuns[i]
    const prev = recentRuns[i + 1]
    
    if (!current?.models || !prev?.models) continue
    
    for (const currentModel of current.models) {
      const prevModel = prev.models.find(m => m.model === currentModel.model)
      if (!prevModel) continue
      
      const currentCited = currentModel.cited_count || 0
      const prevCited = prevModel.cited_count || 0
      if (currentCited !== prevCited) changes++
    }
  }
  
  const avgChanges = changes / Math.max(recentRuns.length - 1, 1)
  
  if (avgChanges < 1) return { level: 'stable', label: 'Stable', color: 'var(--green)' }
  if (avgChanges < 2) return { level: 'medium', label: 'Medium volatility', color: 'var(--yellow)' }
  return { level: 'fragile', label: 'Fragile', color: 'var(--red)' }
}

function computeTopDisplacers(latestRun) {
  if (!latestRun || !latestRun.models) return []
  
  const competitorCounts = {}
  
  for (const model of latestRun.models) {
    for (const result of (model.results || [])) {
      if (!result.cited && result.other_urls?.length > 0) {
        for (const url of result.other_urls) {
          const domain = getDomain(url)
          if (domain && !domain.includes('infrasity')) {
            competitorCounts[domain] = (competitorCounts[domain] || 0) + 1
          }
        }
      }
    }
  }
  
  return Object.entries(competitorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([domain, count]) => ({ domain, count }))
}

function truncatePrompt(prompt, maxLen = 50) {
  if (!prompt) return ''
  if (prompt.length <= maxLen) return prompt
  return prompt.substring(0, maxLen) + '...'
}

function OverviewView({ clusters, clusterDetails, totalPrompts, avgCitation, activeTab, setActiveTab, onSelect, onAddPrompt }) {
  // Compute aggregate stats from all clusters
  const allModelBreakdowns = []
  const allDisplacers = []
  
  for (const cluster of clusters) {
    const detail = clusterDetails[cluster.id]
    if (detail?.latest_run) {
      const breakdown = computeModelBreakdown(detail.latest_run)
      allModelBreakdowns.push(...breakdown)
      const displacers = computeTopDisplacers(detail.latest_run)
      allDisplacers.push(...displacers)
    }
  }
  
  // Aggregate model stats
  const modelStats = {}
  for (const b of allModelBreakdowns) {
    if (!modelStats[b.model]) {
      modelStats[b.model] = { model: b.model, displayName: b.displayName, cited: 0, total: 0 }
    }
    modelStats[b.model].cited += b.citedCount
    modelStats[b.model].total += b.totalCount
  }
  const aggregatedModels = Object.values(modelStats).map(m => ({
    ...m,
    rate: m.total > 0 ? Math.round((m.cited / m.total) * 100) : 0
  }))
  
  // Aggregate displacers
  const displacerCounts = {}
  for (const d of allDisplacers) {
    displacerCounts[d.domain] = (displacerCounts[d.domain] || 0) + d.count
  }
  const topDisplacers = Object.entries(displacerCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([domain, count]) => ({ domain, count }))

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
        </div>
      </div>

      {/* Stats Grid */}
      <div className="stats-grid stats-grid-2">
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
          <div className="stat-meta">{clusters.length} cluster{clusters.length !== 1 ? 's' : ''}</div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Avg Citation Rate</span>
            <span className="stat-icon green">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </span>
          </div>
          <div className="stat-value">{avgCitation}%</div>
          <div className="stat-meta">Across all models</div>
        </div>
      </div>

      {/* Model Breakdown Panel */}
      {aggregatedModels.length > 0 && (
        <div className="insight-panel">
          <h3 className="insight-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20V10" />
              <path d="M18 20V4" />
              <path d="M6 20v-4" />
            </svg>
            Model Breakdown
          </h3>
          <div className="model-breakdown">
            {aggregatedModels.map(m => (
              <div key={m.model} className="model-stat">
                <div className="model-stat-header">
                  <ModelLogo model={m.model} size={16} />
                  <span className="model-stat-name">{m.displayName}</span>
                  <span className="model-stat-rate">{m.rate}%</span>
                </div>
                <div className="model-stat-bar">
                  <div 
                    className="model-stat-fill" 
                    style={{ width: `${m.rate}%` }}
                  />
                </div>
                <div className="model-stat-detail">{m.cited}/{m.total} prompts cited</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Displacers Panel */}
      {topDisplacers.length > 0 && (
        <div className="insight-panel displacers-panel">
          <h3 className="insight-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
              <path d="M20 8v6" />
              <path d="M23 11h-6" />
            </svg>
            Top Displacers
            <span className="insight-subtitle">Competitors cited when you're not</span>
          </h3>
          <div className="displacers-list">
            {topDisplacers.map((d, i) => (
              <div key={d.domain} className="displacer-item">
                <span className="displacer-rank">#{i + 1}</span>
                <a 
                  href={`https://${d.domain}`} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="displacer-domain"
                >
                  {d.domain}
                </a>
                <span className="displacer-count">{d.count}×</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cluster Cards */}
      <div className="section-header">
        <h3 className="section-title">Clusters</h3>
      </div>
      <div className="cluster-grid">
        {clusters.map((c) => {
          const detail = clusterDetails[c.id]
          const volatility = detail?.runs ? computeVolatility(detail.runs) : null
          
          return (
            <div key={c.id} className="cluster-card" onClick={() => onSelect(c.id)}>
              <div className="cluster-card-header">
                <h3 className="cluster-card-title">{c.name}</h3>
                {volatility && volatility.level !== 'unknown' && (
                  <span 
                    className={`volatility-badge volatility-${volatility.level}`}
                    title={volatility.label}
                  >
                    {volatility.level === 'stable' && '🟢'}
                    {volatility.level === 'medium' && '🟡'}
                    {volatility.level === 'fragile' && '🔴'}
                  </span>
                )}
              </div>
              <p className="cluster-card-desc">{c.description}</p>
              <div className="cluster-card-stats">
                <div className="cluster-stat">
                  <span className="cluster-stat-label">Prompts</span>
                  <span className="cluster-stat-value">{c.prompt_count}</span>
                </div>
                <div className="cluster-stat">
                  <span className="cluster-stat-label">Citation Rate</span>
                  <span className="cluster-stat-value rate">{c.citation_rate}%</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ClusterDetailView({ detail, onBack, onAddPrompt }) {
  const cluster = detail?.cluster
  const latestRun = detail?.latest_run || null
  const allModels = detail?.all_models || []
  const runs = detail?.runs || []
  const prompts = detail?.prompts || []
  const [editingPrompt, setEditingPrompt] = useState(null)
  const [deletePromptId, setDeletePromptId] = useState(null)

  if (!cluster) return null

  const modelOrder = ['gpt-oss-20b-free-online', 'claude-3.5-haiku-online', 'perplexity-sonar-online']
  const modelBreakdown = computeModelBreakdown(latestRun)
  const recentDrivers = computeRecentDrivers(runs)
  const volatility = computeVolatility(runs)
  const topDisplacers = computeTopDisplacers(latestRun)

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
          {volatility && volatility.level !== 'unknown' && (
            <span className={`volatility-indicator volatility-${volatility.level}`}>
              {volatility.level === 'stable' && '🟢'}
              {volatility.level === 'medium' && '🟡'}
              {volatility.level === 'fragile' && '🔴'}
              {volatility.label}
            </span>
          )}
          <button className="btn btn-primary" onClick={onAddPrompt}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Prompt
          </button>
        </div>
      </div>

      {/* Prompts List */}
      {prompts.length > 0 && (
        <div className="insight-panel">
          <h3 className="insight-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Prompts ({prompts.length})
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {prompts.map((prompt, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '4px' }}>
                <span style={{ flex: 1, fontSize: '14px', color: '#ccc' }}>{prompt}</span>
                <button 
                  onClick={() => setDeletePromptId(idx)}
                  style={{ padding: '4px 8px', backgroundColor: '#ff4444', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '12px' }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {deletePromptId !== null && (
        <div className="modal-backdrop" onClick={() => setDeletePromptId(null)}>
          <div className="modal modal-delete">
            <div className="modal-header">
              <h2 className="modal-title">Delete Prompt</h2>
              <button className="modal-close" onClick={() => setDeletePromptId(null)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <p className="delete-message">
                Are you sure you want to delete this prompt?
              </p>
              <p style={{ fontSize: '13px', color: '#999', marginTop: '8px' }}>"{prompts[deletePromptId]}"</p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setDeletePromptId(null)}>
                Cancel
              </button>
              <button 
                type="button" 
                className="btn btn-danger" 
                onClick={async () => {
                  try {
                    const promptToDelete = prompts[deletePromptId]
                    console.log('=== DELETE PROMPT DEBUG ===')
                    console.log('Prompt to delete (raw):', JSON.stringify(promptToDelete))
                    console.log('Prompt to delete (repr):', promptToDelete)
                    console.log('Prompt length:', promptToDelete?.length)
                    console.log('Prompt bytes:', new TextEncoder().encode(promptToDelete))
                    
                    const encoded = encodeURIComponent(promptToDelete)
                    const url = `/api/prompts/${cluster.id}?prompt_text=${encoded}`
                    console.log('Full URL:', url)
                    console.log('Encoded prompt:', encoded)
                    
                    const res = await fetch(url, { method: 'DELETE' })
                    
                    let data = {}
                    try {
                      const text = await res.text()
                      console.log('Raw response text:', text)
                      if (text) {
                        data = JSON.parse(text)
                      }
                    } catch (parseErr) {
                      console.error('Failed to parse response:', parseErr, 'Text was:', text)
                    }
                    
                    console.log('Delete response status:', res.status)
                    console.log('Delete response data:', data)
                    console.log('========================')
                    
                    if (!res.ok) {
                      const errorMsg = data.detail || data.error || `HTTP ${res.status}: Failed to delete prompt`
                      console.error('Delete failed:', errorMsg)
                      alert(`Failed to delete prompt:\n\n${errorMsg}\n\nCheck console for details.`)
                      return
                    }
                    setDeletePromptId(null)
                    // Refresh data from API after a moment
                    await new Promise(resolve => setTimeout(resolve, 500))
                    // Reload the cluster detail from API
                    if (cluster?.id) {
                      try {
                        const detailRes = await fetch(`/api/clusters/${cluster.id}`, { cache: 'no-store' })
                        if (detailRes.ok) {
                          const detailData = await detailRes.json()
                          // Update the detail in parent component
                          // We need to trigger a reload - simplest is to reload the page
                          window.location.reload()
                        }
                      } catch (e) {
                        console.error('Failed to refresh after delete:', e)
                        window.location.reload()
                      }
                    } else {
                      window.location.reload()
                    }
                  } catch (err) {
                    console.error('Failed to delete prompt:', err)
                    alert(`Failed to delete prompt: ${err.message || err}\n\nCheck console for details.`)
                  }
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Insights Row */}
      <div className="insights-row">
        {/* Model Breakdown */}
        <div className="insight-panel">
          <h3 className="insight-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20V10" />
              <path d="M18 20V4" />
              <path d="M6 20v-4" />
            </svg>
            Model Breakdown
          </h3>
          <div className="model-breakdown">
            {modelBreakdown.map(m => (
              <div key={m.model} className="model-stat">
                <div className="model-stat-header">
                  <ModelLogo model={m.model} size={16} />
                  <span className="model-stat-name">{m.displayName}</span>
                  <span className="model-stat-rate">{m.rate}%</span>
                </div>
                <div className="model-stat-bar">
                  <div 
                    className="model-stat-fill" 
                    style={{ 
                      width: `${m.rate}%`,
                      backgroundColor: m.rate >= 70 ? 'var(--green)' : m.rate >= 40 ? 'var(--yellow)' : 'var(--red)'
                    }}
                  />
                </div>
                <div className="model-stat-detail">{m.citedCount}/{m.totalCount} prompts</div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Drivers */}
        <div className="insight-panel">
          <h3 className="insight-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
            Recent Drivers
            <span className="insight-subtitle">What changed?</span>
          </h3>
          {recentDrivers.length > 0 ? (
            <div className="drivers-list">
              {recentDrivers.map((d, i) => (
                <div key={i} className={`driver-item driver-${d.type}`}>
                  <span className="driver-icon">
                    {d.type === 'gain' && '↑'}
                    {d.type === 'loss' && '↓'}
                    {d.type === 'rank_up' && '⬆'}
                    {d.type === 'rank_down' && '⬇'}
                  </span>
                  <span className="driver-text">
                    {d.type === 'gain' && `Gained ${d.model} citation`}
                    {d.type === 'loss' && `Lost ${d.model} citation`}
                    {d.type === 'rank_up' && `${d.model} rank improved ${d.rankChange}`}
                    {d.type === 'rank_down' && `${d.model} rank dropped ${d.rankChange}`}
                  </span>
                  {d.rank && <span className="driver-rank">rank {d.rank}</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-drivers">No changes detected from previous run</div>
          )}
        </div>

        {/* Top Displacers */}
        <div className="insight-panel displacers-panel">
          <h3 className="insight-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
              <path d="M20 8v6" />
              <path d="M23 11h-6" />
            </svg>
            Top Displacers
            <span className="insight-subtitle">Competitors cited when you're not</span>
          </h3>
          {topDisplacers.length > 0 ? (
            <div className="displacers-list">
              {topDisplacers.map((d, i) => (
                <div key={d.domain} className="displacer-item">
                  <span className="displacer-rank">#{i + 1}</span>
                  <a 
                    href={`https://${d.domain}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="displacer-domain"
                  >
                    {d.domain}
                  </a>
                  <span className="displacer-count">{d.count}×</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-drivers">No competitor displacements detected</div>
          )}
        </div>
      </div>

      {/* Pipeline */}
      <div className="pipeline">
        {displayModels.map((m, i) => {
          const shortName = getShortModelName(m.model)
          const hasData = m.results && m.results.length > 0
          const scrollToModel = () => {
            const element = document.getElementById(`model-section-${shortName}`)
            if (element) {
              element.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
          }
          return (
            <React.Fragment key={m.model}>
              <div 
                className={`pipeline-step ${hasData ? 'active' : ''}`}
                onClick={scrollToModel}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && scrollToModel()}
              >
                <ModelLogo model={m.model} />
                <span className="step-name">run-{shortName}-{cluster.id}</span>
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
        />
      ))}
    </div>
  )
}

function JobSection({ modelData, clusterId }) {
  const [isOpen, setIsOpen] = useState(false)
  const displayName = getModelDisplayName(modelData.model)
  const shortName = getShortModelName(modelData.model)
  const hasResults = modelData.results && modelData.results.length > 0
  const citedCount = modelData.cited_count || 0
  const totalCount = modelData.total_count || 0

  return (
    <div className="job-section" id={`model-section-${shortName}`}>
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
              {isSubmitting ? 'Adding...' : 'Add Prompt'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AddClusterModal({ onClose, onSubmit }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [clusterId, setClusterId] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim() || !clusterId.trim()) return
    setIsSubmitting(true)
    await new Promise(resolve => setTimeout(resolve, 500))
    onSubmit({ 
      name: name.trim(), 
      id: clusterId.trim().toLowerCase().replace(/\s+/g, '-'),
      description: description.trim() || null 
    })
    setIsSubmitting(false)
  }

  // Auto-generate ID from name
  const handleNameChange = (e) => {
    const newName = e.target.value
    setName(newName)
    if (!clusterId || clusterId === name.toLowerCase().replace(/\s+/g, '-')) {
      setClusterId(newName.toLowerCase().replace(/\s+/g, '-'))
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">Add New Cluster</h2>
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
              <label className="form-label">Cluster Name</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g., Developer Marketing"
                value={name}
                onChange={handleNameChange}
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label">Cluster ID</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g., devmarketing"
                value={clusterId}
                onChange={(e) => setClusterId(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
              />
              <div className="form-hint">Used in file names and URLs. Auto-generated from name.</div>
            </div>
            <div className="form-group">
              <label className="form-label">Description <span className="form-optional">(optional)</span></label>
              <textarea
                className="form-textarea"
                placeholder="Brief description of this cluster..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!name.trim() || !clusterId.trim() || isSubmitting}>
              {isSubmitting ? 'Adding...' : 'Add Cluster'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Delete Confirmation Modal
function DeleteConfirmModal({ clusterName, onClose, onConfirm }) {
  const [isDeleting, setIsDeleting] = useState(false)

  const handleConfirm = async () => {
    setIsDeleting(true)
    await onConfirm()
    setIsDeleting(false)
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-delete">
        <div className="modal-header">
          <div className="modal-icon-danger">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </div>
          <h2 className="modal-title">Delete Cluster</h2>
          <button className="modal-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <p className="delete-message">
            Are you sure you want to delete <strong>"{clusterName}"</strong>?
          </p>
          <p className="delete-warning">
            This action cannot be undone. All prompts and configuration for this cluster will be permanently removed.
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isDeleting}>
            Cancel
          </button>
          <button 
            type="button" 
            className="btn btn-danger" 
            onClick={handleConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? 'Deleting...' : 'Delete Cluster'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Model Logo Component
function ModelLogo({ model, size = 18 }) {
  if (!model) return <span className="status-dot"></span>
  
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
  
  if (model.includes('claude')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="model-logo claude">
        <path d="M12 2L12 22" stroke="#da7756" strokeWidth="2" strokeLinecap="round"/>
        <path d="M2 12L22 12" stroke="#da7756" strokeWidth="2" strokeLinecap="round"/>
        <path d="M4.93 4.93L19.07 19.07" stroke="#da7756" strokeWidth="2" strokeLinecap="round"/>
        <path d="M19.07 4.93L4.93 19.07" stroke="#da7756" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    )
  }
  
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

function getDomain(url) {
  if (!url) return ''
  try {
    const u = new URL(url)
    return u.hostname.replace('www.', '')
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0]
  }
}

// Cluster Nav Item with Tooltip
function ClusterNavItem({ cluster, isActive, onSelect, onDelete }) {
  const [showTooltip, setShowTooltip] = useState(false)
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 })
  const wrapperRef = useRef(null)

  const handleMouseEnter = () => {
    if (wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect()
      setTooltipPos({
        top: rect.top + rect.height / 2,
        left: rect.right + 12
      })
      setShowTooltip(true)
    }
  }

  const handleMouseLeave = () => {
    setShowTooltip(false)
  }

  return (
    <div 
      ref={wrapperRef}
      className={`nav-item-wrapper ${isActive ? 'active' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button 
        className={`nav-item ${isActive ? 'active' : ''}`}
        onClick={onSelect}
      >
        <span className="nav-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          </svg>
        </span>
        <div className="nav-content">
          <span className="nav-label">{cluster.name}</span>
          <span className="nav-meta">
            {cluster.prompt_count} prompts • <span className="rate">{cluster.citation_rate}%</span>
          </span>
        </div>
        <div className="nav-models">
          <ModelLogo model="gpt" size={14} />
          <ModelLogo model="claude" size={14} />
          <ModelLogo model="perplexity" size={14} />
        </div>
      </button>
      <button 
        className="nav-item-delete"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        title="Delete cluster"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>
      {showTooltip && ReactDOM.createPortal(
        <div 
          className="cluster-tooltip"
          style={{
            position: 'fixed',
            top: tooltipPos.top,
            left: tooltipPos.left,
            transform: 'translateY(-50%)',
            zIndex: 10000
          }}
        >
          {cluster.name}
        </div>,
        document.body
      )}
    </div>
  )
}
