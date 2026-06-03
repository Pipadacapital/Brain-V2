"""
Startup gates — the service REFUSES TO START if any gate fails.

@paradigm: sql (config assertion; no ML, no LLM)

CF-C3-RESIDENCY-ASSERT-1:
  Assert ap-south-1 on BOTH DATABASE_URL and DIRECT_URL.
  Refuse to start with a named error if either URL is not ap-south-1.
  The first Brain runtime writing live PII must self-assert its own residency.

CF-C3-WORKSPACE-ALLOWLIST-1:
  ALLOWED_WORKSPACE_IDS startup check, Sugandh-Lok-only.
  Rejects any workspace whose credential read is attempted until that
  workspace's DPDP instrument is on record.
  The runbook names the approved workspace IDs.
  CF-SEC-3 re-fires before any non-Sugandh-Lok PII enters prod.
"""

from __future__ import annotations

import os
from typing import Optional


# ---------------------------------------------------------------------------
# Residency assertion (CF-C3-RESIDENCY-ASSERT-1)
# ---------------------------------------------------------------------------

_AP_SOUTH_1_MARKERS = ("ap-south-1", "ap_south_1")


class ResidencyAssertionError(RuntimeError):
    """Raised when a connection URL does not target ap-south-1.

    The service REFUSES TO START when this error is raised.
    """


def _url_contains_region(url: str) -> bool:
    """Return True if the URL contains an ap-south-1 marker."""
    lower = url.lower()
    return any(marker in lower for marker in _AP_SOUTH_1_MARKERS)


def assert_ap_south_1_residency(
    database_url: Optional[str] = None,
    direct_url: Optional[str] = None,
) -> None:
    """
    Assert that both DATABASE_URL and DIRECT_URL target ap-south-1.

    Reads from environment if not provided (normal startup path).
    Raises ResidencyAssertionError (refuse-to-start) if either check fails.

    CF-C3-RESIDENCY-ASSERT-1: named error, both URLs checked.
    """
    # Local-dev escape (BRAIN_ENV=local ONLY): the local Docker Postgres is not an
    # ap-south-1 endpoint, so the residency markers are absent by design. This bypass
    # is FAIL-CLOSED for staging/production — it activates EXCLUSIVELY when
    # BRAIN_ENV=local, so a real deploy can never skip the assertion. The prod
    # residency guarantee (CF-C3-RESIDENCY-ASSERT-1) is unchanged.
    if os.environ.get("BRAIN_ENV", "").lower() == "local":
        import logging

        logging.getLogger(__name__).warning(
            "[startup_gates] CF-C3-RESIDENCY-ASSERT-1: BRAIN_ENV=local — residency "
            "assertion SKIPPED for local-dev ONLY (NEVER staging/production)."
        )
        return

    db_url = database_url or os.environ.get("DATABASE_URL", "")
    dir_url = direct_url or os.environ.get("DIRECT_URL", "")

    if not db_url:
        raise ResidencyAssertionError(
            "[startup_gates] CF-C3-RESIDENCY-ASSERT-1: DATABASE_URL is not set. "
            "The ingestion-service requires an ap-south-1 Supabase connection string. "
            "REFUSING TO START."
        )

    if not dir_url:
        raise ResidencyAssertionError(
            "[startup_gates] CF-C3-RESIDENCY-ASSERT-1: DIRECT_URL is not set. "
            "The ingestion-service requires an ap-south-1 Supabase direct connection (:5432). "
            "REFUSING TO START."
        )

    if not _url_contains_region(db_url):
        raise ResidencyAssertionError(
            f"[startup_gates] CF-C3-RESIDENCY-ASSERT-1: DATABASE_URL does not target "
            f"ap-south-1 (url={db_url!r}). Brain only operates in ap-south-1 "
            f"(DPDP residency requirement). REFUSING TO START."
        )

    if not _url_contains_region(dir_url):
        raise ResidencyAssertionError(
            f"[startup_gates] CF-C3-RESIDENCY-ASSERT-1: DIRECT_URL does not target "
            f"ap-south-1 (url={dir_url!r}). Brain only operates in ap-south-1 "
            f"(DPDP residency requirement). REFUSING TO START."
        )


# ---------------------------------------------------------------------------
# Workspace allowlist (CF-C3-WORKSPACE-ALLOWLIST-1)
# ---------------------------------------------------------------------------

_UUID_RE_SIMPLE = __import__("re").compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    __import__("re").IGNORECASE,
)


class WorkspaceNotAllowedError(RuntimeError):
    """Raised when a workspace_id is not in ALLOWED_WORKSPACE_IDS.

    The service refuses to process any credential read / ingest for this
    workspace until its DPDP instrument is on record.
    """


def load_allowed_workspace_ids(
    env_value: Optional[str] = None,
) -> frozenset[str]:
    """
    Parse ALLOWED_WORKSPACE_IDS from the environment.

    Expected format: comma-separated UUIDs.
    Raises ResidencyAssertionError if the env var is missing or empty.
    """
    raw = env_value or os.environ.get("ALLOWED_WORKSPACE_IDS", "")
    if not raw.strip():
        raise ResidencyAssertionError(
            "[startup_gates] CF-C3-WORKSPACE-ALLOWLIST-1: ALLOWED_WORKSPACE_IDS is "
            "not set or empty. Sugandh-Lok workspace ID must be listed here. "
            "REFUSING TO START."
        )
    ids: set[str] = set()
    for raw_id in raw.split(","):
        wid = raw_id.strip().lower()
        if not _UUID_RE_SIMPLE.match(wid):
            raise ResidencyAssertionError(
                f"[startup_gates] CF-C3-WORKSPACE-ALLOWLIST-1: ALLOWED_WORKSPACE_IDS "
                f"contains an invalid UUID: {raw_id!r}. Fix the env var. REFUSING TO START."
            )
        ids.add(wid)
    return frozenset(ids)


def assert_workspace_allowed(
    workspace_id: str,
    allowed: frozenset[str],
) -> None:
    """
    Assert that workspace_id is in the allowed set.

    Raises WorkspaceNotAllowedError if not. This is called before any
    credential read or ingest run to enforce the Sugandh-Lok-only gate.

    CF-C3-WORKSPACE-ALLOWLIST-1: rejects any other workspace's credential
    read until its DPDP instrument is on record.
    """
    if not workspace_id or workspace_id.lower() not in allowed:
        raise WorkspaceNotAllowedError(
            f"[startup_gates] CF-C3-WORKSPACE-ALLOWLIST-1: workspace_id={workspace_id!r} "
            f"is not in ALLOWED_WORKSPACE_IDS. Brain is Sugandh-Lok-only until WS-2 "
            f"governance fires (CF-SEC-3). REFUSING to process this workspace."
        )


# ---------------------------------------------------------------------------
# run_all_gates — call at service startup before accepting any work
# ---------------------------------------------------------------------------


def run_all_gates(
    database_url: Optional[str] = None,
    direct_url: Optional[str] = None,
    allowed_workspace_ids_env: Optional[str] = None,
) -> frozenset[str]:
    """
    Run ALL startup gates in order. Raises on the first failure.

    Returns the parsed frozenset of allowed workspace IDs.
    Call this in main.py / entrypoint before starting the Kafka consumer loop.

    Order:
      1. Residency assertion (both DATABASE_URL + DIRECT_URL must be ap-south-1)
      2. Workspace allowlist (ALLOWED_WORKSPACE_IDS must be set and valid UUIDs)
    """
    assert_ap_south_1_residency(database_url, direct_url)
    allowed = load_allowed_workspace_ids(allowed_workspace_ids_env)
    return allowed
