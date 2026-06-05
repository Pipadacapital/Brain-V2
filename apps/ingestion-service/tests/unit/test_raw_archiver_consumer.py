"""
Unit tests for P0-C: raw_archiver_consumer.py

@paradigm: sql (unit tests; no real CH, no real Kafka, no LLM)

Coverage:
  Positive scenarios:
    - Valid envelope parses to ParsedEnvelope with all fields populated
    - customer_ref / lawful_basis / purpose_code populated from envelope
    - CH row dict has all required columns (0010 + 0012 schema)
    - process_message: CH insert called with correct row; returns True on success
    - process_message: S3 failure does NOT block CH success (returns True)
    - process_message: exactly 1 bronze row produced per message
    - Consumer counter increments on CH insert

  Negative scenarios:
    - Missing required field raises ValueError (parse error → poison skip)
    - Empty workspace_id raises ValueError
    - CH insert failure → process_message raises (offset not committed)
    - CH insert failure increments bronze_archiver_ch_failures_total
    - BRONZE_RAW_ARCHIVER=false → start_raw_archiver_consumer is a no-op
    - Malformed JSON raises ValueError (poison message)
    - customer_ref extracted from payload if not in envelope top-level

  Flag tests:
    - _archiver_enabled() returns False when env var is absent
    - _archiver_enabled() returns True when env var is 'true'

  BACKUP cron tests (Amendment 5 — day-zero criterion):
    - build_backup_command with S3_BRONZE_BUCKET → correct S3 SQL
    - build_backup_command with CLICKHOUSE_BACKUP_LOCAL_DIR → correct File SQL
    - run_bronze_backup with mock CH client succeeds
    - run_bronze_backup increments bronze_backup_success_total on success
    - run_bronze_backup increments bronze_backup_failure_total on CH error
    - run_bronze_backup returns True when flag is OFF (skipped, not failed)
    - backup cron file EXISTS at the expected path (Amendment 5 day-zero check)
"""

from __future__ import annotations

import importlib
import json
import os
import pathlib
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch, call

import pytest

