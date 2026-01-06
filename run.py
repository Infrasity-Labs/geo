import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Tuple

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

OPENAI_MODEL = "gpt-4.1"
PERPLEXITY_MODEL = "sonar-pro"
DEFAULT_TIMEOUT = 45
RETRY_DELAY_SECONDS = 8
MAX_ATTEMPTS = 2
LOG_DIR = Path("logs")
MASTER_LOG = LOG_DIR / "master_log.jsonl"


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
    cleaned = re.sub(r"^www\\.", "", cleaned)
    cleaned = cleaned.rstrip("/")
    return cleaned


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


def call_openai(prompt: str, api_key: str) -> str:
    url = "https://api.openai.com/v1/chat/completions"
    payload = {
        "model": OPENAI_MODEL,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_MESSAGE},
            {"role": "user", "content": prompt},
        ],
    }
    headers = {"Authorization": f"Bearer {api_key}"}
    response = requests.post(url, headers=headers, json=payload, timeout=DEFAULT_TIMEOUT)
    response.raise_for_status()
    data = response.json()
    return data["choices"][0]["message"]["content"]


def call_perplexity(prompt: str, api_key: str) -> str:
    url = "https://api.perplexity.ai/chat/completions"
    payload = {
        "model": PERPLEXITY_MODEL,
        "temperature": 0.1,
        "return_citations": True,
        "messages": [
            {"role": "system", "content": SYSTEM_MESSAGE},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": 800,
        "stream": False,
    }
    headers = {"Authorization": f"Bearer {api_key}"}
    response = requests.post(url, headers=headers, json=payload, timeout=DEFAULT_TIMEOUT)
    response.raise_for_status()
    data = response.json()
    return data["choices"][0]["message"]["content"]


def perform_request(call_fn, prompt: str, api_key: str) -> Tuple[str, Dict, bool]:
    last_raw = ""
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            raw = call_fn(prompt, api_key)
            last_raw = raw
            parsed, valid = extract_json_from_text(raw)
            if parsed:
                return raw, parsed, valid
        except requests.HTTPError as exc:  # type: ignore[var-annotated]
            status = exc.response.status_code if exc.response else None
            last_raw = exc.response.text if exc.response is not None else last_raw
            if status == 429 and attempt < MAX_ATTEMPTS:
                time.sleep(RETRY_DELAY_SECONDS)
                continue
        except requests.RequestException as exc:
            last_raw = str(exc)
            if attempt < MAX_ATTEMPTS:
                time.sleep(RETRY_DELAY_SECONDS)
                continue
        break
    return last_raw, {}, False


def collect_domains(payload: Dict) -> List[str]:
    if not isinstance(payload, dict):
        return []
    results = payload.get("results", [])
    domains: List[str] = []
    if isinstance(results, list):
        for item in results:
            if isinstance(item, dict) and "domain" in item:
                domains.append(normalize_domain(str(item.get("domain", ""))))
    return [d for d in domains if d]


def match_targets(domains: List[str], targets: List[str]) -> List[Dict]:
    matches: Dict[str, Dict] = {}
    for domain in domains:
        if domain in targets:
            entry = matches.setdefault(domain, {"domain": domain, "count": 0})
            entry["count"] += 1
    return list(matches.values())


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

    for provider, model, caller, key in [
        ("openai", OPENAI_MODEL, call_openai, openai_key),
        ("perplexity", PERPLEXITY_MODEL, call_perplexity, perplexity_key),
    ]:
        provider_results = []
        for prompt in prompts:
            raw, parsed, json_valid = perform_request(caller, prompt, key)
            domains = collect_domains(parsed)
            matches = match_targets(domains, targets)
            provider_results.append(
                {
                    "prompt": prompt,
                    "raw": raw,
                    "parsed": parsed,
                    "json_valid": json_valid,
                    "domains": domains,
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


if __name__ == "__main__":
    base_dir = Path(__file__).parent
    run_once(base_dir / "config" / "prompts.txt", base_dir / "config" / "targets.json")
