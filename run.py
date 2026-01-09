import json
import os
import re
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv

load_dotenv()

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
URL_PATTERN = re.compile(r"https?://[^\s)\]]+")


@dataclass
class TargetSpec:
    original: str
    domain: str
    url: str
    has_path: bool


def load_prompts(path: Path) -> List[str]:
    with path.open("r", encoding="utf-8") as handle:
        return [line.strip() for line in handle.readlines() if line.strip()]


def load_targets(path: Path) -> List[TargetSpec]:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, list):
        raise ValueError("targets.json must contain a JSON array of domain or URL strings")
    targets: List[TargetSpec] = []
    for item in data:
        if isinstance(item, str):
            spec = create_target_spec(item)
            if spec:
                targets.append(spec)
    return targets


def normalize_domain(domain: str) -> str:
    cleaned = domain.strip().lower()
    cleaned = re.sub(r"^https?://", "", cleaned)
    cleaned = re.sub(r"^www\.", "", cleaned)
    cleaned = cleaned.rstrip("/")
    return cleaned

def normalize_url(url: str) -> str:
    cleaned = url.strip()
    if not cleaned:
        return ""
    parsed = urlparse(cleaned)
    if not parsed.scheme:
        parsed = urlparse(f"https://{cleaned}")
    if not parsed.netloc:
        return ""
    scheme = parsed.scheme or "https"
    domain = normalize_domain(parsed.netloc)
    path = parsed.path.rstrip("/")
    normalized = f"{scheme}://{domain}"
    if path and path != "/":
        normalized += path
    if parsed.query:
        normalized += f"?{parsed.query}"
    if parsed.fragment:
        normalized += f"#{parsed.fragment}"
    return normalized


def strip_scheme(url: str) -> str:
    return re.sub(r"^https?://", "", url)


def create_target_spec(entry: str) -> Optional[TargetSpec]:
    cleaned = entry.strip()
    if not cleaned:
        return None
    domain = domain_from_url(cleaned)
    if not domain:
        return None
    normalized = normalize_url(cleaned)
    has_path = bool(normalized and normalized != domain)
    return TargetSpec(original=entry, domain=domain, url=normalized if has_path else "", has_path=has_path)


def extract_urls_from_text(text: str) -> List[str]:
    if not text:
        return []
    matches = URL_PATTERN.findall(text)
    normalized_urls: List[str] = []
    seen: Set[str] = set()
    for match in matches:
        normalized = normalize_url(match)
        if normalized and normalized not in seen:
            seen.add(normalized)
            normalized_urls.append(normalized)
    return normalized_urls


def collect_domain_urls(payload: Dict) -> Dict[str, List[str]]:
    domain_urls: Dict[str, List[str]] = defaultdict(list)
    results = payload.get("results", [])
    if not isinstance(results, list):
        return {}
    for item in results:
        if not isinstance(item, dict):
            continue
        domain = normalize_domain(str(item.get("domain", "")))
        if not domain:
            continue
        urls = extract_urls_from_text(item.get("comment", ""))
        if urls:
            for url in urls:
                if url not in domain_urls[domain]:
                    domain_urls[domain].append(url)
    return dict(domain_urls)


def build_target_index(targets: List[TargetSpec]) -> Dict[str, List[TargetSpec]]:
    index: Dict[str, List[TargetSpec]] = defaultdict(list)
    for target in targets:
        index[target.domain].append(target)
    return index


def domain_from_url(url: str) -> str:
    cleaned = url.strip()
    if not cleaned:
        return ""
    parsed = urlparse(cleaned)
    if not parsed.scheme:
        parsed = urlparse(f"https://{cleaned}")
    netloc = parsed.netloc or parsed.path
    domain_candidate = netloc.split("/")[0]
    return normalize_domain(domain_candidate)


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


