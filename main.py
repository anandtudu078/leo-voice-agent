"""ASGI entry point for hosts configured with the repository root as root dir.

The real app lives in ``backend/main.py``. Deployment platforms that start the
service from the repository root (for example a Render service without a Root
Directory set) run ``uvicorn main:app`` here; without this module that fails
with ``Could not import module "main"``. When the service runs from ``backend``
this file is unused.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent / "backend"
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

# Importing "main" from here would resolve to this already-initializing module,
# so load backend/main.py under a private name.
_spec = importlib.util.spec_from_file_location("leo_backend_main", _BACKEND_DIR / "main.py")
if _spec is None or _spec.loader is None:  # pragma: no cover - defensive
    raise ImportError(f"Unable to load the backend app from {_BACKEND_DIR / 'main.py'}")

_backend = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _backend
_spec.loader.exec_module(_backend)

app = _backend.app
