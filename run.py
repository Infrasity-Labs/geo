import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse

import requests

SYSTEM_MESSAGE = (
    "You are doing an evaluation. For the given query, list relevant agencies with domain citations. "
    "Citations MUST be domain names only (example.com). Do not invent domains. "
    "If you are unsure about a domain, return \"unknown\" for that domain. "
    "You MUST output valid JSON only, following this schema: \n\n"
    "{\n"
    "\"query\": \"...\",\n"
    "\"results\": [\n"
    "{\n"
    "\"agency\": \"\",\n"
    "\"domain\": \"\",\n"
    "\"comment\": \"\"\n"
    "}\n"
    "]\n"
    "}\n\n"
    "Do NOT include any conversational text, explanation, or commentary outside JSON."
)

OPENROUTER_MODELS = [
    {"provider": "openrouter", "model": "openai/gpt-oss-20b:free:online", "label": "gpt-oss-20b-free-online"},
    {"provider": "openrouter", "model": "anthropic/claude-3.5-haiku:online", "label": "claude-3.5-haiku-online"},
    {"provider": "openrouter", "model": "perplexity/sonar:online", "label": "perplexity-sonar-online"},
]
DEFAULT_TIMEOUT = 45
RETRY_DELAY_SECONDS = 8
MAX_ATTEMPTS = 2
LOG_DIR = Path("logs")
MASTER_LOG = LOG_DIR / "master_log.jsonl"
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
RANK_NA_TEXT = "rank n/a"


def load_prompts(path: Path) -> List[str]:
    with path.open("r", encoding="utf-8") as handle:
        return [line.strip() for line in handle.readlines() if line.strip()]


def load_targets(path: Path) -> List[str]:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, list):
        raise ValueError("targets.json must contain a JSON array of domain strings")
    return [normalize_domain(item) for item in data if isinstance(item, str) and item.strip()]


def normalize_domain(domain: str) -> str:
    cleaned = domain.strip().lower()
    cleaned = re.sub(r"^https?://", "", cleaned)
    cleaned = re.sub(r"^www\.", "", cleaned)
    cleaned = cleaned.rstrip("/")
    return cleaned


def domain_from_url(url: str) -> str:
    parsed = urlparse(url)
    netloc = parsed.netloc or parsed.path
    return normalize_domain(netloc)


def extract_json_from_text(text: str) -> Tuple[Dict, bool]:
    try:
        return json.loads(text), True
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if match:
        snippet = match.group(0)
        try:
            return json.loads(snippet), False
        except json.JSONDecodeError:
            return {}, False
    return {}, False


