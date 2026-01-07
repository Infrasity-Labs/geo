# LLM Citation Monitor

Automated runner that queries OpenAI and Perplexity **search** APIs 3–4 times daily with a fixed prompt set, then tracks cited domains and logs results.

## How it works

- Prompts and target domains are read from external files so they can change without code edits.
- Each prompt is sent in a fresh session to OpenAI (`gpt-4o-search-preview-2025-03-11`) via the Responses API with web search enabled, and to Perplexity Search API (ranked web results).
- Responses are validated as JSON; if invalid, a second attempt is made. Remaining failures are logged as raw text.
- Domains are normalized, compared to the target list, and every run is written to timestamped JSON plus an append-only master log.
- GitHub Actions runs on cron (`0 0,8,16,20 * * *`) and via manual dispatch.

## Files

- Prompts: [config/prompts.txt](config/prompts.txt) — one prompt per line (exact phrases provided in brief).
- Target domains: [config/targets.json](config/targets.json) — JSON array of domains to watch.
- Runner script: [run.py](run.py) — loads config, calls providers, validates, normalizes, and logs.
- Workflow: [.github/workflows/citation-check.yml](.github/workflows/citation-check.yml) — scheduled and manual runs.
- Logs: [logs/](logs/) — timestamped run files and `master_log.jsonl` (created at runtime).

## Setup (local)

1. Python 3.11+.
2. `pip install requests`.
3. Set environment variables: `OPENAI_API_KEY` and `PERPLEXITY_API_KEY`.
4. Run: `python run.py`.

## Editing prompts or targets

- Update [config/prompts.txt](config/prompts.txt) to change the queries (keep one per line).
- Update [config/targets.json](config/targets.json) to adjust monitored domains (lowercase recommended; protocol/`www` is stripped automatically).
- No code changes are needed for either file.

## Outputs

- Per run and provider: `logs/run_<timestamp>_<provider>.json` with prompts, raw text, parsed JSON, domain list, and matches.
- Cumulative: `logs/master_log.jsonl` appended per provider per run.
- Domains are normalized (lowercase, strip scheme/`www`, drop trailing slash) before matching.

## Workflow notes

- The workflow installs `requests`, runs `python run.py`, and uploads the `logs/` directory as an artifact.
- Secrets required in repo settings: `OPENAI_API_KEY`, `PERPLEXITY_API_KEY`.

## Optional next steps

- Add a reporting script that reads `logs/master_log.jsonl` to compute citation frequency per domain/provider and weekly trends.
- Add alerting (email/Slack) when new domains appear that are not in [config/targets.json](config/targets.json).
