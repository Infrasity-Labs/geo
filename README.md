# LLM Citation Monitor

Automated runner that queries OpenRouter search models 3–4 times daily with a fixed prompt set, then tracks cited domains and logs results.

## How it works

- Prompts and target domains are read from external files so they can change without code edits.
- Each prompt is sent to the OpenRouter endpoints configured in `OPENROUTER_MODELS` (for example `gpt-oss-20b:free:online`, `claude-3.5-haiku`, `perplexity/sonar`).
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

1. Install Python 3.11+.
2. `pip install -r requirements.txt`.
3. Set `OPENROUTER_API_KEY` in your environment (and `MODEL_SLUGS` if you want to limit models).
4. Run: `python run.py`.

## HTTP API

1. Make sure the prerequisites and `OPENROUTER_API_KEY` are configured as above.
2. Start the server locally with `uvicorn api:app --host 0.0.0.0 --port 8000`.
3. `GET /healthz` will report a basic `"status": "ok"` payload.
4. `POST /evaluate` accepts JSON `prompts`, `targets`, and `models`. All fields are optional; the defaults are the files in `config/` and the models defined in `OPENROUTER_MODELS`.

Example:

```
curl -X POST http://localhost:8000/evaluate \
	-H "Content-Type: application/json" \
	-d '{"models": ["openai/gpt-oss-20b:free:online"], "prompts": ["What agencies regulate clean energy?"]}'
```

### Simple citation lookup

1. `POST /cite` accepts multiple `prompts` (defaulting to `config/prompts.txt` when omitted) and requires either `domain` or `company`. It normalizes the target and runs the same evaluation pipeline across all configured models unless you supply a `models` override.
2. The response mirrors the CLI records so you get every model’s results for each prompt against that one domain.

Example:

```bash
curl -X POST http://localhost:8000/cite \
	-H "Content-Type: application/json" \
	-d '{"prompts": ["top developer marketing agencies", "developer marketing agency for AI startups"], "domain": "infrasity.com"}'
```

## Editing prompts or targets

- Update [config/prompts.txt](config/prompts.txt) to change the queries (keep one per line).
- Update [config/targets.json](config/targets.json) to adjust monitored domains (lowercase recommended; protocol/`www` is stripped automatically).
- No code changes are needed for either file.

## Outputs

- Per run and provider: `logs/run_<timestamp>_<provider>.json` with prompts, raw text, parsed JSON, domain list, and matches.
- Cumulative: `logs/master_log.jsonl` appended per provider per run.
- Domains are normalized (lowercase, strip scheme/`www`, drop trailing slash) before matching.

## Workflow notes

- The workflow installs dependencies via `pip install --upgrade pip requests` (and can be switched to `pip install -r requirements.txt` if you add more packages), runs `python run.py`, and uploads the `logs/` directory as an artifact.
- Secrets required in repo settings: `OPENROUTER_API_KEY`.

## Optional next steps

- Add a reporting script that reads `logs/master_log.jsonl` to compute citation frequency per domain/provider and weekly trends.
- Add alerting (email/Slack) when new domains appear that are not in [config/targets.json](config/targets.json).
