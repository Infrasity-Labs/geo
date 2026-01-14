import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const configDir = path.join(repoRoot, 'config');
const logsDir = path.join(repoRoot, 'logs');
const outPath = path.join(repoRoot, 'dashboard', 'public', 'data.json');

async function readJson(filePath) {
  const buf = await fs.readFile(filePath);
  return JSON.parse(buf.toString());
}

async function loadClusters() {
  const clustersPath = path.join(configDir, 'clusters.json');
  const cfg = await readJson(clustersPath);
  return cfg.clusters || [];
}

async function loadPrompts(fileName) {
  const p = path.join(configDir, fileName);
  const data = await fs.readFile(p, 'utf-8');
  return data.split('\n').map(l => l.trim()).filter(Boolean);
}

async function loadTargets(fileName) {
  const p = path.join(configDir, fileName);
  return readJson(p);
}

async function loadRuns() {
  const files = await fs.readdir(logsDir);
  const runs = [];
  for (const f of files) {
    if (!f.startsWith('run_') || !f.endsWith('.json')) continue;
    const payload = await readJson(path.join(logsDir, f));
    runs.push({ ...payload, __file: f });
  }
  // Newest first to mirror dashboard expectation
  runs.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  return runs;
}

function clusterMatchesPrompt(clusterPrompts, prompt) {
  const promptLower = prompt.toLowerCase();
  if (clusterPrompts.has(promptLower)) return true;
  for (const cp of clusterPrompts) {
    if (cp.includes(promptLower) || promptLower.includes(cp)) return true;
  }
  return false;
}

function dedupe(arr) {
  return Array.from(new Set(arr));
}

function buildClusterDetail(cluster, runs) {
  const promptsFile = cluster.prompts_file;
  const targetsFile = cluster.targets_file;
  const prompts = cluster.__prompts || [];
  const targets = cluster.__targets || [];

  const clusterRuns = [];
  for (const run of runs) {
    const filteredResults = [];
    for (const res of run.results || []) {
      const promptText = (res.prompt || '').toLowerCase().trim();
      if (clusterMatchesPrompt(cluster.__promptSet, promptText)) {
        filteredResults.push(res);
      }
    }
    clusterRuns.push({
      timestamp: run.timestamp,
      model: run.model,
      provider: run.provider,
      results: filteredResults,
    });
  }

  const runsByTs = {};
  for (const r of clusterRuns) {
    const ts = r.timestamp;
    runsByTs[ts] = runsByTs[ts] || { timestamp: ts, models: [] };
    const results = r.results || [];
    const citedCount = results.reduce((acc, item) => acc + ((item.matches && item.matches.length) ? 1 : 0), 0);
    runsByTs[ts].models.push({
      model: r.model,
      provider: r.provider,
      results: results.map(res => formatResult(res)),
      cited_count: citedCount,
      total_count: results.length,
    });
  }

  const sortedRuns = Object.values(runsByTs).sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  const latestRun = sortedRuns[0] || null;
  const allModels = cluster.__allModels || [];

  if (latestRun) {
    const existing = new Set(latestRun.models.map(m => m.model));
    for (const m of allModels) {
      if (!existing.has(m.name)) {
        latestRun.models.push({
          model: m.name,
          provider: m.provider,
          results: [],
          cited_count: 0,
          total_count: 0,
        });
      }
    }
    const order = ['gpt-oss-20b-free-online', 'claude-3.5-haiku-online', 'perplexity-sonar-online'];
    latestRun.models.sort((a, b) => order.indexOf(a.model) - order.indexOf(b.model));
  }

  return {
    cluster: {
      id: cluster.id,
      name: cluster.name,
      description: cluster.description || '',
      workflow: cluster.workflow,
    },
    prompts,
    targets,
    runs: sortedRuns, // include all runs for full visibility
    latest_run: latestRun || {
      timestamp: null,
      models: allModels.map(m => ({
        model: m.name,
        provider: m.provider,
        results: [],
        cited_count: 0,
        total_count: 0,
      })),
    },
    all_models: allModels,
  };
}

function formatResult(result) {
  const matches = result.matches || [];
  const cited = matches.length > 0;
  const citedUrls = dedupe(matches.flatMap(m => m.cited_urls || m.matched_urls || []));
  const targetUrls = dedupe(matches.flatMap(m => m.target_urls || []));
  const allRanks = dedupe(matches.flatMap(m => m.ranks || [])).filter(Boolean);

  const otherUrls = [];
  const domainUrls = result.domain_urls || {};
  for (const urls of Object.values(domainUrls)) {
    for (const url of urls) {
      if (!citedUrls.includes(url)) otherUrls.push(url);
    }
  }

  return {
    prompt: result.prompt,
    cited,
    target_urls: targetUrls,
    cited_urls: citedUrls,
    ranks: allRanks.length ? allRanks : null,
    other_urls: dedupe(otherUrls).slice(0, 10),
    status: cited && citedUrls.length ? `cited URL(s): ${citedUrls.join(', ')}` : 'no target URLs cited',
  };
}

async function main() {
  const clusters = await loadClusters();
  const runs = await loadRuns();
  const models = (await readJson(path.join(configDir, 'clusters.json'))).models || [];

  // annotate clusters with prompts/targets and promptSet for matching
  for (const cluster of clusters) {
    cluster.__prompts = cluster.prompts_file ? await loadPrompts(cluster.prompts_file) : [];
    cluster.__targets = cluster.targets_file ? await loadTargets(cluster.targets_file) : [];
    cluster.__promptSet = new Set(cluster.__prompts.map(p => p.toLowerCase().trim()));
    cluster.__allModels = models;
  }

  const clusterDetails = {};
  const clustersResponse = [];

  for (const cluster of clusters) {
    const detail = buildClusterDetail(cluster, runs);
    clusterDetails[cluster.id] = detail;

    // compute prompt_count and citation rate
    const totalRuns = detail.runs.reduce((acc, run) => acc + run.models.reduce((s, m) => s + m.total_count, 0), 0);
    const citedRuns = detail.runs.reduce((acc, run) => acc + run.models.reduce((s, m) => s + m.cited_count, 0), 0);
    const citationRate = totalRuns ? Math.round((citedRuns / totalRuns) * 1000) / 10 : 0;

    clustersResponse.push({
      id: cluster.id,
      name: cluster.name,
      description: cluster.description || '',
      prompt_count: cluster.__prompts.length,
      citation_rate: citationRate,
      prompts_file: cluster.prompts_file,
      targets_file: cluster.targets_file,
      workflow: cluster.workflow,
    });
  }

  const snapshot = {
    generated_at: new Date().toISOString(),
    clusters: clustersResponse,
    cluster_details: clusterDetails,
    // Lightweight run index for quick inspection
    runs: runs.map(r => ({ timestamp: r.timestamp, model: r.model, provider: r.provider, file: r.__file })),
    // Full run payloads for complete visibility in the dashboard data
    all_runs: runs,
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(snapshot, null, 2));
  console.log(`Wrote snapshot to ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
