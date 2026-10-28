"""Shared test setup. Runs before any test module is imported."""
import os
import sys
from pathlib import Path

# Never build the 686k-title similarity index just because a TestClient started;
# similarity tests inject a small synthetic index instead.
os.environ["PATENTIQ_SIMILARITY_AUTOSTART"] = "0"

BACKEND = Path(__file__).resolve().parent.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))
