import os
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

load_dotenv()

from run import (TargetSpec, create_target_spec, evaluate_models, load_prompts,
                 load_targets, normalize_domain, resolve_model_configs)

BASE_DIR = Path(__file__).parent
DEFAULT_PROMPTS_PATH = BASE_DIR / "config" / "prompts.txt"
DEFAULT_TARGETS_PATH = BASE_DIR / "config" / "targets.json"

app = FastAPI(title="Citation Evaluation API")


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

    api_key = os.environ.get("OPENROUTER_API_KEY")
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

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY is required to call OpenRouter.")

    records = evaluate_models(prompts, [spec], api_key, model_configs)
    return {
        "prompts": prompts,
        "domain": spec.domain,
        "records": records,
    }
