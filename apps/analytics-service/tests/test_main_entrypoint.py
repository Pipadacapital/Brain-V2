"""PA-2a entrypoint tests — fail-closed startup + internal-only bind discipline.

These exercise the residency negative paths, which sys.exit(1) BEFORE the gRPC
server starts (so no server is spun up and no DB/grpc is needed). The read-only
role-probe "actually executes" proof is verified in-container (Dockerfile gate),
since it requires psycopg + a real Postgres connection attempt.
"""

from __future__ import annotations

import importlib
import pathlib

import pytest


def test_main_refuses_non_ap_south_1(monkeypatch):
    # Valid-looking but wrong-region CH host → residency gate fails → exit 1.
    monkeypatch.setenv("CLICKHOUSE_HOST", "myhost.us-east-1.aws.clickhouse.cloud")
    monkeypatch.setenv("ANALYTICS_POSTGRES_ROLE_CHECK", "skip")  # isolate the residency assertion
    main_mod = importlib.import_module("src.main")
    with pytest.raises(SystemExit) as exc:
        main_mod.main()
    assert exc.value.code == 1


def test_main_refuses_missing_clickhouse_host(monkeypatch):
    monkeypatch.delenv("CLICKHOUSE_HOST", raising=False)
    monkeypatch.setenv("ANALYTICS_POSTGRES_ROLE_CHECK", "skip")
    main_mod = importlib.import_module("src.main")
    with pytest.raises(SystemExit) as exc:
        main_mod.main()
    assert exc.value.code == 1


def test_entrypoint_has_no_hardcoded_bind_all():
    # Bind host must come from GRPC_INTERNAL_HOST (env), never a 0.0.0.0 literal
    # in code (PLACEMENT-1 / TRANSPORT-1).
    base = pathlib.Path(__file__).resolve().parents[1] / "src"
    assert "0.0.0.0" not in (base / "main.py").read_text()
    assert "0.0.0.0" not in (base / "interfaces" / "grpc" / "health_server.py").read_text()
