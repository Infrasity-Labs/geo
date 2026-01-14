"""Vercel entrypoint for FastAPI app.

We expose both the ASGI `app` (for local use) and a `handler` wrapped with
Mangum so Vercel's Python runtime can invoke the FastAPI app on AWS Lambda.
"""

import sys
from pathlib import Path

# Add repo root to path so api_v2 can be imported both locally and on Vercel
sys.path.insert(0, str(Path(__file__).parent.parent))

# Export the FastAPI app directly for Vercel's ASGI support
from mangum import Mangum
from api_v2 import app  # noqa: E402  # isort: skip

# Vercel looks for `handler` in Python functions; Mangum adapts ASGI to Lambda.
handler = Mangum(app)

__all__ = ["app", "handler"]
