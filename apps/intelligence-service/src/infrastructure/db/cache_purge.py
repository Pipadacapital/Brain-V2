"""
cache_purge.py — CACHE-PURGE-C4C5 primitive + facade serve-gate.

CF-C5-CACHE-PURGE-1 (NAMED CUTOVER STEP):
  Built + ARMED this child. NOT fired until Stage-8 cutover act.
  Firing = the Stage-8 cutover act for workspace W's live serving flip.

The purge is NAMED (M-A5-5 verbatim target):
  1. DELETE FROM ai.insight_cache WHERE workspace_id = W.
  2. Post-purge count assertion: SELECT COUNT(*) WHERE expires_at > NOW() = 0.
  3. Facade serve-gate: blocks Brain narration for W until count = 0.
  4. Audit Decision-Log row on purge (append-only, permanent).

Rollback note: purge is irreversible (cache cold). The audit row is permanent.
Acceptable one-time regeneration delay is documented in §5.3 of the arch plan.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Optional

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PurgeResult:
    """Result of cache_purge_workspace().

    rows_deleted: number of rows deleted from ai.insight_cache.
    post_purge_count: live (non-expired) rows remaining after purge (must be 0).
    decision_log_row_id: the audit row written to ai.decision_log.
    serve_gate_clear: True if post_purge_count == 0 (safe to flip serving).
    """

    rows_deleted: int
    post_purge_count: int
    decision_log_row_id: Optional[str]
    serve_gate_clear: bool


def cache_purge_workspace(
    workspace_id: str,
    *,
    _db_writer: Any = None,
    _db_reader: Any = None,
    _decision_log_writer: Any = None,
) -> PurgeResult:
    """CACHE-PURGE-C4C5: delete all insight_cache rows for workspace_id.

    ARMED, NOT fired (Stage-8 cutover act only).
    This function MUST NOT be called in any automated path before Stage-8.
    The serve-gate (serve_gate_clear) must be True before Brain narration
    is served for workspace W.

    Args:
        workspace_id: the workspace to purge.
        _db_writer: (test/production injection) callable(workspace_id) -> int (rows deleted).
        _db_reader: (test/production injection) callable(workspace_id) -> int (live count).
        _decision_log_writer: (test injection) callable(workspace_id, row) -> str.

    Returns:
        PurgeResult with serve_gate_clear=True if the cache is fully clear.

    CF-C5-CACHE-PURGE-1: built + armed. Firing requires explicit Stage-8 call.
    """
    if not workspace_id or not workspace_id.strip():
        raise ValueError(
            "cache_purge_workspace: workspace_id must not be empty. "
            "CF-C5-CACHE-PURGE-1."
        )

    logger.warning(
        "CACHE-PURGE-C4C5: purging insight_cache for workspace_id=%r. "
        "This is the Stage-8 cutover act. CF-C5-CACHE-PURGE-1.",
        workspace_id,
    )

    # --- Delete rows ---
    if _db_writer is not None:
        rows_deleted = int(_db_writer(workspace_id))
    else:
        rows_deleted = _purge_from_db(workspace_id)

    # --- Post-purge count assertion ---
    if _db_reader is not None:
        post_purge_count = int(_db_reader(workspace_id))
    else:
        post_purge_count = _count_live_cache_rows(workspace_id)

    serve_gate_clear = post_purge_count == 0

    if not serve_gate_clear:
        logger.error(
            "CACHE-PURGE-C4C5: post-purge count = %d (expected 0) "
            "for workspace_id=%r. Serve-gate NOT cleared. CF-C5-CACHE-PURGE-1.",
            post_purge_count, workspace_id,
        )

    # --- Audit Decision-Log row (permanent, append-only) ---
    dl_row = {
        "type": "cache_purge",
        "workspace_id": workspace_id,
        "agent_id": "system",
        "input_hash": f"purge:{workspace_id}",
        "rows_deleted": rows_deleted,
        "post_purge_count": post_purge_count,
        "serve_gate_clear": serve_gate_clear,
    }
    decision_log_row_id: Optional[str] = None
    if _decision_log_writer is not None:
        try:
            decision_log_row_id = str(_decision_log_writer(workspace_id, dl_row))
        except Exception as exc:
            logger.error("cache_purge: failed to write Decision-Log audit row: %s", exc)

    logger.info(
        "CACHE-PURGE-C4C5 complete: workspace_id=%r rows_deleted=%d "
        "post_purge_count=%d serve_gate_clear=%s decision_log_row_id=%r",
        workspace_id, rows_deleted, post_purge_count,
        serve_gate_clear, decision_log_row_id,
    )

    return PurgeResult(
        rows_deleted=rows_deleted,
        post_purge_count=post_purge_count,
        decision_log_row_id=decision_log_row_id,
        serve_gate_clear=serve_gate_clear,
    )


def assert_serve_gate_clear(workspace_id: str, *, _db_reader: Any = None) -> None:
    """Facade serve-gate: raise if Brain narration must not be served for W.

    Called before serving any Brain AI narration for a workspace to ensure
    CACHE-PURGE-C4C5 has completed (no stale legacy cache entries remain).

    CF-C5-CACHE-PURGE-1: the facade blocks until post-purge count = 0.
    HELD: not called in any 5a code path (recommendation-only, serving HELD).
    """
    if _db_reader is not None:
        live_count = int(_db_reader(workspace_id))
    else:
        live_count = _count_live_cache_rows(workspace_id)

    if live_count > 0:
        raise RuntimeError(
            f"Serve-gate: Brain narration is BLOCKED for workspace_id={workspace_id!r}. "
            f"CACHE-PURGE-C4C5 has not completed: {live_count} stale cache rows remain. "
            "Run cache_purge_workspace() and verify post_purge_count == 0 "
            "before flipping Brain narration live. CF-C5-CACHE-PURGE-1."
        )


# ---------------------------------------------------------------------------
# Production DB helpers (wire real connection in production bootstrap).
# ---------------------------------------------------------------------------

def _purge_from_db(workspace_id: str) -> int:
    raise NotImplementedError(
        "_purge_from_db: wire a Postgres connection in production. "
        "In tests, pass _db_writer=... to cache_purge_workspace(). "
        "CF-C5-CACHE-PURGE-1."
    )


def _count_live_cache_rows(workspace_id: str) -> int:
    raise NotImplementedError(
        "_count_live_cache_rows: wire a Postgres connection in production. "
        "In tests, pass _db_reader=... to cache_purge_workspace()."
    )
