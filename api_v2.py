"""Extended API for Prompt Tracker dashboard."""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv()

BASE_DIR = Path(__file__).parent
CONFIG_DIR = BASE_DIR / "config"
LOGS_DIR = BASE_DIR / "logs"

app = FastAPI(title="Prompt Tracker API", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def load_clusters_config():
    """Load clusters configuration from config/clusters.json"""
    config_path = CONFIG_DIR / "clusters.json"
    if config_path.exists():
        with open(config_path) as f:
            return json.load(f)
    return {"clusters": [], "models": []}


def load_prompts_from_file(filename: str) -> List[str]:
    """Load prompts from a config file."""
    path = CONFIG_DIR / filename
    if not path.exists():
        return []
    with open(path) as f:
        return [line.strip() for line in f if line.strip()]


def load_targets_from_file(filename: str) -> List[str]:
    """Load targets from a config file."""
    path = CONFIG_DIR / filename
    if not path.exists():
        return []
    with open(path) as f:
        return json.load(f)


def get_log_files():
    """Get all log files sorted by timestamp (newest first)."""
    if not LOGS_DIR.exists():
        return []
    
    log_files = list(LOGS_DIR.glob("run_*.json"))
    # Sort by timestamp in filename (descending)
    log_files.sort(key=lambda x: x.stem, reverse=True)
    return log_files


def parse_log_file(log_path: Path) -> dict:
    """Parse a single log file."""
    with open(log_path) as f:
        return json.load(f)


def detect_cluster_from_prompt(prompt: str, clusters_config: dict) -> Optional[str]:
    """Detect which cluster a prompt belongs to based on config files."""
    prompt_lower = prompt.lower()
    
    for cluster in clusters_config.get("clusters", []):
        prompts_file = cluster.get("prompts_file")
        if prompts_file:
            cluster_prompts = load_prompts_from_file(prompts_file)
            for cp in cluster_prompts:
                if cp.lower() == prompt_lower or prompt_lower in cp.lower() or cp.lower() in prompt_lower:
                    return cluster["id"]
    
    return None


def get_runs_by_cluster(cluster_id: str, clusters_config: dict) -> List[dict]:
    """Get all runs for a specific cluster."""
    cluster = next((c for c in clusters_config.get("clusters", []) if c["id"] == cluster_id), None)
    if not cluster:
        return []
    
    prompts_file = cluster.get("prompts_file")
    if not prompts_file:
        return []
    
    cluster_prompts = set(p.lower() for p in load_prompts_from_file(prompts_file))
    
    runs = []
    for log_file in get_log_files():
        log_data = parse_log_file(log_file)
        
        # Filter results to only include prompts from this cluster
        cluster_results = []
        for result in log_data.get("results", []):
            prompt = result.get("prompt", "")
            if prompt.lower() in cluster_prompts:
                cluster_results.append(result)
        
        if cluster_results:
            runs.append({
                "timestamp": log_data.get("timestamp"),
                "model": log_data.get("model"),
                "provider": log_data.get("provider"),
                "results": cluster_results
            })
    
    return runs


# === API Endpoints ===

@app.get("/api/healthz")
def healthz():
    return {"status": "ok", "version": "2.0"}


@app.get("/api/clusters")
def get_clusters():
    """Get all clusters with their prompts and stats."""
    config = load_clusters_config()
    clusters = []
    
    for cluster in config.get("clusters", []):
        prompts_file = cluster.get("prompts_file")
        prompts = load_prompts_from_file(prompts_file) if prompts_file else []
        
        # Calculate citation stats from logs
        runs = get_runs_by_cluster(cluster["id"], config)
        total_runs = 0
        total_cited = 0
        
        for run in runs:
            for result in run.get("results", []):
                total_runs += 1
                if result.get("matches") and len(result["matches"]) > 0:
                    total_cited += 1
        
        citation_rate = round(total_cited / total_runs * 100, 1) if total_runs > 0 else 0
        
        clusters.append({
            "id": cluster["id"],
            "name": cluster["name"],
            "description": cluster.get("description", ""),
            "prompt_count": len(prompts),
            "citation_rate": citation_rate,
            "prompts_file": prompts_file,
            "targets_file": cluster.get("targets_file"),
            "workflow": cluster.get("workflow")
        })
    
    return {"clusters": clusters}


@app.get("/api/clusters/{cluster_id}")
def get_cluster_detail(cluster_id: str):
    """Get detailed info for a specific cluster including prompts and runs."""
    config = load_clusters_config()
    cluster = next((c for c in config.get("clusters", []) if c["id"] == cluster_id), None)
    
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")
    
    prompts_file = cluster.get("prompts_file")
    prompts = load_prompts_from_file(prompts_file) if prompts_file else []
    
    targets_file = cluster.get("targets_file")
    targets = load_targets_from_file(targets_file) if targets_file else []
    
    # Get runs for this cluster
    runs = get_runs_by_cluster(cluster_id, config)
    
    # Group runs by timestamp
    runs_by_timestamp = {}
    for run in runs:
        ts = run.get("timestamp")
        if ts not in runs_by_timestamp:
            runs_by_timestamp[ts] = {
                "timestamp": ts,
                "models": []
            }
        
        # Calculate stats for this model run
        results = run.get("results", [])
        cited_count = sum(1 for r in results if r.get("matches") and len(r["matches"]) > 0)
        
        model_data = {
            "model": run.get("model"),
            "provider": run.get("provider"),
            "results": [],
            "cited_count": cited_count,
            "total_count": len(results)
        }
        
        for result in results:
            matches = result.get("matches", [])
            cited = len(matches) > 0
            
            cited_urls = []
            rank = None
            if matches:
                cited_urls = matches[0].get("cited_urls", []) or matches[0].get("matched_urls", [])
                ranks = matches[0].get("ranks", [])
                rank = ranks[0] if ranks else None
            
            # Get other URLs from domain_urls
            other_urls = []
            domain_urls = result.get("domain_urls", {})
            for domain, urls in domain_urls.items():
                for url in urls:
                    if url not in cited_urls:
                        other_urls.append(url)
            
            model_data["results"].append({
                "prompt": result.get("prompt"),
                "cited": cited,
                "cited_urls": cited_urls,
                "rank": rank,
                "other_urls": other_urls[:5],  # Limit to 5
                "status": f"cited URL(s): {', '.join(cited_urls)}" if cited else "no target URLs cited"
            })
        
        runs_by_timestamp[ts]["models"].append(model_data)
    
    # Sort by timestamp descending and get latest
    sorted_runs = sorted(runs_by_timestamp.values(), key=lambda x: x["timestamp"], reverse=True)
    
    return {
        "cluster": {
            "id": cluster["id"],
            "name": cluster["name"],
            "description": cluster.get("description", ""),
            "workflow": cluster.get("workflow")
        },
        "prompts": prompts,
        "targets": targets,
        "runs": sorted_runs[:10],  # Last 10 runs
        "latest_run": sorted_runs[0] if sorted_runs else None
    }


@app.get("/api/prompts")
def get_prompts(cluster_id: Optional[str] = None):
    """Get all prompts, optionally filtered by cluster."""
    config = load_clusters_config()
    
    all_prompts = []
    for cluster in config.get("clusters", []):
        if cluster_id and cluster["id"] != cluster_id:
            continue
        
        prompts_file = cluster.get("prompts_file")
        if prompts_file:
            prompts = load_prompts_from_file(prompts_file)
            for prompt in prompts:
                all_prompts.append({
                    "prompt": prompt,
                    "cluster_id": cluster["id"],
                    "cluster_name": cluster["name"]
                })
    
    return {"prompts": all_prompts, "total": len(all_prompts)}


@app.get("/api/runs")
def get_runs(limit: int = 10):
    """Get recent runs grouped by timestamp."""
    log_files = get_log_files()[:limit * 3]  # Get more files since we group by timestamp
    
    runs_by_timestamp = {}
    for log_file in log_files:
        log_data = parse_log_file(log_file)
        ts = log_data.get("timestamp")
        
        if ts not in runs_by_timestamp:
            runs_by_timestamp[ts] = {
                "timestamp": ts,
                "models": [],
                "total_prompts": 0,
                "cited_count": 0
            }
        
        results = log_data.get("results", [])
        cited = sum(1 for r in results if r.get("matches") and len(r["matches"]) > 0)
        
        runs_by_timestamp[ts]["models"].append({
            "model": log_data.get("model"),
            "provider": log_data.get("provider")
        })
        runs_by_timestamp[ts]["total_prompts"] += len(results)
        runs_by_timestamp[ts]["cited_count"] += cited
    
    sorted_runs = sorted(runs_by_timestamp.values(), key=lambda x: x["timestamp"], reverse=True)
    
    return {"runs": sorted_runs[:limit]}


@app.get("/api/runs/{timestamp}")
def get_run_detail(timestamp: str):
    """Get detailed results for a specific run timestamp."""
    log_files = [f for f in get_log_files() if timestamp in f.stem]
    
    if not log_files:
        raise HTTPException(status_code=404, detail="Run not found")
    
    models = []
    for log_file in log_files:
        log_data = parse_log_file(log_file)
        
        results = log_data.get("results", [])
        cited_count = sum(1 for r in results if r.get("matches") and len(r["matches"]) > 0)
        
        model_results = []
        for result in results:
            matches = result.get("matches", [])
            cited = len(matches) > 0
            
            cited_urls = []
            rank = None
            if matches:
                cited_urls = matches[0].get("cited_urls", []) or matches[0].get("matched_urls", [])
                ranks = matches[0].get("ranks", [])
                rank = ranks[0] if ranks else None
            
            other_urls = []
            domain_urls = result.get("domain_urls", {})
            for domain, urls in domain_urls.items():
                for url in urls:
                    if url not in cited_urls:
                        other_urls.append(url)
            
            model_results.append({
                "prompt": result.get("prompt"),
                "cited": cited,
                "cited_urls": cited_urls,
                "rank": rank,
                "other_urls": other_urls[:5]
            })
        
        models.append({
            "model": log_data.get("model"),
            "provider": log_data.get("provider"),
            "results": model_results,
            "cited_count": cited_count,
            "total_count": len(results)
        })
    
    return {
        "timestamp": timestamp,
        "models": models
    }


@app.get("/api/models")
def get_models():
    """Get available models from config."""
    config = load_clusters_config()
    return {"models": config.get("models", [])}


@app.get("/api/dashboard")
def get_dashboard():
    """Get dashboard summary stats."""
    config = load_clusters_config()
    
    total_prompts = 0
    total_runs = 0
    total_cited = 0
    
    for cluster in config.get("clusters", []):
        prompts_file = cluster.get("prompts_file")
        if prompts_file:
            prompts = load_prompts_from_file(prompts_file)
            total_prompts += len(prompts)
    
    # Get stats from logs
    for log_file in get_log_files():
        log_data = parse_log_file(log_file)
        results = log_data.get("results", [])
        total_runs += len(results)
        total_cited += sum(1 for r in results if r.get("matches") and len(r["matches"]) > 0)
    
    avg_citation_rate = round(total_cited / total_runs * 100, 1) if total_runs > 0 else 0
    
    return {
        "total_prompts": total_prompts,
        "total_runs": total_runs,
        "total_cited": total_cited,
        "avg_citation_rate": avg_citation_rate,
        "clusters_count": len(config.get("clusters", []))
    }


# === Static files (frontend) ===
FRONTEND_DIR = BASE_DIR / "dashboard" / "dist"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
