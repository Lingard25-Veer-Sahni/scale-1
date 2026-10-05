"""
Preview-only entrypoint.

Runs the real FastAPI app (server.py) exactly as it will run in production.
server.py now talks to Supabase Postgres (via pg_shim.py) instead of
MongoDB, so admin edits are durable in a real database from the start —
there is no more in-memory mock DB and no more JSON-snapshot persistence
hack layered on top of it (that was only ever needed because no real
database was reachable from this sandbox; now backend/.env points at the
real Supabase project, so this preview process IS hitting real, durable
storage).
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent))

import uvicorn
import server  # noqa: E402

if __name__ == "__main__":
    uvicorn.run(server.app, host="0.0.0.0", port=8010, reload=False)
