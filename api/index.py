"""Vercel entrypoint for FastAPI app.

Expose the FastAPI `app` directly; Vercel's Python runtime now auto-wraps ASGI
apps without requiring Mangum. Keeping it minimal avoids handler type errors
seen in the platform shim.
"""

import sys
from pathlib import Path

# Add repo root to path so api_v2 can be imported both locally and on Vercel
sys.path.insert(0, str(Path(__file__).parent.parent))

# Export the FastAPI app directly for Vercel's ASGI support
from api_v2 import app  # noqa: E402  # isort: skip

# Backwards-compatible alias expected by Vercel
handler = app
