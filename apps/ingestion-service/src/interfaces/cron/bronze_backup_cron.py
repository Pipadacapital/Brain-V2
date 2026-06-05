"""
Daily CH BACKUP cron — stopgap independent copy until BronzeStorageStack (P1-D).

@paradigm: sql (no ML, no LLM; CH BACKUP command — ₹0 compute cost)

P0-C Task 5 / R7 / Amendment 5 (data-warehouse-implementation-plan.md §B7):
  This cron is a DAY-ZERO acceptance criterion for P0-C, NOT an afterthought.
  It provides an independent copy of brain.connector_raw_events BEFORE the
  BronzeStorageStack CDK construct (P1-D) is live.

  Rohan (CTO Advisor) Amendment 5: "the daily CH BACKUP-to-S3 cron is a
  DAY-ZERO acceptance criterion, not an afterthought — implement + verify it exists."

  The ≤14-day window risk is:
    • P0-C lands → bronze writer running → CH is the only durable copy
    • P1-D (BronzeStorageStack CDK) must land within 14 days of P0-C
    • If the window is exceeded, BRONZE_RAW_ARCHIVER must be flagged OFF
    • This BACKUP cron closes the gap: a daily snapshot makes CH NOT the only copy

  Once P1-D lands and the S3 writer (s3_raw_writer.py) is live and verified,
  this cron is RETIRED (B10 step 4: "flip CH bronze TTL ON; retire the BACKUP cron").

CH BACKUP command:
  BACKUP TABLE brain.connector_raw_events
  TO S3('{endpoint}/{bucket}/backups/connector_raw_events/{date}/', ...)

  For local dev / CI, writes to BRONZE_S3_LOCAL_DIR (same as s3_raw_writer).
  For production (Stage-8), uses the real S3 bucket provisioned by P1-D CDK.

AUTHORED-NOT-DEPLOYED for the S3 endpoint:
  The BACKUP TO S3() call requires a real S3 bucket.  On local dev, the command
  uses the local backup directory.  Production use is held for Stage-8.
  The cron can run locally using CLICKHOUSE_BACKUP_LOCAL_DIR.

Scheduling:
  - Production: CloudWatch Events rule / ECS Scheduled Task (Stage-8 ceremony).
  - Local dev: run manually via `python -m src.interfaces.cron.bronze_backup_cron`.
  - The cron is registered in docs/cron-schedule.md as a P0-C deliverable.

Metrics:
  bronze_backup_success_total — incremented on successful BACKUP completion.
  bronze_backup_failure_total — incremented on any failure.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Metrics counters
# ---------------------------------------------------------------------------

_BACKUP_COUNTERS: dict[str, int] = {
    "bronze_backup_success_total": 0,
    "bronze_backup_failure_total": 0,
}


def _bkp_inc(counter: str, amount: int = 1) -> None:
    _BACKUP_COUNTERS[counter] = _BACKUP_COUNTERS.get(counter, 0) + amount


def get_backup_counters() -> dict[str, int]:
    """Return a snapshot of backup metric counters (test / monitoring hook)."""
    return dict(_BACKUP_COUNTERS)


def reset_backup_counters() -> None:
    """Reset all backup counters (test isolation only)."""
    for k in list(_BACKUP_COUNTERS):
        _BACKUP_COUNTERS[k] = 0


# ---------------------------------------------------------------------------
# Feature flag
# ---------------------------------------------------------------------------

def _backup_enabled() -> bool:
    """
    Return True when bronze backup cron should run.

    Enabled when BRONZE_RAW_ARCHIVER=true (same flag as the archiver consumer)
    OR when BRONZE_BACKUP_ENABLED=true (override for the cron independently).

    The cron is only useful when the archiver consumer is writing bronze rows;
    there is no point backing up an empty table.
    """
    archiver_on = os.environ.get("BRONZE_RAW_ARCHIVER", "false").strip().lower() == "true"
    backup_override = os.environ.get("BRONZE_BACKUP_ENABLED", "false").strip().lower() == "true"
    return archiver_on or backup_override


# ---------------------------------------------------------------------------
# Backup destination helpers
# ---------------------------------------------------------------------------

def _backup_s3_endpoint() -> str:
    """Return the S3 endpoint URL (for BACKUP TO S3(...) command)."""
    return os.environ.get("S3_ENDPOINT_URL", "https://s3.ap-south-1.amazonaws.com")


def _backup_s3_bucket() -> str:
    """Return the S3 bucket for BACKUP."""
    return os.environ.get("S3_BRONZE_BUCKET", "")


def _backup_local_dir() -> str:
    """Return the local directory for local-dev backups."""
    return os.environ.get("CLICKHOUSE_BACKUP_LOCAL_DIR", "")


def build_backup_command(date_str: str) -> str:
    """
    Build the CH BACKUP TABLE SQL command for the given date.

    For S3 (production):
      BACKUP TABLE brain.connector_raw_events
      TO S3('{endpoint}/{bucket}/backups/connector_raw_events/{date}/',
            '{access_key}', '{secret_key}')

    For local dev / CI:
      BACKUP TABLE brain.connector_raw_events
      TO File('{local_dir}/backups/connector_raw_events/{date}')

    Args:
        date_str: ISO date string (YYYY-MM-DD) used as the backup partition name.

    Returns:
        SQL string for clickhouse-client execution.
    """
    local_dir = _backup_local_dir()
    if local_dir:
        # Local dev: backup to local filesystem (no AWS credentials needed)
        backup_path = f"{local_dir}/backups/connector_raw_events/{date_str}"
        return (
            f"BACKUP TABLE brain.connector_raw_events "
            f"TO File('{backup_path}')"
        )

    bucket = _backup_s3_bucket()
    if not bucket:
        raise ValueError(
            "build_backup_command: S3_BRONZE_BUCKET is not set and "
            "CLICKHOUSE_BACKUP_LOCAL_DIR is not set. "
            "Set one of these to enable the BACKUP cron (P0-C Amendment 5)."
        )

    endpoint = _backup_s3_endpoint()
    # S3 backup: access_key / secret_key come from IAM role (instance profile)
    # or CH server configuration.  The BACKUP command can omit them when
    # the CH server runs with an IAM role that has s3:PutObject on the bucket.
    access_key = os.environ.get("S3_ACCESS_KEY_ID", "")
    secret_key = os.environ.get("S3_SECRET_ACCESS_KEY", "")

    if access_key and secret_key:
        creds = f"'{access_key}', '{secret_key}'"
    else:
        creds = ""

    s3_url = f"{endpoint}/{bucket}/backups/connector_raw_events/{date_str}/"
    if creds:
        s3_args = f"'{s3_url}', {creds}"
    else:
        s3_args = f"'{s3_url}'"

    return (
        f"BACKUP TABLE brain.connector_raw_events "
        f"TO S3({s3_args})"
    )


# ---------------------------------------------------------------------------
# Backup runner
# ---------------------------------------------------------------------------

async def run_bronze_backup(
    *,
    ch_client: Any = None,
    date_str: Optional[str] = None,
) -> bool:
    """
    Run the daily CH BACKUP of brain.connector_raw_events.

    P0-C Amendment 5: this function must run from day one of bronze writer
    go-live as the independent copy stopgap.

    Args:
        ch_client:  clickhouse_connect client override (for tests).
        date_str:   ISO date string for the backup partition (default: today).

    Returns:
        True  — backup completed successfully.
        False — backup failed (logged; caller should alert).

    Raises:
        Never — all exceptions caught internally.
    """
    if not _backup_enabled():
        logger.info(
            "bronze_backup_cron: BRONZE_RAW_ARCHIVER=false and "
            "BRONZE_BACKUP_ENABLED=false — backup skipped."
        )
        return True  # Skipped is not a failure

    if date_str is None:
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    try:
        backup_sql = build_backup_command(date_str)
    except ValueError as exc:
        _bkp_inc("bronze_backup_failure_total")
        logger.error("bronze_backup_cron: cannot build BACKUP command: %s", exc)
        return False

    logger.info(
        "bronze_backup_cron: starting daily BACKUP date=%r", date_str
    )

    if ch_client is None:
        try:
            ch_client = _make_ch_client()
        except ImportError as exc:
            _bkp_inc("bronze_backup_failure_total")
            logger.error("bronze_backup_cron: CH client unavailable: %s", exc)
            return False

    try:
        result = ch_client.command(backup_sql)
        _bkp_inc("bronze_backup_success_total")
        logger.info(
            "bronze_backup_cron: BACKUP completed date=%r result=%r",
            date_str, result,
        )
        return True
    except Exception as exc:
        _bkp_inc("bronze_backup_failure_total")
        logger.error(
            "bronze_backup_cron: BACKUP FAILED date=%r error=%s",
            date_str, type(exc).__name__,
        )
        return False


# ---------------------------------------------------------------------------
# CH client factory (reused from raw_archiver_consumer)
# ---------------------------------------------------------------------------

def _make_ch_client() -> Any:
    """Create a clickhouse_connect client from environment variables."""
    try:
        import clickhouse_connect  # type: ignore[import-untyped]
    except ImportError as exc:
        raise ImportError(
            "clickhouse_connect is required for the bronze backup cron. "
            "Add clickhouse-connect to ingestion-service pyproject.toml dependencies."
        ) from exc

    host = os.environ.get("CLICKHOUSE_HOST", "localhost")
    port = int(os.environ.get("CLICKHOUSE_PORT", "8123"))
    user = os.environ.get("CLICKHOUSE_USER", "default")
    password = os.environ.get("CLICKHOUSE_PASSWORD", "")
    database = os.environ.get("CLICKHOUSE_DATABASE", "brain")

    return clickhouse_connect.get_client(
        host=host,
        port=port,
        username=user,
        password=password,
        database=database,
        connect_timeout=10,
        send_receive_timeout=300,  # BACKUP can take longer than regular queries
    )


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO)
    date_arg = sys.argv[1] if len(sys.argv) > 1 else None

    success = asyncio.run(run_bronze_backup(date_str=date_arg))
    if not success:
        logger.error("bronze_backup_cron: backup run FAILED — check logs.")
        sys.exit(1)
    logger.info("bronze_backup_cron: backup run completed successfully.")
