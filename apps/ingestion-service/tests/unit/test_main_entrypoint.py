"""PA-1 entrypoint tests — fail-closed startup + internal-only bind discipline.

These run without grpc/DB: run_all_gates() validates env strings and raises BEFORE
any gRPC import, so the refuse-to-start path is exercised with plain stdlib.
"""

from __future__ import annotations

import importlib
import pathlib


def test_main_refuses_to_start_without_residency(monkeypatch):
    # No DATABASE_URL/DIRECT_URL/ALLOWED_WORKSPACE_IDS → gate fails → exit code 1.
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("DIRECT_URL", raising=False)
    monkeypatch.delenv("ALLOWED_WORKSPACE_IDS", raising=False)
    main_mod = importlib.import_module("src.main")
    assert main_mod.main() == 1


def test_main_refuses_non_ap_south_1(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@us-east-1.example:5432/db")
    monkeypatch.setenv("DIRECT_URL", "postgresql://u:p@us-east-1.example:5432/db")
    monkeypatch.setenv("ALLOWED_WORKSPACE_IDS", "11111111-1111-1111-1111-111111111111")
    main_mod = importlib.import_module("src.main")
    assert main_mod.main() == 1  # residency gate fails closed on a non-ap-south-1 URL


def test_entrypoint_has_no_hardcoded_bind_all():
    # The internal gRPC bind host must come from GRPC_INTERNAL_HOST (env), never a
    # 0.0.0.0 literal in code (PLACEMENT-1 / TRANSPORT-1).
    src = pathlib.Path(__file__).resolve().parents[2] / "src" / "main.py"
    assert "0.0.0.0" not in src.read_text()
