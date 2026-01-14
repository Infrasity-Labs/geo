/* eslint-disable react/prop-types */
import React, { useCallback, useEffect, useState } from 'react'

const DATA_URL = '/data.json'

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
	const [clusterDetail, setClusterDetail] = useState(null)

	const loadSnapshot = useCallback(async () => {
		setLoading(true)
		try {
			const res = await fetch(DATA_URL, { cache: 'no-store' })
			if (!res.ok) throw new Error(`Snapshot load failed ${res.status}`)
			const snapshot = await res.json()
			setClusters(snapshot.clusters || [])
			setClusterDetails(snapshot.cluster_details || {})
			setError(null)
		} catch (err) {
			console.error('Failed to load snapshot', err)
			setError('Unable to load local data')
			setClusters([])
			setClusterDetails({})
		}
		setLoading(false)
	}, [])

	useEffect(() => { loadSnapshot() }, [loadSnapshot])

	useEffect(() => {
		if (selectedCluster && clusterDetails[selectedCluster]) {
			setClusterDetail(clusterDetails[selectedCluster])
		} else {
			setClusterDetail(null)
		}
	}, [selectedCluster, clusterDetails])

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
	const runs = detail?.runs || []
	const allModels = detail?.all_models || []
	const workflowFile = cluster?.workflow || `citation-check-${cluster?.id}.yml`

	if (!cluster) return null

	const modelOrder = ['gpt-oss-20b-free-online', 'claude-3.5-haiku-online', 'perplexity-sonar-online']

	const augmentModels = (models = []) => {
		const present = new Set(models.map((m) => m.model))
		const full = [...models]
		allModels.forEach((m) => {
			if (!present.has(m.name)) {
				full.push({ model: m.name, provider: m.provider, results: [], cited_count: 0, total_count: 0 })
			}
		})
		return full.sort((a, b) => {
			const ia = modelOrder.indexOf(a.model)
			const ib = modelOrder.indexOf(b.model)
			return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
		})
	}

	return (
		<div>
			<button className="back-btn" onClick={onBack}>← All workflows</button>

			<div className="workflow-header">
				<div className="workflow-title">{workflowFile}</div>
				<div className="workflow-meta">on: workflow_dispatch</div>
			</div>

			{runs.length === 0 && (
				<div className="error-box" style={{ marginTop: 16 }}>No runs found for this cluster yet.</div>
			)}

			{runs.map((run, idx) => {
				const runModels = augmentModels(run.models || [])
				return (
					<div key={run.timestamp || idx} style={{ marginTop: 24 }}>
						<div className="pipeline">
							{runModels.map((m, i) => {
								const shortName = getShortModelName(m.model)
								const hasData = m.results && m.results.length > 0
								return (
									<React.Fragment key={m.model || i}>
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
							<div className={`pipeline-step ${runModels.length > 0 ? 'success' : ''}`}>
								<span className={`step-icon ${runModels.length > 0 ? 'success' : 'pending'}`}>{runModels.length > 0 ? '✓' : '○'}</span>
								<span className="step-name">commit-logs-...</span>
								<span className="step-time">{runModels.length > 0 ? '5s' : '-'}</span>
							</div>
						</div>

						{runModels.map((modelData, modelIdx) => (
							<JobSummary key={`${run.timestamp || idx}-${modelData.model || modelIdx}`} modelData={modelData} clusterId={cluster.id} timestamp={run.timestamp} />
						))}
					</div>
				)
			})}
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
									<tr><th>Prompt</th><th>Target URL</th><th>Status</th><th>Other cited URLs</th></tr>
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
					<div>
							<span className="status-cited">
								cited URL(s): {citedUrls.map((url, i) => (
									<span key={`${url}-${i}`}>{i > 0 && ', '}<a href={url} target="_blank" rel="noopener noreferrer">{url}</a></span>
								))}
							</span>
						{ranks.length > 0 && <div className="rank-badge">rank(s): {ranks.join(', ')}</div>}
					</div>
				) : (
					<span className="status-not-cited">no target URLs cited</span>
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