def match_targets(
    domains: List[Tuple[str, int]],
    targets: List[TargetSpec],
    domain_urls: Dict[str, List[str]],
) -> List[Dict]:
    index = build_target_index(targets)
    matches: Dict[str, Dict] = {}
    for domain, rank in domains:
        if domain not in index:
            continue
        entry = matches.setdefault(
            domain,
            {
                "domain": domain,
                "ranks": [],
                "target_urls": [],
                "matched_urls": [],
                "cited_urls": [],
            },
        )
        entry["ranks"].append(rank)
    for domain, entry in matches.items():
        specs = index.get(domain, [])
        target_urls: List[str] = []
        for spec in specs:
            if spec.has_path and spec.url and spec.url not in target_urls:
                target_urls.append(spec.url)
        entry["target_urls"] = target_urls
        available_urls = domain_urls.get(domain, [])
        entry["cited_urls"] = available_urls
        if target_urls:
            normalized_targets = {strip_scheme(url) for url in target_urls}
            entry["matched_urls"] = [
                url
                for url in available_urls
                if strip_scheme(url) in normalized_targets
            ]
        else:
            entry["matched_urls"] = list(available_urls)
    return list(matches.values())


def resolve_model_configs(requested_slugs: Optional[Set[str]] = None) -> List[Dict]:
    requested = {slug.strip() for slug in requested_slugs or set() if slug and slug.strip()}
    filtered = [m for m in OPENROUTER_MODELS if not requested or m["model"] in requested]
    if not filtered:
        raise ValueError("No models to run. Set MODEL_SLUGS or update OPENROUTER_MODELS.")
    return filtered


def evaluate_models(
    prompts: List[str],
    targets: List[TargetSpec],
    api_key: str,
    model_configs: List[Dict],
    *,
    timestamp: Optional[str] = None,
) -> List[Dict]:
    if not prompts:
        raise ValueError("At least one prompt is required to evaluate models.")
    ts = timestamp or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    records: List[Dict] = []
    for model_cfg in model_configs:
        provider = model_cfg.get("provider", "openrouter")
        model = model_cfg["model"]
        label = model_cfg.get("label", model)
        caller = lambda prompt, key, slug=model: call_openrouter_search(prompt, key, slug)  # type: ignore[assignment]
        provider_results = []
        for prompt in prompts:
            raw, parsed, json_valid = perform_request(caller, prompt, api_key)
            domain_ranks = collect_domains(parsed)
            domain_urls_map = collect_domain_urls(parsed)
            matches = match_targets(domain_ranks, targets, domain_urls_map)
            domain_urls = {domain: list(urls) for domain, urls in domain_urls_map.items()}
            provider_results.append(
                {
                    "prompt": prompt,
                    "raw": raw,
                    "parsed": parsed,
                    "json_valid": json_valid,
                    "domains": [d for d, _ in domain_ranks],
                    "domain_ranks": domain_ranks,
                    "matches": matches,
                    "domain_urls": domain_urls,
                }
            )
        records.append(
            {
                "timestamp": ts,
                "provider": provider,
                "model": label,
                "results": provider_results,
            }
        )
    return records


def print_provider_summary(record: Dict) -> None:
    print(f"Provider: {record.get('provider')} | Model: {record.get('model')}")
    print(format_console_table(record))


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
            parts.append(f"{match.get('domain')} ({rank_str})")
        lines.append(f"- prompt: {prompt} -> cited: {', '.join(parts)}")
    return "\n".join(lines)


def describe_match(match: Dict) -> str:
    domain = match.get("domain", "")
    ranks = match.get("ranks", [])
    rank_str = f"ranks {ranks}" if ranks else RANK_NA_TEXT
    pieces = [f"{domain} ({rank_str})"]
    matched_urls = match.get("matched_urls", []) or []
    cited_urls = match.get("cited_urls", []) or []
    target_urls = match.get("target_urls", []) or []
    if matched_urls:
        pieces.append(f"cited URL(s): {', '.join(matched_urls)}")
    elif cited_urls:
        pieces.append(f"cited URL(s): {', '.join(cited_urls)}")
    elif target_urls:
        pieces.append("exact URL not found")
    else:
        pieces.append("no URL targets")
    return "; ".join(pieces)


def top_results(parsed: Dict, limit: int = 3) -> List[Tuple[str, str]]:
    results = parsed.get("results", []) if isinstance(parsed, dict) else []
    rows: List[Tuple[str, str]] = []
    for item in results[:limit]:
        if not isinstance(item, dict):
            continue
        domain = normalize_domain(str(item.get("domain", "")))
        agency = str(item.get("agency", "")).strip()
        rows.append((domain, agency))
    return rows