def call_openrouter_search(prompt: str, api_key: str, model_slug: str) -> str:
    payload = {
        "model": model_slug,
        "messages": [
            {"role": "system", "content": SYSTEM_MESSAGE},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.1,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    response = requests.post(OPENROUTER_API_URL, headers=headers, json=payload, timeout=DEFAULT_TIMEOUT)
    response.raise_for_status()
    data = response.json()
    message = (
        data.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    )
    return message


def perform_request(call_fn, prompt: str, api_key: str) -> Tuple[str, Dict, bool]:
    last_raw = ""
    for attempt in range(MAX_ATTEMPTS):
        try:
            raw = call_fn(prompt, api_key)
            last_raw = raw if isinstance(raw, str) else json.dumps(raw)
            parsed, valid = extract_json_from_text(last_raw)
            if parsed:
                return last_raw, parsed, valid
        except requests.HTTPError as exc:  # type: ignore[var-annotated]
            status = exc.response.status_code if exc.response else None
            last_raw = exc.response.text if exc.response is not None else last_raw
            if status == 429 and attempt + 1 < MAX_ATTEMPTS:
                time.sleep(RETRY_DELAY_SECONDS)
                continue
        except requests.RequestException as exc:
            last_raw = str(exc)
            if attempt + 1 < MAX_ATTEMPTS:
                time.sleep(RETRY_DELAY_SECONDS)
                continue
        break
    return last_raw, {}, False


def collect_domains(payload: Dict) -> List[Tuple[str, int]]:
    if not isinstance(payload, dict):
        return []
    results = payload.get("results", [])
    domains: List[Tuple[str, int]] = []
    if isinstance(results, list):
        for idx, item in enumerate(results, start=1):
            if isinstance(item, dict) and "domain" in item:
                dom = normalize_domain(str(item.get("domain", "")))
                if dom:
                    domains.append((dom, idx))
    return domains


def match_targets(domains: List[Tuple[str, int]], targets: List[str]) -> List[Dict]:
    matches: Dict[str, Dict] = {}
    for domain, rank in domains:
        if domain in targets:
            entry = matches.setdefault(domain, {"domain": domain, "count": 0, "ranks": []})
            entry["count"] += 1
            entry["ranks"].append(rank)
    return list(matches.values())


def print_provider_summary(record: Dict) -> None:
    print(f"Provider: {record.get('provider')} | Model: {record.get('model')}")
    for item in record.get("results", []):
        prompt = item.get("prompt", "")[:80]
        matches = item.get("matches", [])
        if not matches:
            print(f"- prompt: {prompt} -> no target domains cited")
            continue
        parts = []
        for match in matches:
            ranks = match.get("ranks", [])
            rank_str = f"ranks {ranks}" if ranks else RANK_NA_TEXT
            parts.append(f"{match.get('domain')} ({match.get('count')}x, {rank_str})")
        print(f"- prompt: {prompt} -> cited: {', '.join(parts)}")


def format_provider_block(record: Dict) -> str:
    lines = [f"### Provider: {record.get('provider')} | Model: {record.get('model')}"]
    for item in record.get("results", []):
        prompt = item.get("prompt", "")
        matches = item.get("matches", [])
        if not matches:
            lines.append(f"- prompt: {prompt} -> no target domains cited")
            continue
        parts = []
        for match in matches:
            ranks = match.get("ranks", [])
            rank_str = f"ranks {ranks}" if ranks else RANK_NA_TEXT
            parts.append(f"{match.get('domain')} ({match.get('count')}x, {rank_str})")
        lines.append(f"- prompt: {prompt} -> cited: {', '.join(parts)}")
    return "\n".join(lines)


def escape_pipe(text: str) -> str:
    return text.replace("|", "\\|")


def format_provider_table(record: Dict) -> str:
    lines = [f"### Provider: {record.get('provider')} | Model: {record.get('model')}"]
    lines.append("| Prompt | Target Domain | Status |")
    lines.append("| --- | --- | --- |")
    for item in record.get("results", []):
        prompt = escape_pipe(item.get("prompt", ""))
        matches = item.get("matches", [])
        if not matches:
            domain_cell = ""
            status = "no target domains cited"
        else:
            domain_links = []
            status_parts = []
            for match in matches:
                domain = match.get("domain")
                if domain:
                    domain_links.append(f"[{domain}](https://{domain})")
                ranks = match.get("ranks", [])
                rank_str = f"ranks {ranks}" if ranks else RANK_NA_TEXT
                status_parts.append(f"cited {match.get('domain')} ({match.get('count')}x, {rank_str})")
            domain_cell = "<br>".join(domain_links)
            status = "; ".join(status_parts)
        lines.append(f"| {prompt} | {domain_cell} | {status} |")
    return "\n".join(lines)


def append_main_log(timestamp: str, provider_blocks: List[str]) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    path = LOG_DIR / "main_log.md"
    header = "# Citation runs\n\n"
    content = [f"## {timestamp}"]
    content.extend(provider_blocks)
    content.append("")
    content.append("")
    payload = "\n".join(content)
    if not path.exists():
        with path.open("w", encoding="utf-8") as handle:
            handle.write(header)
            handle.write(payload)
    else:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(payload)


def log_run(record: Dict) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = record["timestamp"]
    provider = record["provider"]
    model = record.get("model", "")
    safe_model = re.sub(r"[^A-Za-z0-9_.-]+", "-", str(model)) if model else "model"
    filename = LOG_DIR / f"run_{timestamp}_{provider}_{safe_model}.json"
    with filename.open("w", encoding="utf-8") as handle:
        json.dump(record, handle, indent=2)
    with MASTER_LOG.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record) + "\n")


def run_once(prompts_path: Path, targets_path: Path) -> None:
    prompts = load_prompts(prompts_path)
    targets = load_targets(targets_path)

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise EnvironmentError("OPENROUTER_API_KEY is required")

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    provider_blocks: List[str] = []

    requested_slugs = {slug.strip() for slug in os.environ.get("MODEL_SLUGS", "").split(",") if slug.strip()}
    models_to_run = [m for m in OPENROUTER_MODELS if not requested_slugs or m["model"] in requested_slugs]
    if not models_to_run:
        raise ValueError("No models to run. Set MODEL_SLUGS or update OPENROUTER_MODELS.")

    for model_cfg in models_to_run:
        provider = model_cfg.get("provider", "openrouter")
        model = model_cfg["model"]
        label = model_cfg.get("label", model)
        caller = lambda prompt, key, slug=model: call_openrouter_search(prompt, key, slug)  # type: ignore[assignment]
        provider_results = []
        for prompt in prompts:
            raw, parsed, json_valid = perform_request(caller, prompt, api_key)
            domain_ranks = collect_domains(parsed)
            matches = match_targets(domain_ranks, targets)
            provider_results.append(
                {
                    "prompt": prompt,
                    "raw": raw,
                    "parsed": parsed,
                    "json_valid": json_valid,
                    "domains": [d for d, _ in domain_ranks],
                    "domain_ranks": domain_ranks,
                    "matches": matches,
                }
            )
        record = {
            "timestamp": timestamp,
            "provider": provider,
            "model": label,
            "results": provider_results,
        }
        log_run(record)
        print_provider_summary(record)
        provider_blocks.append(format_provider_table(record))

    append_main_log(timestamp, provider_blocks)


if __name__ == "__main__":
    base_dir = Path(__file__).parent
    prompts_env = os.environ.get("PROMPTS_PATH")
    targets_env = os.environ.get("TARGETS_PATH")
    prompts_path = Path(prompts_env) if prompts_env else base_dir / "config" / "prompts.txt"
    targets_path = Path(targets_env) if targets_env else base_dir / "config" / "targets.json"
    run_once(prompts_path, targets_path)
