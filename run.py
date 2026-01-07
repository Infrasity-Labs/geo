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

OPENAI_MODEL = "gpt-4o"
PERPLEXITY_SEARCH_URL = "https://api.perplexity.ai/search"
DEFAULT_TIMEOUT = 45
RETRY_DELAY_SECONDS = 8
MAX_ATTEMPTS = 2
LOG_DIR = Path("logs")
MASTER_LOG = LOG_DIR / "master_log.jsonl"
PERPLEXITY_MODEL_NAME = "perplexity-search"


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


def call_openai_search(prompt: str, api_key: str, allowed_domains: Optional[List[str]] = None) -> str:
    url = "https://api.openai.com/v1/responses"
    tools: List[Dict] = [{"type": "web_search"}]
    if allowed_domains:
        tools[0]["filters"] = {"allowed_domains": allowed_domains}
    payload = {
        "model": OPENAI_MODEL,
        "input": [
            {"role": "system", "content": SYSTEM_MESSAGE},
            {"role": "user", "content": prompt},
        ],
        "tools": tools,
        "tool_choice": "auto",
        "temperature": 0.1,
    }
    headers = {"Authorization": f"Bearer {api_key}"}
    response = requests.post(url, headers=headers, json=payload, timeout=DEFAULT_TIMEOUT)
    response.raise_for_status()
    data = response.json()
    return data.get("output_text", "") or json.dumps(data.get("output", ""))


def call_perplexity_search(prompt: str, api_key: str) -> Dict:
    payload = {
        "query": prompt,
        "max_results": 10,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    response = requests.post(PERPLEXITY_SEARCH_URL, headers=headers, json=payload, timeout=DEFAULT_TIMEOUT)
    response.raise_for_status()
    return response.json()


def build_perplexity_response(prompt: str, data: Dict) -> Dict:
    results = []
    for item in data.get("results", []) if isinstance(data, dict) else []:
        url = item.get("url", "") if isinstance(item, dict) else ""
        results.append(
            {
                "agency": (item.get("title") or "unknown") if isinstance(item, dict) else "unknown",
                "domain": domain_from_url(url) or "unknown",
                "comment": (item.get("snippet") or "") if isinstance(item, dict) else "",
            }
        )
    return {"query": prompt, "results": results}


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
            rank_str = f"ranks {ranks}" if ranks else "rank n/a"
            parts.append(f"{match.get('domain')} ({match.get('count')}x, {rank_str})")
        print(f"- prompt: {prompt} -> cited: {', '.join(parts)}")


def log_run(record: Dict) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = record["timestamp"]
    provider = record["provider"]
    filename = LOG_DIR / f"run_{timestamp}_{provider}.json"
    with filename.open("w", encoding="utf-8") as handle:
        json.dump(record, handle, indent=2)
    with MASTER_LOG.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record) + "\n")


def run_once(prompts_path: Path, targets_path: Path) -> None:
    prompts = load_prompts(prompts_path)
    targets = load_targets(targets_path)

    openai_key = os.environ.get("OPENAI_API_KEY")
    perplexity_key = os.environ.get("PERPLEXITY_API_KEY")
    if not openai_key:
        raise EnvironmentError("OPENAI_API_KEY is required")
    if not perplexity_key:
        raise EnvironmentError("PERPLEXITY_API_KEY is required")

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    openai_caller = lambda prompt, key: call_openai_search(prompt, key, allowed_domains=targets)

    for provider, model, caller, key, mode in [
        ("openai", OPENAI_MODEL, openai_caller, openai_key, "llm"),
        ("perplexity", PERPLEXITY_MODEL_NAME, call_perplexity_search, perplexity_key, "search"),
    ]:
        provider_results = []
        for prompt in prompts:
            if mode == "search":
                raw_obj = caller(prompt, key)
                parsed = build_perplexity_response(prompt, raw_obj)
                raw = json.dumps(raw_obj)
                json_valid = True
            else:
                raw, parsed, json_valid = perform_request(caller, prompt, key)
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
            "model": model,
            "results": provider_results,
        }
        log_run(record)
        print_provider_summary(record)


if __name__ == "__main__":
    base_dir = Path(__file__).parent
    run_once(base_dir / "config" / "prompts.txt", base_dir / "config" / "targets.json")
