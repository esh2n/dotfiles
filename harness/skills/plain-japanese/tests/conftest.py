"""Put scripts/ on sys.path so the tests import the checks the way `uv run` does."""

import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))
