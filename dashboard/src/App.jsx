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
	const [selectedCluster, setSelectedCluster] = useState(null)
	const [clusterDetail, setClusterDetail] = useState(null)

	const loadClusters = useCallback(async () => {
		setLoading(true)
		try {
			const res = await fetch('/api/clusters', { cache: 'no-store' })
			if (!res.ok) throw new Error(`API load failed ${res.status}`)
			const data = await res.json()
			setClusters(data.clusters || [])
			setError(null)
		} catch (err) {
			console.error('Failed to load clusters', err)
			setError('Unable to load data')
			setClusters([])
		}
		setLoading(false)
	}, [])

	const loadClusterDetail = useCallback(async (clusterId) => {
		try {
			const res = await fetch(`/api/clusters/${clusterId}`, { cache: 'no-store' })
			if (!res.ok) throw new Error(`API load failed ${res.status}`)
			const data = await res.json()
			setClusterDetail(data)
		} catch (err) {
			console.error('Failed to load cluster detail', err)
			setClusterDetail(null)
		}
	}, [])

	useEffect(() => { loadClusters() }, [loadClusters])

	useEffect(() => {
		if (selectedCluster) {
			loadClusterDetail(selectedCluster)
		} else {
			setClusterDetail(null)
		}
	}, [selectedCluster, loadClusterDetail])

	const totalPrompts = clusters.reduce((sum, c) => sum + (c.prompt_count || 0), 0)

	let content
	if (loading) {
		content = <div className="loading"><div className="spinner"></div> Loading...</div>
	} else if (error) {
		content = <div className="error-box">{error}</div>
	} else if (selectedCluster && clusterDetail) {
		content = <ClusterDetailView detail={clusterDetail} onBack={() => setSelectedCluster(null)} />
	} else {
		content = <OverviewView clusters={clusters} onSelect={setSelectedCluster} />
	}

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
						<button className={`nav-item ${selectedCluster === null ? 'active' : ''}`} onClick={() => setSelectedCluster(null)}>
							<span>📋</span>
							<div>
								<div>All Clusters</div>
								<div className="nav-meta">{totalPrompts} prompts</div>
							</div>
						</button>
						{clusters.map((c) => (
							<button key={c.id} className={`nav-item ${selectedCluster === c.id ? 'active' : ''}`} onClick={() => setSelectedCluster(c.id)}>
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

			<main className="main-content">{content}</main>
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
				{clusters.map((c) => (
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
	const latestRun = detail?.latest_run || null
	const allModels = detail?.all_models || []
	const workflowFile = cluster?.workflow || `citation-check-${cluster?.id}.yml`

	if (!cluster) return null

	const modelOrder = ['gpt-oss-20b-free-online', 'claude-3.5-haiku-online', 'perplexity-sonar-online']

	// Get models from latest run, ensuring exactly three models are present (one for each)
	// Deduplicate by model name to avoid showing the same model multiple times
	const getModelsForDisplay = () => {
		if (!latestRun || !latestRun.models) {
			// If no latest run, return empty placeholders for all 3 models
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
		
		// Deduplicate: keep only the first occurrence of each model
		const seen = new Set()
		const uniqueModels = []
		for (const m of models) {
			if (m && m.model && !seen.has(m.model) && modelOrder.includes(m.model)) {
				seen.add(m.model)
				uniqueModels.push(m)
			}
		}
		
		// Add missing models as empty placeholders - but only the three we need
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
		
		// Sort by model order and ensure exactly 3 models
		return uniqueModels
			.filter(m => m && m.model && modelOrder.includes(m.model))
			.sort((a, b) => {
				const ia = modelOrder.indexOf(a.model)
				const ib = modelOrder.indexOf(b.model)
				return ia - ib
			})
			.slice(0, 3) // Ensure we only return exactly 3
	}

	const displayModels = getModelsForDisplay()
	const timestamp = latestRun?.timestamp || null

	// Ensure we only have exactly 3 models
	if (displayModels.length !== 3) {
		console.warn(`Expected 3 models, got ${displayModels.length}:`, displayModels.map(m => m.model))
	}

	return (
		<div>
			<button className="back-btn" onClick={onBack}>← All workflows</button>

			<div className="workflow-header">
				<div className="workflow-title">{workflowFile}</div>
				<div className="workflow-meta">on: workflow_dispatch</div>
			</div>

			{!latestRun && (
				<div className="error-box" style={{ marginTop: 16 }}>No runs found for this cluster yet.</div>
			)}

			{latestRun && displayModels.length > 0 && (
				<>
					<div className="pipeline">
						{displayModels.slice(0, 3).map((m, i) => {
							const shortName = getShortModelName(m.model)
							const hasData = m.results && m.results.length > 0
							return (
								<React.Fragment key={`pipeline-${m.model || i}`}>
									{i > 0 && <span className="pipeline-connector">•</span>}
									<div className={`pipeline-step ${hasData ? 'success' : ''}`}>
										<span className={`step-icon ${hasData ? 'success' : 'pending'}`}>{hasData ? '✓' : '○'}</span>
										<span className="step-name">run-{shortName}-...</span>
										<span className="step-time">{hasData ? '1m 30s' : '-'}</span>
									</div>
								</React.Fragment>
							)
						})}
						<span className="pipeline-connector">•</span>
						<div className={`pipeline-step ${displayModels.some(m => m.results && m.results.length > 0) ? 'success' : ''}`}>
							<span className={`step-icon ${displayModels.some(m => m.results && m.results.length > 0) ? 'success' : 'pending'}`}>
								{displayModels.some(m => m.results && m.results.length > 0) ? '✓' : '○'}
							</span>
							<span className="step-name">commit-logs-...</span>
							<span className="step-time">{displayModels.some(m => m.results && m.results.length > 0) ? '5s' : '-'}</span>
						</div>
					</div>

					{displayModels.slice(0, 3).map((modelData, modelIdx) => (
						<JobSummary 
							key={`job-${modelData.model || modelIdx}`} 
							modelData={modelData} 
							clusterId={cluster.id} 
							timestamp={timestamp} 
						/>
					))}
				</>
			)}
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
			<button type="button" className={`job-header ${isOpen ? 'open' : ''}`} onClick={() => setIsOpen(!isOpen)}>
				<span className={`job-expand ${isOpen ? 'open' : ''}`}>▶</span>
				<span className="job-title">{jobTitle}</span>
			</button>

			{isOpen && (
				<div className="job-content">
					{hasResults ? (
						<>
							<div className="run-meta">
								<div className="run-timestamp">{timestamp || 'N/A'}</div>
								<div className="run-info"><strong>Provider:</strong> {modelData.provider} | <strong>Model:</strong> {modelData.model}</div>
								<div className="run-info"><strong>Model summary:</strong> cited targets in {modelData.cited_count}/{modelData.total_count} prompts</div>
							</div>

							<table className="results-table">
								<thead>
									<tr><th>Prompt</th><th>Target URL</th><th>Status</th><th>Rank</th><th>Other cited URLs</th></tr>
								</thead>
								<tbody>
									{modelData.results.map((result, idx) => {
										const key = `${result.prompt || 'prompt'}-${result.target_urls?.[0] || idx}`
										return <ResultRow key={key} result={result} />
									})}
								</tbody>
							</table>

							<div className="job-summary-link">Job summary generated at run-time</div>
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
	const targetUrls = result.target_urls || []
	const citedUrls = result.cited_urls || []
	const otherUrls = result.other_urls || []
	const ranks = result.ranks || []

	return (
		<tr className={cited ? 'row-cited' : ''}>
			<td className="col-prompt">{result.prompt}</td>
			<td className="col-target">
				{targetUrls.map((url) => (
					<a key={url} href={url} target="_blank" rel="noopener noreferrer">{url}</a>
				))}
			</td>
			<td className="col-status">
				{cited && citedUrls.length ? (
					<span className="status-cited">
						cited URL(s): {citedUrls.map((url, i) => (
							<span key={`${url}-${i}`}>{i > 0 && ', '}<a href={url} target="_blank" rel="noopener noreferrer">{url}</a></span>
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
				{otherUrls.length ? (
					otherUrls.map((url) => {
						const safeUrl = url.startsWith('http') ? url : `https://${url}`
						return <a key={safeUrl} href={safeUrl} target="_blank" rel="noopener noreferrer">{safeUrl}</a>
					})
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
