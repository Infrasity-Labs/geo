import json
import os
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

from run import (TargetSpec, create_target_spec, evaluate_models, load_prompts,
                 load_targets, normalize_domain, resolve_model_configs)

BASE_DIR = Path(__file__).parent
DEFAULT_PROMPTS_PATH = BASE_DIR / "config" / "prompts.txt"
DEFAULT_TARGETS_PATH = BASE_DIR / "config" / "targets.json"
CLUSTERS_PATH = BASE_DIR / "config" / "clusters.json"

app = FastAPI(title="Citation Evaluation API")

# Add CORS for dashboard
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173", "http://localhost:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class EvaluateRequest(BaseModel):
    prompts: Optional[List[str]] = None
    targets: Optional[List[str]] = None
    models: Optional[List[str]] = None


class QuickCitationRequest(BaseModel):
    prompts: Optional[List[str]] = None
    domain: Optional[str] = None
    company: Optional[str] = None
    models: Optional[List[str]] = None


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


@app.post("/evaluate")
def evaluate(request: EvaluateRequest) -> dict:
    prompts = request.prompts or load_prompts(DEFAULT_PROMPTS_PATH)
    if request.targets:
        targets: List[TargetSpec] = []
        for raw in request.targets:
            if isinstance(raw, str):
                spec = create_target_spec(raw)
                if spec:
                    targets.append(spec)
        if not targets:
            raise HTTPException(status_code=400, detail="at least one valid target is required")
    else:
        targets = load_targets(DEFAULT_TARGETS_PATH)
    requested = {slug.strip() for slug in request.models or [] if slug and slug.strip()}
    try:
        model_configs = resolve_model_configs(requested)
    except ValueError as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=400, detail=str(exc))

    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY is required to call OpenRouter.")

    records = evaluate_models(prompts, targets, api_key, model_configs)
    return {"records": records}


@app.post("/cite")
def cite(request: QuickCitationRequest) -> dict:
    prompts = [p.strip() for p in (request.prompts or []) if p and p.strip()]
    if not prompts:
        prompts = load_prompts(DEFAULT_PROMPTS_PATH)
    if not prompts:
        raise HTTPException(status_code=400, detail="at least one prompt is required")

    target_input = (request.domain or request.company or "").strip()
    if not target_input:
        raise HTTPException(status_code=400, detail="domain or company is required")

    spec = create_target_spec(target_input)
    if not spec:
        raise HTTPException(status_code=400, detail="invalid target input")
    requested = {slug.strip() for slug in request.models or [] if slug and slug.strip()}
    try:
        model_configs = resolve_model_configs(requested)
    except ValueError as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=400, detail=str(exc))

    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY is required to call OpenRouter.")

    records = evaluate_models(prompts, [spec], api_key, model_configs)
    return {
        "prompts": prompts,
        "domain": spec.domain,
        "records": records,
    }


# Cluster Management
class ClusterCreate(BaseModel):
    id: str
    name: str
    description: Optional[str] = None


def load_clusters_config():
    """Load clusters configuration from JSON file."""
    if not CLUSTERS_PATH.exists():
        return {"clusters": [], "models": []}
    with open(CLUSTERS_PATH, "r") as f:
        return json.load(f)


def save_clusters_config(config):
    """Save clusters configuration to JSON file."""
    with open(CLUSTERS_PATH, "w") as f:
        json.dump(config, f, indent=2)


@app.get("/clusters")
def get_clusters() -> dict:
    """Get all clusters."""
    config = load_clusters_config()
    return {"clusters": config.get("clusters", [])}


@app.post("/clusters")
def create_cluster(cluster: ClusterCreate) -> dict:
    """Create a new cluster."""
    config = load_clusters_config()
    clusters = config.get("clusters", [])
    
    # Check if cluster ID already exists
    if any(c["id"] == cluster.id for c in clusters):
        raise HTTPException(status_code=400, detail=f"Cluster with id '{cluster.id}' already exists")
    
    # Create prompts file for the cluster
    prompts_filename = f"prompts_{cluster.id}.txt"
    prompts_path = BASE_DIR / "config" / prompts_filename
    if not prompts_path.exists():
        prompts_path.write_text("# Add your prompts here, one per line\n")
    
    # Add new cluster
    new_cluster = {
        "id": cluster.id,
        "name": cluster.name,
        "description": cluster.description or f"Prompts for {cluster.name}",
        "prompts_file": prompts_filename,
        "targets_file": "targets_fanout.json",  # Default targets
        "workflow": f"citation-check-{cluster.id}.yml"
    }
    clusters.append(new_cluster)
    config["clusters"] = clusters
    
    save_clusters_config(config)
    
    # Regenerate dashboard data
    try:
        import subprocess
        subprocess.run(
            ["node", "scripts/generate-data.js"],
            cwd=str(BASE_DIR / "dashboard"),
            capture_output=True,
            timeout=30
        )
    except Exception as e:
        print(f"Warning: Could not regenerate dashboard data: {e}")
    
    return {"cluster": new_cluster, "message": "Cluster created successfully"}


