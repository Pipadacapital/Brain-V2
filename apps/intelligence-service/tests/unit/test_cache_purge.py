"""
test_cache_purge.py — CACHE-PURGE-C4C5 primitive + serve-gate tests.

CF-C5-CACHE-PURGE-1: built + ARMED, NOT fired (Stage-8 cutover act only).

Tests:
  - Purge returns correct row counts.
  - Post-purge count == 0 -> serve_gate_clear=True.
  - Post-purge count > 0 -> serve_gate_clear=False.
  - Audit Decision-Log row written on purge.
  - assert_serve_gate_clear raises if cache not clear.
  - assert_serve_gate_clear passes if cache clear.
  - Empty workspace_id raises ValueError.
"""

from __future__ import annotations

import pytest

from infrastructure.db.cache_purge import (
    PurgeResult,
    assert_serve_gate_clear,
    cache_purge_workspace,
)


class TestCachePurge:
    def test_purge_returns_rows_deleted_count(self) -> None:
        result = cache_purge_workspace(
            "ws_A",
            _db_writer=lambda ws: 5,
            _db_reader=lambda ws: 0,
            _decision_log_writer=lambda ws, row: "dl_001",
        )
        assert result.rows_deleted == 5
        assert result.post_purge_count == 0
        assert result.serve_gate_clear is True

    def test_post_purge_nonzero_sets_serve_gate_false(self) -> None:
        """If post-purge count > 0, serve-gate is NOT clear."""
        result = cache_purge_workspace(
            "ws_B",
            _db_writer=lambda ws: 3,
            _db_reader=lambda ws: 2,  # 2 rows remain -> problem
            _decision_log_writer=lambda ws, row: "dl_002",
        )
        assert result.post_purge_count == 2
        assert result.serve_gate_clear is False

    def test_audit_decision_log_row_written(self) -> None:
        dl_rows: list[dict] = []

        def dl_writer(ws: str, row: dict) -> str:
            dl_rows.append(row)
            return "dl_003"

        result = cache_purge_workspace(
            "ws_C",
            _db_writer=lambda ws: 7,
            _db_reader=lambda ws: 0,
            _decision_log_writer=dl_writer,
        )
        assert result.decision_log_row_id == "dl_003"
        assert len(dl_rows) == 1
        assert dl_rows[0]["type"] == "cache_purge"
        assert dl_rows[0]["workspace_id"] == "ws_C"

    def test_empty_workspace_raises(self) -> None:
        with pytest.raises(ValueError, match="workspace_id must not be empty"):
            cache_purge_workspace("", _db_writer=lambda ws: 0, _db_reader=lambda ws: 0)

    def test_serve_gate_clear_passes_when_count_zero(self) -> None:
        assert_serve_gate_clear("ws_D", _db_reader=lambda ws: 0)

    def test_serve_gate_blocks_when_count_nonzero(self) -> None:
        with pytest.raises(RuntimeError, match="Serve-gate: Brain narration is BLOCKED"):
            assert_serve_gate_clear("ws_E", _db_reader=lambda ws: 3)

    def test_zero_rows_deleted_still_ok(self) -> None:
        """Purge on already-empty cache -> 0 deleted, 0 remaining, gate clear."""
        result = cache_purge_workspace(
            "ws_F",
            _db_writer=lambda ws: 0,
            _db_reader=lambda ws: 0,
            _decision_log_writer=lambda ws, row: "dl_004",
        )
        assert result.rows_deleted == 0
        assert result.serve_gate_clear is True
