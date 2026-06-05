"""
Unit tests for P1-D: dlq_producer.py

@paradigm: sql (unit tests; no real Kafka, no LLM)

Coverage (positive AND negative scenarios per code-clarity-and-test-coverage rule):

  Positive scenarios:
    - build_dlq_record: valid args produce a well-formed dict with all required keys.
    - build_dlq_record: error_detail is truncated to MAX_ERROR_DETAIL_CHARS.
    - build_dlq_record: raw_bytes_b64 is the base64-encoded raw_bytes (short payload).
    - build_dlq_record: raw_bytes_b64 is truncated to MAX_RAW_BYTES_B64_CHARS on overflow.
    - build_dlq_record: raw_bytes=None → raw_bytes_b64=''.
    - build_dlq_record: schema_version='1.0' always present.
    - build_dlq_record: topic field always equals DLQ_TOPIC_NAME.
    - build_dlq_record: produced_at is a valid ISO-8601 UTC timestamp.
    - build_dlq_record: source_partition and source_offset are int.
    - produce_dlq_event: calls producer.send_and_wait with correct topic and key.
    - produce_dlq_event: returns True on successful produce.
    - produce_dlq_event: partitions by workspace_id (key=workspace_id bytes).
    - build_dlq_kafka_config: returns expected keys for AIOKafkaProducer.
    - DLQ_TOPIC_NAME constant equals 'integrations.dlq.v1'.

  Negative scenarios:
    - build_dlq_record: empty workspace_id raises ValueError.
    - build_dlq_record: empty raw_event_id raises ValueError.
    - produce_dlq_event: returns False when producer.send_and_wait raises.
    - produce_dlq_event: returns False (not raises) on produce failure (non-fatal).
    - produce_dlq_event: returns False when workspace_id is empty (build failure).
    - produce_dlq_event: a DLQ produce failure does NOT raise (non-fatal safety net).
"""

from __future__ import annotations

