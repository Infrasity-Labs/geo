"""Vercel serverless function wrapper for FastAPI app."""

import sys
from pathlib import Path

# Add parent directory to path so we can import api_v2
sys.path.insert(0, str(Path(__file__).parent.parent))

from api_v2 import app
from mangum import Mangum

# Vercel expects a handler function that works with ASGI
handler = Mangum(app, lifespan="off")
