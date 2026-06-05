"""
S3 raw archive writer — non-fatal companion of the bronze raw-archiver consumer.

@paradigm: sql (no ML, no LLM; pure I/O adapter — deterministic file path construction
           and compressed bytes write; ₹0 compute cost per write)

P0-C / R7 (data-warehouse-implementation-plan.md §B7):
  This module is the second destination for every bronze row: the same bytes that
  land in CH `brain.connector_raw_events` are also written to S3 at:

      s3://{bucket}/{workspace_id}/{vendor}/{yyyy}/{mm}/{dd}/{idempotency_key}.json.zst

  The S3 write is INTENTIONALLY NON-FATAL — a transient S3 error must not block
  the CH write, which is the live path.  Failures are logged and counted.

  S3 is the durable, independent copy that:
    - survives a CH disk failure / DROP / upgrade
    - is the replay source once BronzeStorageStack (P1-D CDK) is live
    - closes the CH-only-copy window (R7 ≤14-day SLA + BACKUP cron are
      the compensating controls until P1-D lands)

Local / CI:
  When S3_BRONZE_BUCKET is unset (or LOCAL mode) the write is a no-op (logged).
  When BRONZE_S3_LOCAL_DIR is set, writes to a local directory tree (minio-compatible).
  This keeps tests fast without a real S3 bucket or minio container.

AUTHORED-NOT-DEPLOYED (S3 bucket itself):
  The BronzeStorageStack CDK construct (infra/cdk/lib/bronze-storage-stack.ts, P1-D)
  provisions the bucket.  This module is the write adapter; it does NOT create the
  bucket at runtime.  Until P1-D the BACKUP cron (bronze_backup_cron.py) is the
  independent copy stopgap.

Metrics:
  bronze_s3_write_failures_total — incremented on any S3 write error.
  bronze_s3_writes_total         — incremented on successful write.
  Both are in-process counters (Prometheus integration at Stage-8).

NEVERLOG:
  The bytes written to S3 are the tokenized envelope (PII-light; P0-B assures
  this upstream).  This module never logs raw payload bytes.
"""

from __future__ import annotations

import io
import logging
import os
import zlib
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-process metrics counters (Prometheus wiring at Stage-8)
# ---------------------------------------------------------------------------

_S3_COUNTERS: dict[str, int] = {
    "bronze_s3_writes_total": 0,
    "bronze_s3_write_failures_total": 0,
}


def _s3_inc(counter: str, amount: int = 1) -> None:
    _S3_COUNTERS[counter] = _S3_COUNTERS.get(counter, 0) + amount


def get_s3_counters() -> dict[str, int]:
    """Return a snapshot of S3 metric counters (test / monitoring hook)."""
    return dict(_S3_COUNTERS)


def reset_s3_counters() -> None:
    """Reset all S3 counters (test isolation only)."""
    for k in list(_S3_COUNTERS):
        _S3_COUNTERS[k] = 0


# ---------------------------------------------------------------------------
# Path construction — deterministic S3 object key
# ---------------------------------------------------------------------------

def build_s3_key(
    workspace_id: str,
    vendor: str,
    received_at: datetime,
    idempotency_key: str,
) -> str:
    """
    Build the S3 object key for a bronze envelope.

    Pattern: {workspace_id}/{vendor}/{yyyy}/{mm}/{dd}/{idempotency_key}.json.zst

    Args:
        workspace_id:    Tenant UUID string (partition-level isolation).
        vendor:          Vendor code ('SHOPIFY', 'META', …).
        received_at:     When Brain ingested the event (UTC).
        idempotency_key: The vendor's unique event identifier.

    Returns:
        S3 key string (no leading '/').
    """
    dt = received_at.astimezone(timezone.utc)
    yyyy = dt.strftime("%Y")
    mm = dt.strftime("%m")
    dd = dt.strftime("%d")
    # Sanitize idempotency_key: replace '/' with '_' (S3 path traversal guard)
    safe_key = idempotency_key.replace("/", "_").replace("..", "__")
    return f"{workspace_id}/{vendor}/{yyyy}/{mm}/{dd}/{safe_key}.json.zst"


# ---------------------------------------------------------------------------
# Compression helper
# ---------------------------------------------------------------------------

def _zstd_compress(data: bytes) -> bytes:
    """
    Compress `data` using zlib (deflate) with level 6.

    Note: production SHOULD use the `zstandard` (zstd) library for better
    compression ratio — this falls back to zlib.compress for environments
    where the `zstandard` C extension is not available.  The .json.zst
    extension is used for consistency; the bytes are zlib-compressed in
    this fallback path.  P1-D can add `zstandard` as a hard dep and swap
    this implementation.

    Returns:
        Compressed bytes.
    """
    try:
        import zstandard as zstd  # type: ignore[import-untyped]
        cctx = zstd.ZstdCompressor(level=3)
        return cctx.compress(data)
    except ImportError:
        # Fallback to zlib — available in stdlib.  Produces .zst extension
        # in name but zlib bytes in content (noted in header comments; swap
        # at P1-D when zstandard is added to pyproject.toml).
        return zlib.compress(data, level=6)


# ---------------------------------------------------------------------------
# Feature flag
# ---------------------------------------------------------------------------

def _s3_enabled() -> bool:
    """True when BRONZE_RAW_ARCHIVER env-var is 'true' (case-insensitive)."""
    return os.environ.get("BRONZE_RAW_ARCHIVER", "false").strip().lower() == "true"