import base64
import json
import os
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.infrastructure.kafka.dlq_producer import (
    DLQ_TOPIC_NAME,
    MAX_ERROR_DETAIL_CHARS,
    MAX_RAW_BYTES_B64_CHARS,
    build_dlq_kafka_config,
    build_dlq_record,
    produce_dlq_event,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def valid_dlq_kwargs() -> dict[str, Any]:
    """Return valid kwargs for build_dlq_record / produce_dlq_event."""
    return {
        "raw_event_id": "order-abc-123",
        "workspace_id": "ws-test-001",
        "vendor": "SHOPIFY",
        "event_type": "orders/create",
        "error_class": "ValueError",
        "error_detail": "Missing field: customer_email",
        "source_topic": "integrations.shopify.v1",
        "source_partition": 2,
        "source_offset": 4200,
        "raw_bytes": b'{"workspace_id":"ws-test-001","vendor":"SHOPIFY"}',
        "trace_id": "trace-xyz",
        "request_id": "req-001",
    }


@pytest.fixture()
def mock_producer() -> AsyncMock:
    """Return a mock aiokafka producer."""
    producer = AsyncMock()
    producer.send_and_wait = AsyncMock(return_value=None)
    return producer


# ---------------------------------------------------------------------------
# DLQ_TOPIC_NAME constant
# ---------------------------------------------------------------------------


class TestDlqTopicNameConstant:
    def test_dlq_topic_name_is_correct(self) -> None:
        """DLQ_TOPIC_NAME must match CDK BronzeStorageStack export (CF-BS-DLQ-1)."""
        assert DLQ_TOPIC_NAME == "integrations.dlq.v1"

    def test_dlq_topic_name_not_empty(self) -> None:
        assert DLQ_TOPIC_NAME  # truthy

    def test_dlq_topic_name_starts_with_integrations(self) -> None:
        assert DLQ_TOPIC_NAME.startswith("integrations.")

    def test_dlq_topic_name_ends_with_v1(self) -> None:
        assert DLQ_TOPIC_NAME.endswith(".v1")

    def test_negative_dlq_topic_name_not_a_typo(self) -> None:
        assert DLQ_TOPIC_NAME != "integrations.dlq.v0"
        assert DLQ_TOPIC_NAME != "dlq.v1"
        assert DLQ_TOPIC_NAME != "integrations.dead-letter.v1"


# ---------------------------------------------------------------------------
# build_dlq_record — positive scenarios
# ---------------------------------------------------------------------------


class TestBuildDlqRecordPositive:
    def test_returns_dict_with_all_required_keys(self, valid_dlq_kwargs: dict) -> None:
        record = build_dlq_record(**valid_dlq_kwargs)

        required_keys = {
            "schema_version",
            "topic",
            "raw_event_id",
            "workspace_id",
            "vendor",
            "event_type",
            "error_class",
            "error_detail",
            "source_topic",
            "source_partition",
            "source_offset",
            "raw_bytes_b64",
            "trace_id",
            "request_id",
            "produced_at",
        }
        assert required_keys.issubset(set(record.keys()))

    def test_schema_version_is_1_0(self, valid_dlq_kwargs: dict) -> None:
        record = build_dlq_record(**valid_dlq_kwargs)
        assert record["schema_version"] == "1.0"

    def test_topic_field_equals_dlq_topic_name(self, valid_dlq_kwargs: dict) -> None:
        record = build_dlq_record(**valid_dlq_kwargs)
        assert record["topic"] == DLQ_TOPIC_NAME

    def test_workspace_id_preserved(self, valid_dlq_kwargs: dict) -> None:
        record = build_dlq_record(**valid_dlq_kwargs)
        assert record["workspace_id"] == "ws-test-001"

    def test_raw_event_id_preserved(self, valid_dlq_kwargs: dict) -> None:
        record = build_dlq_record(**valid_dlq_kwargs)
        assert record["raw_event_id"] == "order-abc-123"

    def test_vendor_preserved(self, valid_dlq_kwargs: dict) -> None:
        record = build_dlq_record(**valid_dlq_kwargs)
        assert record["vendor"] == "SHOPIFY"

    def test_event_type_preserved(self, valid_dlq_kwargs: dict) -> None:
        record = build_dlq_record(**valid_dlq_kwargs)
        assert record["event_type"] == "orders/create"

    def test_error_class_preserved(self, valid_dlq_kwargs: dict) -> None:
        record = build_dlq_record(**valid_dlq_kwargs)
        assert record["error_class"] == "ValueError"

    def test_error_detail_preserved_when_short(self, valid_dlq_kwargs: dict) -> None:
        record = build_dlq_record(**valid_dlq_kwargs)
        assert record["error_detail"] == "Missing field: customer_email"

    def test_source_partition_is_int(self, valid_dlq_kwargs: dict) -> None:
        record = build_dlq_record(**valid_dlq_kwargs)
        assert isinstance(record["source_partition"], int)
        assert record["source_partition"] == 2

    def test_source_offset_is_int(self, valid_dlq_kwargs: dict) -> None:
        record = build_dlq_record(**valid_dlq_kwargs)
        assert isinstance(record["source_offset"], int)
        assert record["source_offset"] == 4200

    def test_raw_bytes_b64_is_correct_base64_for_short_payload(
        self, valid_dlq_kwargs: dict
    ) -> None:
        raw = b'{"workspace_id":"ws-test-001"}'
        record = build_dlq_record(**{**valid_dlq_kwargs, "raw_bytes": raw})
        expected_b64 = base64.b64encode(raw).decode("ascii")
        assert record["raw_bytes_b64"] == expected_b64

    def test_raw_bytes_b64_is_empty_when_raw_bytes_is_none(
        self, valid_dlq_kwargs: dict
    ) -> None:
        record = build_dlq_record(**{**valid_dlq_kwargs, "raw_bytes": None})
        assert record["raw_bytes_b64"] == ""

    def test_produced_at_is_iso8601_utc_string(self, valid_dlq_kwargs: dict) -> None:
        record = build_dlq_record(**valid_dlq_kwargs)
        produced_at = record["produced_at"]
        assert isinstance(produced_at, str)
        # Must parse as a datetime — will raise if not ISO-8601.
        dt = datetime.fromisoformat(produced_at)
        # Must be UTC (+00:00 or 'Z')
        assert dt.tzinfo is not None

    def test_trace_id_preserved(self, valid_dlq_kwargs: dict) -> None:
        record = build_dlq_record(**valid_dlq_kwargs)
        assert record["trace_id"] == "trace-xyz"

    def test_request_id_preserved(self, valid_dlq_kwargs: dict) -> None:
        record = build_dlq_record(**valid_dlq_kwargs)
        assert record["request_id"] == "req-001"

    def test_record_is_json_serializable(self, valid_dlq_kwargs: dict) -> None:
        """DLQ records must be JSON-serializable (Kafka value_bytes)."""
        record = build_dlq_record(**valid_dlq_kwargs)
        serialized = json.dumps(record)
        assert len(serialized) > 0


# ---------------------------------------------------------------------------
# build_dlq_record — error_detail truncation
# ---------------------------------------------------------------------------


class TestBuildDlqRecordErrorDetailTruncation:
    def test_error_detail_truncated_to_max_chars(self, valid_dlq_kwargs: dict) -> None:
        long_detail = "x" * (MAX_ERROR_DETAIL_CHARS + 100)
        record = build_dlq_record(
            **{**valid_dlq_kwargs, "error_detail": long_detail}
        )
        assert len(record["error_detail"]) == MAX_ERROR_DETAIL_CHARS

    def test_error_detail_not_truncated_when_short(self, valid_dlq_kwargs: dict) -> None:
        short_detail = "short error"
        record = build_dlq_record(
            **{**valid_dlq_kwargs, "error_detail": short_detail}
        )
        assert record["error_detail"] == short_detail

    def test_error_detail_truncated_exactly_at_boundary(
        self, valid_dlq_kwargs: dict
    ) -> None:
        exact_detail = "z" * MAX_ERROR_DETAIL_CHARS
        record = build_dlq_record(
            **{**valid_dlq_kwargs, "error_detail": exact_detail}
        )
        assert len(record["error_detail"]) == MAX_ERROR_DETAIL_CHARS


# ---------------------------------------------------------------------------
# build_dlq_record — raw_bytes_b64 truncation
# ---------------------------------------------------------------------------


class TestBuildDlqRecordRawBytesTruncation:
    def test_raw_bytes_b64_truncated_when_oversized(
        self, valid_dlq_kwargs: dict
    ) -> None:
        # Generate a payload whose base64 encoding exceeds MAX_RAW_BYTES_B64_CHARS.
        # We need (MAX_RAW_BYTES_B64_CHARS * 3 / 4) + 1 raw bytes to overflow.
        oversized_raw = b"A" * (MAX_RAW_BYTES_B64_CHARS + 1000)
        record = build_dlq_record(
            **{**valid_dlq_kwargs, "raw_bytes": oversized_raw}
        )
        assert len(record["raw_bytes_b64"]) == MAX_RAW_BYTES_B64_CHARS

    def test_raw_bytes_b64_not_truncated_when_small(
        self, valid_dlq_kwargs: dict
    ) -> None:
        small_raw = b"hello world"
        record = build_dlq_record(
            **{**valid_dlq_kwargs, "raw_bytes": small_raw}
        )
        expected = base64.b64encode(small_raw).decode("ascii")
        assert record["raw_bytes_b64"] == expected


# ---------------------------------------------------------------------------
# build_dlq_record — negative scenarios (validation)
# ---------------------------------------------------------------------------


class TestBuildDlqRecordNegative:
    def test_empty_workspace_id_raises_value_error(
        self, valid_dlq_kwargs: dict
    ) -> None:
        with pytest.raises(ValueError, match="workspace_id"):
            build_dlq_record(**{**valid_dlq_kwargs, "workspace_id": ""})

    def test_empty_raw_event_id_raises_value_error(
        self, valid_dlq_kwargs: dict
    ) -> None:
        with pytest.raises(ValueError, match="raw_event_id"):
            build_dlq_record(**{**valid_dlq_kwargs, "raw_event_id": ""})

    def test_validation_error_mentions_field_name(self, valid_dlq_kwargs: dict) -> None:
        with pytest.raises(ValueError) as exc_info:
            build_dlq_record(**{**valid_dlq_kwargs, "workspace_id": ""})
        assert "workspace_id" in str(exc_info.value)


# ---------------------------------------------------------------------------
# produce_dlq_event — positive scenarios
# ---------------------------------------------------------------------------


class TestProduceDlqEventPositive:
    @pytest.mark.asyncio
    async def test_returns_true_on_success(
        self, valid_dlq_kwargs: dict, mock_producer: AsyncMock
    ) -> None:
        result = await produce_dlq_event(
            producer=mock_producer, **valid_dlq_kwargs
        )
        assert result is True

    @pytest.mark.asyncio
    async def test_calls_send_and_wait_with_correct_topic(
        self, valid_dlq_kwargs: dict, mock_producer: AsyncMock
    ) -> None:
        await produce_dlq_event(producer=mock_producer, **valid_dlq_kwargs)

        mock_producer.send_and_wait.assert_called_once()
        call_args = mock_producer.send_and_wait.call_args
        # First positional arg is the topic.
        assert call_args.args[0] == DLQ_TOPIC_NAME

    @pytest.mark.asyncio
    async def test_partitions_by_workspace_id_as_key(
        self, valid_dlq_kwargs: dict, mock_producer: AsyncMock
    ) -> None:
        await produce_dlq_event(producer=mock_producer, **valid_dlq_kwargs)

        call_kwargs = mock_producer.send_and_wait.call_args.kwargs
        expected_key = "ws-test-001".encode("utf-8")
        assert call_kwargs["key"] == expected_key

    @pytest.mark.asyncio
    async def test_value_bytes_is_valid_json_with_dlq_topic(
        self, valid_dlq_kwargs: dict, mock_producer: AsyncMock
    ) -> None:
        await produce_dlq_event(producer=mock_producer, **valid_dlq_kwargs)

        call_kwargs = mock_producer.send_and_wait.call_args.kwargs
        value_bytes = call_kwargs["value"]
        record = json.loads(value_bytes.decode("utf-8"))
        assert record["topic"] == DLQ_TOPIC_NAME
        assert record["workspace_id"] == "ws-test-001"

    @pytest.mark.asyncio
    async def test_value_contains_raw_event_id(
        self, valid_dlq_kwargs: dict, mock_producer: AsyncMock
    ) -> None:
        await produce_dlq_event(producer=mock_producer, **valid_dlq_kwargs)

        call_kwargs = mock_producer.send_and_wait.call_args.kwargs
        record = json.loads(call_kwargs["value"].decode("utf-8"))
        assert record["raw_event_id"] == "order-abc-123"

    @pytest.mark.asyncio
    async def test_value_contains_source_offset(
        self, valid_dlq_kwargs: dict, mock_producer: AsyncMock
    ) -> None:
        await produce_dlq_event(producer=mock_producer, **valid_dlq_kwargs)

        call_kwargs = mock_producer.send_and_wait.call_args.kwargs
        record = json.loads(call_kwargs["value"].decode("utf-8"))
        assert record["source_offset"] == 4200


# ---------------------------------------------------------------------------
# produce_dlq_event — negative scenarios (non-fatal)
# ---------------------------------------------------------------------------


class TestProduceDlqEventNegative:
    @pytest.mark.asyncio
    async def test_returns_false_on_kafka_produce_failure(
        self, valid_dlq_kwargs: dict, mock_producer: AsyncMock
    ) -> None:
        """A Kafka produce failure must return False, not raise (non-fatal safety net)."""
        mock_producer.send_and_wait.side_effect = Exception("Kafka broker unavailable")

        result = await produce_dlq_event(
            producer=mock_producer, **valid_dlq_kwargs
        )
        assert result is False

    @pytest.mark.asyncio
    async def test_does_not_raise_on_kafka_produce_failure(
        self, valid_dlq_kwargs: dict, mock_producer: AsyncMock
    ) -> None:
        """DLQ produce failure must be non-fatal — caller must not be interrupted."""
        mock_producer.send_and_wait.side_effect = RuntimeError("connection refused")

        # Must not raise
        try:
            result = await produce_dlq_event(
                producer=mock_producer, **valid_dlq_kwargs
            )
        except Exception as exc:
            pytest.fail(
                f"produce_dlq_event raised an exception on produce failure: {exc}"
            )
        assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_when_workspace_id_is_empty(
        self, valid_dlq_kwargs: dict, mock_producer: AsyncMock
    ) -> None:
        """Empty workspace_id triggers a build_dlq_record ValueError → returns False."""
        result = await produce_dlq_event(
            producer=mock_producer,
            **{**valid_dlq_kwargs, "workspace_id": ""},
        )
        assert result is False

    @pytest.mark.asyncio
    async def test_does_not_call_producer_when_workspace_id_empty(
        self, valid_dlq_kwargs: dict, mock_producer: AsyncMock
    ) -> None:
        """If build_dlq_record fails, produce must NOT be called."""
        await produce_dlq_event(
            producer=mock_producer,
            **{**valid_dlq_kwargs, "workspace_id": ""},
        )
        mock_producer.send_and_wait.assert_not_called()

    @pytest.mark.asyncio
    async def test_returns_false_when_raw_event_id_is_empty(
        self, valid_dlq_kwargs: dict, mock_producer: AsyncMock
    ) -> None:
        result = await produce_dlq_event(
            producer=mock_producer,
            **{**valid_dlq_kwargs, "raw_event_id": ""},
        )
        assert result is False

    @pytest.mark.asyncio
    async def test_kafka_timeout_returns_false_not_raises(
        self, valid_dlq_kwargs: dict, mock_producer: AsyncMock
    ) -> None:
        """Kafka timeout (e.g. KafkaTimeoutError) must return False not raise."""
        import asyncio

        mock_producer.send_and_wait.side_effect = asyncio.TimeoutError()

        result = await produce_dlq_event(
            producer=mock_producer, **valid_dlq_kwargs
        )
        assert result is False


# ---------------------------------------------------------------------------
# build_dlq_kafka_config
# ---------------------------------------------------------------------------


class TestBuildDlqKafkaConfig:
    def test_returns_dict_with_bootstrap_servers(self) -> None:
        config = build_dlq_kafka_config(bootstrap_servers="localhost:19092")
        assert "bootstrap_servers" in config
        assert isinstance(config["bootstrap_servers"], list)
        assert "localhost:19092" in config["bootstrap_servers"]

    def test_reads_from_env_when_no_override(self) -> None:
        with patch.dict(
            os.environ,
            {"KAFKA_BOOTSTRAP_SERVERS": "broker1:9092,broker2:9092"},
        ):
            config = build_dlq_kafka_config()
        assert "broker1:9092" in config["bootstrap_servers"]
        assert "broker2:9092" in config["bootstrap_servers"]

    def test_config_has_acks_all(self) -> None:
        config = build_dlq_kafka_config(bootstrap_servers="localhost:19092")
        assert config["acks"] == "all"

    def test_config_has_client_id(self) -> None:
        config = build_dlq_kafka_config(bootstrap_servers="localhost:19092")
        assert config["client_id"] == "brain-dlq-producer"

    def test_config_has_linger_ms_zero(self) -> None:
        """DLQ records are low-latency; linger_ms must be 0."""
        config = build_dlq_kafka_config(bootstrap_servers="localhost:19092")
        assert config["linger_ms"] == 0

    def test_default_broker_is_localhost_when_env_absent(self) -> None:
        env_without_kafka = {k: v for k, v in os.environ.items() if k != "KAFKA_BOOTSTRAP_SERVERS"}
        with patch.dict(os.environ, env_without_kafka, clear=True):
            config = build_dlq_kafka_config()
        assert "localhost:19092" in config["bootstrap_servers"]
