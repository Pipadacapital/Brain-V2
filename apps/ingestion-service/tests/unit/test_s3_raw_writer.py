"""
Unit tests for P0-C: s3_raw_writer.py

@paradigm: sql (unit tests; no real AWS, no real S3, no LLM)

Coverage:
  Positive scenarios:
    - build_s3_key produces correct path pattern
    - build_s3_key with UTC received_at uses correct year/month/day
    - write_to_s3 with flag OFF is a no-op (returns True, no calls)
    - write_to_s3 with flag ON + S3 bucket → calls s3_client.put_object
    - write_to_s3 with flag ON + local dir → writes bytes to local file
    - write_to_s3 success increments bronze_s3_writes_total
    - Compressed bytes are non-empty (compression works)

  Negative scenarios:
    - S3 write failure increments bronze_s3_write_failures_total
    - S3 write failure returns False (non-fatal — NOT an exception)
    - write_to_s3 with flag ON + no bucket configured → returns False (non-fatal)
    - Local dir write failure is non-fatal (returns False, not exception)
    - idempotency_key with '/' is sanitized in the S3 key (path traversal guard)
    - write_to_s3 NEVER raises — exceptions are caught internally
"""

from __future__ import annotations

import os
import pathlib
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from infrastructure.storage.s3_raw_writer import (
    build_s3_key,
    get_s3_counters,
    reset_s3_counters,
    write_to_s3,
    _zstd_compress,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def reset_counters():
    """Reset all in-process counters before each test."""
    reset_s3_counters()
    yield
    reset_s3_counters()


_RECEIVED_AT = datetime(2026, 6, 5, 7, 0, 0, tzinfo=timezone.utc)
_ENVELOPE_BYTES = b'{"workspace_id":"ws-1","payload":"test"}'


# ---------------------------------------------------------------------------
# Key construction tests
# ---------------------------------------------------------------------------

class TestBuildS3Key:
    def test_key_matches_expected_pattern(self):
        key = build_s3_key("ws-123", "SHOPIFY", _RECEIVED_AT, "order-456")
        assert key == "ws-123/SHOPIFY/2026/06/05/order-456.json.zst"

    def test_key_uses_utc_date(self):
        dt_utc = datetime(2026, 1, 9, 23, 59, 0, tzinfo=timezone.utc)
        key = build_s3_key("ws-1", "META", dt_utc, "campaign-1")
        assert "2026/01/09" in key

    def test_idempotency_key_slash_sanitized(self):
        """'/' in idempotency_key is replaced to prevent path traversal."""
        key = build_s3_key("ws-1", "SHOPIFY", _RECEIVED_AT, "shop/order/456")
        # No slashes in the filename part
        filename = key.split("/")[-1]
        assert "/" not in filename
        assert "_" in filename  # replaced with underscore

    def test_dotdot_sanitized(self):
        """'..' in idempotency_key is replaced."""
        key = build_s3_key("ws-1", "SHOPIFY", _RECEIVED_AT, "../etc/passwd")
        filename = key.split("/")[-1]
        assert ".." not in filename

    def test_key_ends_with_json_zst(self):
        key = build_s3_key("ws-1", "META", _RECEIVED_AT, "ad-123")
        assert key.endswith(".json.zst")


# ---------------------------------------------------------------------------
# Compression tests
# ---------------------------------------------------------------------------

class TestCompression:
    def test_compressed_bytes_non_empty(self):
        compressed = _zstd_compress(b"hello world")
        assert len(compressed) > 0

    def test_compressed_differs_from_input(self):
        data = b"x" * 1000
        compressed = _zstd_compress(data)
        # For repetitive data compression should actually compress
        assert compressed != data


# ---------------------------------------------------------------------------
# write_to_s3 flag-OFF tests
# ---------------------------------------------------------------------------

class TestWriteToS3FlagOff:
    @pytest.mark.asyncio
    async def test_noop_when_flag_off(self, monkeypatch):
        """write_to_s3 returns True without calling S3 when flag is OFF."""
        monkeypatch.setenv("BRONZE_RAW_ARCHIVER", "false")
        mock_s3 = MagicMock()

        result = await write_to_s3(
            workspace_id="ws-1",
            vendor="SHOPIFY",
            received_at=_RECEIVED_AT,
            idempotency_key="order-1",
            envelope_bytes=_ENVELOPE_BYTES,
            s3_client=mock_s3,
        )

        assert result is True
        assert mock_s3.put_object.call_count == 0
        counters = get_s3_counters()
        assert counters["bronze_s3_writes_total"] == 0

    @pytest.mark.asyncio
    async def test_noop_when_flag_absent(self, monkeypatch):
        monkeypatch.delenv("BRONZE_RAW_ARCHIVER", raising=False)
        mock_s3 = MagicMock()

        result = await write_to_s3(
            workspace_id="ws-1",
            vendor="SHOPIFY",
            received_at=_RECEIVED_AT,
            idempotency_key="order-1",
            envelope_bytes=_ENVELOPE_BYTES,
            s3_client=mock_s3,
        )
        assert result is True
        assert mock_s3.put_object.call_count == 0


# ---------------------------------------------------------------------------
# write_to_s3 S3 path tests (flag ON)
# ---------------------------------------------------------------------------

class TestWriteToS3RealPath:
    @pytest.mark.asyncio
    async def test_s3_put_object_called_with_correct_bucket_and_key(self, monkeypatch):
        monkeypatch.setenv("BRONZE_RAW_ARCHIVER", "true")
        monkeypatch.setenv("S3_BRONZE_BUCKET", "brain-bronze-test")
        monkeypatch.delenv("BRONZE_S3_LOCAL_DIR", raising=False)

        mock_s3 = MagicMock()
        await write_to_s3(
            workspace_id="ws-123",
            vendor="SHOPIFY",
            received_at=_RECEIVED_AT,
            idempotency_key="order-456",
            envelope_bytes=_ENVELOPE_BYTES,
            s3_client=mock_s3,
        )

        mock_s3.put_object.assert_called_once()
        call_kwargs = mock_s3.put_object.call_args.kwargs
        assert call_kwargs["Bucket"] == "brain-bronze-test"
        assert "ws-123/SHOPIFY/2026/06/05/order-456.json.zst" == call_kwargs["Key"]

    @pytest.mark.asyncio
    async def test_s3_success_increments_counter(self, monkeypatch):
        monkeypatch.setenv("BRONZE_RAW_ARCHIVER", "true")
        monkeypatch.setenv("S3_BRONZE_BUCKET", "test-bucket")
        monkeypatch.delenv("BRONZE_S3_LOCAL_DIR", raising=False)

        mock_s3 = MagicMock()
        result = await write_to_s3(
            workspace_id="ws-1",
            vendor="META",
            received_at=_RECEIVED_AT,
            idempotency_key="campaign-1",
            envelope_bytes=_ENVELOPE_BYTES,
            s3_client=mock_s3,
        )

        assert result is True
        counters = get_s3_counters()
        assert counters["bronze_s3_writes_total"] == 1
        assert counters["bronze_s3_write_failures_total"] == 0

    @pytest.mark.asyncio
    async def test_s3_failure_returns_false_not_raises(self, monkeypatch):
        """S3 failure is NON-FATAL — returns False, never raises."""
        monkeypatch.setenv("BRONZE_RAW_ARCHIVER", "true")
        monkeypatch.setenv("S3_BRONZE_BUCKET", "test-bucket")
        monkeypatch.delenv("BRONZE_S3_LOCAL_DIR", raising=False)

        mock_s3 = MagicMock()
        mock_s3.put_object.side_effect = ConnectionError("S3 unreachable")

        # Must NOT raise — non-fatal contract
        result = await write_to_s3(
            workspace_id="ws-1",
            vendor="SHOPIFY",
            received_at=_RECEIVED_AT,
            idempotency_key="order-1",
            envelope_bytes=_ENVELOPE_BYTES,
            s3_client=mock_s3,
        )

        assert result is False
        counters = get_s3_counters()
        assert counters["bronze_s3_write_failures_total"] == 1
        assert counters["bronze_s3_writes_total"] == 0

    @pytest.mark.asyncio
    async def test_missing_bucket_returns_false(self, monkeypatch):
        """Flag ON but no bucket → non-fatal False, not exception."""
        monkeypatch.setenv("BRONZE_RAW_ARCHIVER", "true")
        monkeypatch.delenv("S3_BRONZE_BUCKET", raising=False)
        monkeypatch.delenv("BRONZE_S3_LOCAL_DIR", raising=False)

        result = await write_to_s3(
            workspace_id="ws-1",
            vendor="SHOPIFY",
            received_at=_RECEIVED_AT,
            idempotency_key="order-1",
            envelope_bytes=_ENVELOPE_BYTES,
        )

        assert result is False
        counters = get_s3_counters()
        assert counters["bronze_s3_write_failures_total"] == 1


# ---------------------------------------------------------------------------
# write_to_s3 local-dir path tests
# ---------------------------------------------------------------------------

class TestWriteToS3LocalDir:
    @pytest.mark.asyncio
    async def test_local_dir_write_creates_file(self, monkeypatch, tmp_path):
        monkeypatch.setenv("BRONZE_RAW_ARCHIVER", "true")
        monkeypatch.setenv("BRONZE_S3_LOCAL_DIR", str(tmp_path))
        monkeypatch.delenv("S3_BRONZE_BUCKET", raising=False)

        result = await write_to_s3(
            workspace_id="ws-1",
            vendor="SHOPIFY",
            received_at=_RECEIVED_AT,
            idempotency_key="order-1",
            envelope_bytes=_ENVELOPE_BYTES,
        )

        assert result is True
        expected_path = tmp_path / "ws-1" / "SHOPIFY" / "2026" / "06" / "05" / "order-1.json.zst"
        assert expected_path.exists()

    @pytest.mark.asyncio
    async def test_local_dir_write_success_increments_counter(self, monkeypatch, tmp_path):
        monkeypatch.setenv("BRONZE_RAW_ARCHIVER", "true")
        monkeypatch.setenv("BRONZE_S3_LOCAL_DIR", str(tmp_path))

        await write_to_s3(
            workspace_id="ws-1",
            vendor="META",
            received_at=_RECEIVED_AT,
            idempotency_key="ad-1",
            envelope_bytes=_ENVELOPE_BYTES,
        )

        counters = get_s3_counters()
        assert counters["bronze_s3_writes_total"] == 1
        assert counters["bronze_s3_write_failures_total"] == 0

    @pytest.mark.asyncio
    async def test_local_dir_failure_is_non_fatal(self, monkeypatch):
        """Unwritable local dir returns False, not exception."""
        monkeypatch.setenv("BRONZE_RAW_ARCHIVER", "true")
        # Use a path under a non-existent root with no create perms
        monkeypatch.setenv("BRONZE_S3_LOCAL_DIR", "/proc/nonexistent_brain_test_dir")

        # This will fail to create the directory but must not raise
        result = await write_to_s3(
            workspace_id="ws-1",
            vendor="SHOPIFY",
            received_at=_RECEIVED_AT,
            idempotency_key="order-1",
            envelope_bytes=_ENVELOPE_BYTES,
        )

        assert result is False
        counters = get_s3_counters()
        assert counters["bronze_s3_write_failures_total"] == 1