# Import the modules under test
from interfaces.consumers.raw_archiver_consumer import (
    ParsedEnvelope,
    parse_envelope,
    _build_ch_row,
    _archiver_enabled,
    process_message,
    get_archiver_counters,
    reset_archiver_counters,
    GROUP_ID,
)
from interfaces.cron.bronze_backup_cron import (
    build_backup_command,
    run_bronze_backup,
    get_backup_counters,
    reset_backup_counters,
    _backup_enabled,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def reset_counters():
    """Reset all in-process counters before each test."""
    reset_archiver_counters()
    reset_backup_counters()
    yield
    reset_archiver_counters()
    reset_backup_counters()


def _make_envelope(
    workspace_id: str = "ws-123",
    vendor: str = "SHOPIFY",
    vendor_event_id: str = "order-456",
    event_type: str = "order",
    ingested_at: str = "2026-06-05T07:00:00.000+00:00",
    payload: str | None = None,
    customer_ref: str = "tok:abc123",
    lawful_basis: str = "legitimate_interest",
    purpose_code: str = "analytics_performance",
    trace_id: str = "trace-001",
    request_id: str = "req-001",
) -> bytes:
    """Build a valid Kafka envelope bytes."""
    if payload is None:
        payload = json.dumps({"order_id": "456", "total_price": "999.00"})
    env = {
        "workspace_id": workspace_id,
        "vendor": vendor,
        "vendor_event_id": vendor_event_id,
        "event_type": event_type,
        "occurred_at": "2026-06-05T06:59:00.000+00:00",
        "ingested_at": ingested_at,
        "payload": payload,
        "payload_version": "shopify-2024-10",
        "customer_ref": customer_ref,
        "lawful_basis": lawful_basis,
        "purpose_code": purpose_code,
        "trace_id": trace_id,
        "request_id": request_id,
        "salt_version": "v1",
    }
    return json.dumps(env).encode("utf-8")


# ---------------------------------------------------------------------------
# Feature flag tests
# ---------------------------------------------------------------------------

class TestArchiverFlag:
    def test_disabled_by_default(self, monkeypatch):
        monkeypatch.delenv("BRONZE_RAW_ARCHIVER", raising=False)
        assert _archiver_enabled() is False

    def test_enabled_when_true(self, monkeypatch):
        monkeypatch.setenv("BRONZE_RAW_ARCHIVER", "true")
        assert _archiver_enabled() is True

    def test_enabled_case_insensitive(self, monkeypatch):
        monkeypatch.setenv("BRONZE_RAW_ARCHIVER", "TRUE")
        assert _archiver_enabled() is True

    def test_disabled_when_false(self, monkeypatch):
        monkeypatch.setenv("BRONZE_RAW_ARCHIVER", "false")
        assert _archiver_enabled() is False

    def test_disabled_when_unrecognized(self, monkeypatch):
        monkeypatch.setenv("BRONZE_RAW_ARCHIVER", "yes")
        assert _archiver_enabled() is False  # only 'true' is accepted


# ---------------------------------------------------------------------------
# Parse envelope tests
# ---------------------------------------------------------------------------

class TestParseEnvelope:
    def test_valid_envelope_parsed_correctly(self):
        raw = _make_envelope()
        env = parse_envelope(raw)
        assert isinstance(env, ParsedEnvelope)
        assert env.workspace_id == "ws-123"
        assert env.vendor == "SHOPIFY"
        assert env.vendor_event_id == "order-456"
        assert env.event_type == "order"
        assert env.customer_ref == "tok:abc123"
        assert env.lawful_basis == "legitimate_interest"
        assert env.purpose_code == "analytics_performance"
        assert env.trace_id == "trace-001"
        assert env.request_id == "req-001"
        assert isinstance(env.received_at, datetime)
        assert env.received_at.tzinfo is not None  # tz-aware

    def test_received_at_is_utc(self):
        raw = _make_envelope(ingested_at="2026-06-05T07:00:00.000+00:00")
        env = parse_envelope(raw)
        assert env.received_at.year == 2026
        assert env.received_at.month == 6

    def test_event_at_optional_parsed(self):
        raw = _make_envelope()
        env = parse_envelope(raw)
        assert env.event_at is not None  # occurred_at is set in _make_envelope

    def test_missing_workspace_id_raises(self):
        envelope_dict = json.loads(_make_envelope().decode())
        envelope_dict["workspace_id"] = ""
        with pytest.raises(ValueError, match="missing required field"):
            parse_envelope(json.dumps(envelope_dict).encode())

    def test_missing_vendor_raises(self):
        envelope_dict = json.loads(_make_envelope().decode())
        del envelope_dict["vendor"]
        with pytest.raises(ValueError, match="missing required field"):
            parse_envelope(json.dumps(envelope_dict).encode())

    def test_missing_payload_raises(self):
        envelope_dict = json.loads(_make_envelope().decode())
        del envelope_dict["payload"]
        with pytest.raises(ValueError, match="missing required field"):
            parse_envelope(json.dumps(envelope_dict).encode())

    def test_malformed_json_raises(self):
        with pytest.raises(ValueError, match="JSON decode failed"):
            parse_envelope(b"not-json-at-all")

    def test_invalid_ingested_at_raises(self):
        envelope_dict = json.loads(_make_envelope().decode())
        envelope_dict["ingested_at"] = "not-a-date"
        with pytest.raises(ValueError):
            parse_envelope(json.dumps(envelope_dict).encode())

    def test_customer_ref_fallback_from_payload(self):
        """customer_ref extracted from payload columns if not in top-level."""
        payload = json.dumps({"customer_ref": "tok:from-payload", "order_id": "789"})
        envelope_dict = json.loads(_make_envelope(payload=payload).decode())
        del envelope_dict["customer_ref"]  # not in top-level
        env = parse_envelope(json.dumps(envelope_dict).encode())
        assert env.customer_ref == "tok:from-payload"

    def test_empty_optional_fields_default(self):
        """Missing optional fields default to empty string, not None."""
        envelope_dict = json.loads(_make_envelope().decode())
        del envelope_dict["customer_ref"]
        del envelope_dict["lawful_basis"]
        del envelope_dict["purpose_code"]
        env = parse_envelope(json.dumps(envelope_dict).encode())
        assert env.customer_ref == ""
        assert env.lawful_basis == ""
        assert env.purpose_code == ""

    def test_raw_bytes_preserved(self):
        """raw_bytes field holds original message bytes for S3 write."""
        raw = _make_envelope()
        env = parse_envelope(raw)
        assert env.raw_bytes == raw


# ---------------------------------------------------------------------------
# CH row builder tests
# ---------------------------------------------------------------------------

class TestBuildChRow:
    def test_ch_row_has_all_schema_columns(self):
        raw = _make_envelope()
        env = parse_envelope(raw)
        row = _build_ch_row(env)

        # 0010 columns
        assert "workspace_id" in row
        assert "vendor" in row
        assert "event_type" in row
        assert "idempotency_key" in row
        assert "received_at" in row
        assert "payload" in row
        assert "payload_version" in row
        assert "ingested_at" in row

        # 0012 columns (P0-B customer_ref + consent)
        assert "customer_ref" in row
        assert "lawful_basis" in row
        assert "purpose_code" in row

    def test_idempotency_key_is_vendor_event_id(self):
        raw = _make_envelope(vendor_event_id="order-999")
        env = parse_envelope(raw)
        row = _build_ch_row(env)
        assert row["idempotency_key"] == "order-999"

    def test_customer_ref_populated(self):
        raw = _make_envelope(customer_ref="tok:my-token")
        env = parse_envelope(raw)
        row = _build_ch_row(env)
        assert row["customer_ref"] == "tok:my-token"

    def test_lawful_basis_populated(self):
        raw = _make_envelope(lawful_basis="consent")
        env = parse_envelope(raw)
        row = _build_ch_row(env)
        assert row["lawful_basis"] == "consent"

    def test_purpose_code_populated(self):
        raw = _make_envelope(purpose_code="crm_personalisation")
        env = parse_envelope(raw)
        row = _build_ch_row(env)
        assert row["purpose_code"] == "crm_personalisation"

    def test_received_at_is_datetime_object(self):
        """received_at should be a Python datetime object (clickhouse_connect handles type mapping)."""
        raw = _make_envelope()
        env = parse_envelope(raw)
        row = _build_ch_row(env)
        from datetime import datetime as dt
        assert isinstance(row["received_at"], dt)
        assert row["received_at"].year == 2026
        assert row["received_at"].month == 6

    def test_ingested_at_is_datetime_object(self):
        """ingested_at should be a Python datetime object (CH DateTime column)."""
        raw = _make_envelope()
        env = parse_envelope(raw)
        row = _build_ch_row(env)
        from datetime import datetime as dt
        assert isinstance(row["ingested_at"], dt)


# ---------------------------------------------------------------------------
# process_message tests
# ---------------------------------------------------------------------------

class TestProcessMessage:
    @pytest.mark.asyncio
    async def test_ch_insert_called_with_correct_columns(self):
        """CH insert is called with the 0010+0012 column set."""
        mock_ch = MagicMock()
        raw = _make_envelope(customer_ref="tok:cref", lawful_basis="consent")

        result = await process_message(raw, ch_client=mock_ch, s3_client=None)

        assert result is True
        assert mock_ch.insert.call_count == 1
        # Verify the call args
        call_args = mock_ch.insert.call_args
        table = call_args[0][0]
        data = call_args[1]["data"][0] if call_args[1] else call_args[0][1][0]
        col_names = call_args[1]["column_names"] if call_args[1] else call_args[0][2]

        assert table == "brain.connector_raw_events"
        assert "customer_ref" in col_names
        assert "lawful_basis" in col_names
        assert "purpose_code" in col_names

    @pytest.mark.asyncio
    async def test_exactly_one_bronze_row_per_message(self):
        """Produce 1 message → exactly 1 CH insert call."""
        mock_ch = MagicMock()
        raw = _make_envelope()

        await process_message(raw, ch_client=mock_ch)

        # Exactly 1 insert (1 message → 1 row)
        assert mock_ch.insert.call_count == 1

    @pytest.mark.asyncio
    async def test_s3_failure_does_not_block_ch_success(self, monkeypatch):
        """S3 write failure is non-fatal; process_message returns True."""
        monkeypatch.setenv("BRONZE_RAW_ARCHIVER", "true")
        monkeypatch.setenv("S3_BRONZE_BUCKET", "test-bucket")

        mock_ch = MagicMock()
        # S3 client that raises
        mock_s3 = MagicMock()
        mock_s3.put_object.side_effect = Exception("S3 timeout")

        raw = _make_envelope()
        result = await process_message(raw, ch_client=mock_ch, s3_client=mock_s3)

        # CH succeeded, S3 failed → still True
        assert result is True
        assert mock_ch.insert.call_count == 1
        counters = get_archiver_counters()
        assert counters["bronze_archiver_ch_inserts_total"] == 1
        assert counters["bronze_archiver_s3_failures_total"] == 1

    @pytest.mark.asyncio
    async def test_ch_failure_raises_and_increments_counter(self):
        """CH insert failure raises (caller should not commit offset)."""
        mock_ch = MagicMock()
        mock_ch.insert.side_effect = Exception("CH connection reset")

        raw = _make_envelope()
        with pytest.raises(Exception, match="CH connection reset"):
            await process_message(raw, ch_client=mock_ch)

        counters = get_archiver_counters()
        assert counters["bronze_archiver_ch_failures_total"] == 1
        assert counters["bronze_archiver_ch_inserts_total"] == 0

    @pytest.mark.asyncio
    async def test_parse_error_raises_value_error(self):
        """Malformed message raises ValueError (poison message path)."""
        mock_ch = MagicMock()
        with pytest.raises(ValueError):
            await process_message(b"not-json", ch_client=mock_ch)
        # CH should NOT be called on parse error
        assert mock_ch.insert.call_count == 0

    @pytest.mark.asyncio
    async def test_messages_consumed_counter_increments(self):
        """bronze_archiver_messages_consumed_total increments per message."""
        mock_ch = MagicMock()
        await process_message(_make_envelope(), ch_client=mock_ch)
        await process_message(_make_envelope(vendor_event_id="order-2"), ch_client=mock_ch)
        counters = get_archiver_counters()
        assert counters["bronze_archiver_messages_consumed_total"] == 2

    @pytest.mark.asyncio
    async def test_vendor_meta_envelope_processed(self):
        """Meta vendor envelope is processed the same as Shopify."""
        mock_ch = MagicMock()
        raw = _make_envelope(vendor="META", vendor_event_id="campaign-001", event_type="ad_daily")
        result = await process_message(raw, ch_client=mock_ch)
        assert result is True
        call_args = mock_ch.insert.call_args
        table = call_args[0][0]
        assert table == "brain.connector_raw_events"


# ---------------------------------------------------------------------------
# Consumer group ID test
# ---------------------------------------------------------------------------

class TestConsumerGroupId:
    def test_group_id_distinct_from_facts_consumer(self):
        """The archiver group ID is distinct from the bespoke Shopify facts consumer."""
        assert GROUP_ID == "brain-bronze-archiver"
        assert GROUP_ID != "brain-facts-consumer"


# ---------------------------------------------------------------------------
# BACKUP cron tests (Amendment 5)
# ---------------------------------------------------------------------------

class TestBackupCron:
    def test_backup_cron_file_exists(self):
        """Amendment 5: the daily backup cron file must exist at the expected path."""
        cron_path = (
            pathlib.Path(__file__).parent.parent.parent
            / "src" / "interfaces" / "cron" / "bronze_backup_cron.py"
        )
        assert cron_path.exists(), (
            f"bronze_backup_cron.py not found at {cron_path}. "
            "Amendment 5 requires the BACKUP cron to exist from day zero of P0-C."
        )

    def test_backup_disabled_by_default(self, monkeypatch):
        monkeypatch.delenv("BRONZE_RAW_ARCHIVER", raising=False)
        monkeypatch.delenv("BRONZE_BACKUP_ENABLED", raising=False)
        assert _backup_enabled() is False

    def test_backup_enabled_when_archiver_on(self, monkeypatch):
        monkeypatch.setenv("BRONZE_RAW_ARCHIVER", "true")
        assert _backup_enabled() is True

    def test_backup_enabled_via_override(self, monkeypatch):
        monkeypatch.delenv("BRONZE_RAW_ARCHIVER", raising=False)
        monkeypatch.setenv("BRONZE_BACKUP_ENABLED", "true")
        assert _backup_enabled() is True

    def test_build_backup_command_s3(self, monkeypatch):
        monkeypatch.setenv("S3_BRONZE_BUCKET", "brain-bronze-backup")
        monkeypatch.setenv("S3_ENDPOINT_URL", "https://s3.ap-south-1.amazonaws.com")
        monkeypatch.setenv("S3_ACCESS_KEY_ID", "AKIA_TEST")
        monkeypatch.setenv("S3_SECRET_ACCESS_KEY", "secret_test")
        monkeypatch.delenv("CLICKHOUSE_BACKUP_LOCAL_DIR", raising=False)

        cmd = build_backup_command("2026-06-05")
        assert "BACKUP TABLE brain.connector_raw_events" in cmd
        assert "TO S3(" in cmd
        assert "brain-bronze-backup" in cmd
        assert "2026-06-05" in cmd
        assert "AKIA_TEST" in cmd

    def test_build_backup_command_local_dir(self, monkeypatch, tmp_path):
        monkeypatch.setenv("CLICKHOUSE_BACKUP_LOCAL_DIR", str(tmp_path))

        cmd = build_backup_command("2026-06-05")
        assert "BACKUP TABLE brain.connector_raw_events" in cmd
        assert "TO File(" in cmd
        assert "2026-06-05" in cmd
        assert str(tmp_path) in cmd

    def test_build_backup_command_missing_bucket_raises(self, monkeypatch):
        monkeypatch.delenv("S3_BRONZE_BUCKET", raising=False)
        monkeypatch.delenv("CLICKHOUSE_BACKUP_LOCAL_DIR", raising=False)
        with pytest.raises(ValueError, match="S3_BRONZE_BUCKET is not set"):
            build_backup_command("2026-06-05")

    @pytest.mark.asyncio
    async def test_run_backup_success(self, monkeypatch):
        monkeypatch.setenv("BRONZE_RAW_ARCHIVER", "true")
        monkeypatch.setenv("CLICKHOUSE_BACKUP_LOCAL_DIR", "/tmp/test-backup")

        mock_ch = MagicMock()
        mock_ch.command.return_value = "BACKUP completed"

        result = await run_bronze_backup(ch_client=mock_ch, date_str="2026-06-05")

        assert result is True
        assert mock_ch.command.call_count == 1
        counters = get_backup_counters()
        assert counters["bronze_backup_success_total"] == 1
        assert counters["bronze_backup_failure_total"] == 0

    @pytest.mark.asyncio
    async def test_run_backup_increments_failure_on_ch_error(self, monkeypatch):
        monkeypatch.setenv("BRONZE_RAW_ARCHIVER", "true")
        monkeypatch.setenv("CLICKHOUSE_BACKUP_LOCAL_DIR", "/tmp/test-backup")

        mock_ch = MagicMock()
        mock_ch.command.side_effect = Exception("CH timeout")

        result = await run_bronze_backup(ch_client=mock_ch, date_str="2026-06-05")

        assert result is False
        counters = get_backup_counters()
        assert counters["bronze_backup_failure_total"] == 1
        assert counters["bronze_backup_success_total"] == 0

    @pytest.mark.asyncio
    async def test_run_backup_skipped_when_disabled(self, monkeypatch):
        """Backup returns True (not failure) when flag is OFF — it's a skip."""
        monkeypatch.delenv("BRONZE_RAW_ARCHIVER", raising=False)
        monkeypatch.delenv("BRONZE_BACKUP_ENABLED", raising=False)

        mock_ch = MagicMock()
        result = await run_bronze_backup(ch_client=mock_ch)

        assert result is True
        # No CH command was issued
        assert mock_ch.command.call_count == 0

    @pytest.mark.asyncio
    async def test_run_backup_sql_contains_date(self, monkeypatch):
        """The BACKUP command includes the date string."""
        monkeypatch.setenv("BRONZE_RAW_ARCHIVER", "true")
        monkeypatch.setenv("CLICKHOUSE_BACKUP_LOCAL_DIR", "/tmp/test-backup-date")

        mock_ch = MagicMock()
        mock_ch.command.return_value = "ok"

        await run_bronze_backup(ch_client=mock_ch, date_str="2026-06-05")

        sql_called = mock_ch.command.call_args[0][0]
        assert "2026-06-05" in sql_called
        assert "brain.connector_raw_events" in sql_called