@app.delete("/clusters/{cluster_id}")
def delete_cluster(cluster_id: str) -> dict:
    """Delete a cluster."""
    config = load_clusters_config()
    clusters = config.get("clusters", [])
    
    # Find and remove cluster
    original_len = len(clusters)
    clusters = [c for c in clusters if c["id"] != cluster_id]
    
    if len(clusters) == original_len:
        raise HTTPException(status_code=404, detail=f"Cluster '{cluster_id}' not found")
    
    config["clusters"] = clusters
    save_clusters_config(config)
    
    # Regenerate dashboard data
    try:
        import subprocess
        subprocess.run(
            ["node", "scripts/generate-data.js"],
            cwd=str(BASE_DIR / "dashboard"),
            capture_output=True,
            timeout=30
        )
    except Exception as e:
        print(f"Warning: Could not regenerate dashboard data: {e}")
    
    return {"message": f"Cluster '{cluster_id}' deleted successfully"}


# Prompt Management
class PromptCreate(BaseModel):
    prompt: str
    cluster_id: str


@app.post("/prompts")
def add_prompt(data: PromptCreate) -> dict:
    """Add a prompt to a cluster's prompts file."""
    config = load_clusters_config()
    clusters = config.get("clusters", [])
    
    # Find the cluster
    cluster = next((c for c in clusters if c["id"] == data.cluster_id), None)
    if not cluster:
        raise HTTPException(status_code=404, detail=f"Cluster '{data.cluster_id}' not found")
    
    # Get prompts file path
    prompts_file = cluster.get("prompts_file", f"prompts_{data.cluster_id}.txt")
    prompts_path = BASE_DIR / "config" / prompts_file
    
    # Append prompt to file
    prompt_text = data.prompt.strip()
    if not prompt_text:
        raise HTTPException(status_code=400, detail="Prompt cannot be empty")
    
    # Read existing prompts to avoid duplicates
    existing_prompts = []
    if prompts_path.exists():
        existing_prompts = [
            line.strip() for line in prompts_path.read_text().splitlines()
            if line.strip() and not line.strip().startswith('#')
        ]
    
    if prompt_text in existing_prompts:
        raise HTTPException(status_code=400, detail="Prompt already exists in this cluster")
    
    # Append new prompt
    with open(prompts_path, "a") as f:
        f.write(f"\n{prompt_text}")
    
    # Regenerate dashboard data
    try:
        import subprocess
        subprocess.run(
            ["node", "scripts/generate-data.js"],
            cwd=str(BASE_DIR / "dashboard"),
            capture_output=True,
            timeout=30
        )
    except Exception as e:
        print(f"Warning: Could not regenerate dashboard data: {e}")
    
    return {"message": "Prompt added successfully", "prompt": prompt_text, "cluster_id": data.cluster_id}


@app.get("/prompts/{cluster_id}")
def get_prompts(cluster_id: str) -> dict:
    """Get all prompts for a cluster."""
    config = load_clusters_config()
    clusters = config.get("clusters", [])
    
    # Find the cluster
    cluster = next((c for c in clusters if c["id"] == cluster_id), None)
    if not cluster:
        raise HTTPException(status_code=404, detail=f"Cluster '{cluster_id}' not found")
    
    # Get prompts file path
    prompts_file = cluster.get("prompts_file", f"prompts_{cluster_id}.txt")
    prompts_path = BASE_DIR / "config" / prompts_file
    
    prompts = []
    if prompts_path.exists():
        prompts = [
            line.strip() for line in prompts_path.read_text().splitlines()
            if line.strip() and not line.strip().startswith('#')
        ]
    
    return {"cluster_id": cluster_id, "prompts": prompts}
