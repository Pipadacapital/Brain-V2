"""PA-2b entrypoint test — internal-only bind discipline.

The fail-closed residency path + healthy-boot are verified in-container (Dockerfile
gate), because importing the entrypoint pulls in the LLM gateway client (litellm).
This test stays import-free so it runs everywhere.
"""

from __future__ import annotations

import pathlib


def test_entrypoint_has_no_hardcoded_bind_all():
    # Bind host must come from GRPC_INTERNAL_HOST (env), never a 0.0.0.0 literal
    # in code (PLACEMENT-1 / TRANSPORT-1).
    base = pathlib.Path(__file__).resolve().parents[2] / "src"
    assert "0.0.0.0" not in (base / "main.py").read_text()
    assert "0.0.0.0" not in (base / "interfaces" / "grpc" / "health_server.py").read_text()