def _s3_bucket() -> str:
    """Return the S3 bucket name from environment."""
    return os.environ.get("S3_BRONZE_BUCKET", "")


def _local_dir() -> str:
    """Return the local directory for local-dev / minio fallback."""
    return os.environ.get("BRONZE_S3_LOCAL_DIR", "")


# ---------------------------------------------------------------------------
# Public write function
# ---------------------------------------------------------------------------

async def write_to_s3(
    *,
    workspace_id: str,
    vendor: str,
    received_at: datetime,
    idempotency_key: str,
    envelope_bytes: bytes,
    s3_client: Any = None,
) -> bool:
    """
    Write one bronze envelope to S3 (compressed JSON).

    Non-fatal: any exception is caught, logged, and counted.  The caller
    (raw_archiver_consumer) proceeds with the CH write regardless.

    Args:
        workspace_id:    Tenant UUID.
        vendor:          Vendor code.
        received_at:     Ingestion timestamp (UTC).
        idempotency_key: Vendor-unique event ID (becomes the filename).
        envelope_bytes:  Raw JSON bytes of the Kafka envelope (already tokenized).
        s3_client:       Optional boto3 s3 client override (for tests).

    Returns:
        True  — write succeeded (or local-dir write succeeded).
        False — write failed (logged; caller should count via metric).

    Raises:
        Never — all exceptions are caught internally (non-fatal contract).
    """
    if not _s3_enabled():
        # Feature flag OFF: no-op, return True (non-blocking skip).
        logger.debug(
            "s3_raw_writer: BRONZE_RAW_ARCHIVER=false — skipping write "
            "workspace_id=%r vendor=%r idempotency_key=%r",
            workspace_id, vendor, idempotency_key,
        )
        return True

    key = build_s3_key(workspace_id, vendor, received_at, idempotency_key)
    compressed = _zstd_compress(envelope_bytes)

    # ------------------------------------------------------------------
    # Local-directory mode (local dev / CI without a real S3 / minio)
    # ------------------------------------------------------------------
    local_dir = _local_dir()
    if local_dir:
        return _write_local(local_dir, key, compressed, workspace_id, vendor, idempotency_key)

    # ------------------------------------------------------------------
    # Real S3 write
    # ------------------------------------------------------------------
    bucket = _s3_bucket()
    if not bucket:
        logger.warning(
            "s3_raw_writer: BRONZE_RAW_ARCHIVER=true but S3_BRONZE_BUCKET is unset "
            "— skipping S3 write. Set S3_BRONZE_BUCKET or BRONZE_S3_LOCAL_DIR. "
            "workspace_id=%r vendor=%r idempotency_key=%r",
            workspace_id, vendor, idempotency_key,
        )
        _s3_inc("bronze_s3_write_failures_total")
        return False

    try:
        client = s3_client if s3_client is not None else _get_boto3_s3_client()
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=compressed,
            ContentType="application/json",
            ContentEncoding="zstd",
            Metadata={
                "workspace_id": workspace_id,
                "vendor": vendor,
                "idempotency_key": idempotency_key,
            },
        )
        _s3_inc("bronze_s3_writes_total")
        logger.debug(
            "s3_raw_writer: write ok bucket=%r key=%r workspace_id=%r vendor=%r",
            bucket, key, workspace_id, vendor,
        )
        return True
    except Exception as exc:
        # NON-FATAL: log + count but do NOT re-raise.
        # The CH write in the consumer proceeds regardless.
        _s3_inc("bronze_s3_write_failures_total")
        logger.error(
            "s3_raw_writer: S3 write FAILED (non-fatal) bucket=%r key=%r "
            "workspace_id=%r vendor=%r idempotency_key=%r error=%s",
            bucket, key, workspace_id, vendor, idempotency_key,
            type(exc).__name__,
        )
        return False


# ---------------------------------------------------------------------------
# Local-dir write helper
# ---------------------------------------------------------------------------

def _write_local(
    base_dir: str,
    key: str,
    compressed: bytes,
    workspace_id: str,
    vendor: str,
    idempotency_key: str,
) -> bool:
    """Write compressed bytes to a local directory tree (minio-compatible layout)."""
    import pathlib

    try:
        full_path = pathlib.Path(base_dir) / key
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_bytes(compressed)
        _s3_inc("bronze_s3_writes_total")
        logger.debug(
            "s3_raw_writer: local write ok path=%r workspace_id=%r vendor=%r",
            str(full_path), workspace_id, vendor,
        )
        return True
    except Exception as exc:
        _s3_inc("bronze_s3_write_failures_total")
        logger.error(
            "s3_raw_writer: local write FAILED (non-fatal) path=%r "
            "workspace_id=%r vendor=%r idempotency_key=%r error=%s",
            str(pathlib.Path(base_dir) / key),
            workspace_id, vendor, idempotency_key,
            type(exc).__name__,
        )
        return False


# ---------------------------------------------------------------------------
# Boto3 client factory (lazy)
# ---------------------------------------------------------------------------

_boto3_s3_client: Any = None


def _get_boto3_s3_client() -> Any:
    """Lazily build and cache a boto3 S3 client for ap-south-1."""
    global _boto3_s3_client
    if _boto3_s3_client is None:
        import boto3  # noqa: PLC0415
        _boto3_s3_client = boto3.client("s3", region_name="ap-south-1")
    return _boto3_s3_client