def _target_cell(matches: List[Dict], domain_urls: Dict[str, List[str]]) -> str:
    if not matches:
        fallback_urls: List[str] = []
        for urls in domain_urls.values():
            fallback_urls.extend(urls)
        return "<br>".join(fallback_urls) if fallback_urls else "—"
    target_bits: List[str] = []
    for match in matches:
        urls = match.get("matched_urls", []) or match.get("cited_urls", []) or match.get("target_urls", [])
        domain = match.get("domain", "")
        if urls:
            target_bits.extend(urls)
        elif domain:
            target_bits.append(f"https://{domain}")
    if not target_bits:
        fallback_urls = []
        for urls in domain_urls.values():
            fallback_urls.extend(urls)
        return "<br>".join(fallback_urls) if fallback_urls else "—"
    return "<br>".join(target_bits)


def other_cited_urls(domain_urls: Dict[str, List[str]], target_domains: Set[str], *, limit: int = 3) -> List[str]:
    urls: List[str] = []
    for domain, domain_list in domain_urls.items():
        if domain in target_domains:
            continue
        for url in domain_list:
            if url not in urls:
                urls.append(url)
            if len(urls) >= limit:
                return urls[:limit]
    return urls[:limit]


def _top3_cell(parsed: Dict) -> str:
    trio = []
    for idx, (domain, agency) in enumerate(top_results(parsed), start=1):
        if not domain and not agency:
            continue
        label = f"{idx}) {domain}" if domain else f"{idx})"
        if agency:
            label += f" – {agency}"
        trio.append(label)
    return "<br>".join(trio) if trio else "—"


def format_console_table(record: Dict) -> str:
    lines = ["| Prompt | Target Found | Rank |", "| --- | --- | --- |"]
    for item in record.get("results", []):
        prompt = escape_pipe(item.get("prompt", ""))
        matches = item.get("matches", [])
        if matches:
            match = matches[0]
            domain = match.get("domain", "")
            ranks = match.get("ranks", [])
            rank_str = str(ranks[0]) if ranks else "—"
            target_cell = f"✅ {domain}"
        else:
            target_cell = "❌"
            rank_str = "—"
        lines.append(f"| {prompt} | {target_cell} | {rank_str} |")
    return "\n".join(lines)


def escape_pipe(text: str) -> str:
    return text.replace("|", "\\|")


def format_provider_table(record: Dict) -> str:
    lines = [f"### Provider: {record.get('provider')} | Model: {record.get('model')}"]
    lines.append("| Prompt | Target Domain | Status | Other cited URLs |")
    lines.append("| --- | --- | --- | --- |")
    for item in record.get("results", []):
        prompt = escape_pipe(item.get("prompt", ""))
        matches = item.get("matches", [])
        domain_urls = item.get("domain_urls", {}) or {}
        target_domains = {m.get("domain", "") for m in matches if m.get("domain")}
        other_urls = other_cited_urls(domain_urls, target_domains)
        other_cell = "<br>".join(other_urls) if other_urls else "—"
        if not matches:
            domain_cell = ""
            status = "no target domains cited"
        else:
            domain_links = []
            for match in matches:
                domain = match.get("domain")
                if domain:
                    domain_links.append(f"[{domain}](https://{domain})")
            domain_cell = "<br>".join(domain_links)
            status = "; ".join(describe_match(match) for match in matches)
        lines.append(f"| {prompt} | {domain_cell} | {status} | {other_cell} |")
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


def write_job_summary(timestamp: str, provider_blocks: List[str]) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    summary_path = LOG_DIR / "last_summary.md"
    content = [f"## {timestamp}"]
    content.extend(provider_blocks)
    content.append("")
    summary_path.write_text("\n".join(content), encoding="utf-8")


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
    models_to_run = resolve_model_configs(requested_slugs)
    records = evaluate_models(prompts, targets, api_key, models_to_run, timestamp=timestamp)

    for record in records:
        log_run(record)
        print_provider_summary(record)
        provider_blocks.append(format_provider_table(record))

    append_main_log(timestamp, provider_blocks)
    write_job_summary(timestamp, provider_blocks)


if __name__ == "__main__":
    base_dir = Path(__file__).parent
    prompts_env = os.environ.get("PROMPTS_PATH")
    targets_env = os.environ.get("TARGETS_PATH")
    prompts_path = Path(prompts_env) if prompts_env else base_dir / "config" / "prompts.txt"
    targets_path = Path(targets_env) if targets_env else base_dir / "config" / "targets.json"
    run_once(prompts_path, targets_path)
