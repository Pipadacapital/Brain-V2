"""Tests for brain_logger — the stdlib JSON logger + correlation + PII redaction.

The headline guarantee: output is ALWAYS valid JSON, even when the message (or a
field) contains the characters that broke the previous format-string approach.
"""

import json
import logging

import pytest

from brain_logger import (
    JsonFormatter,
    bind_correlation,
    clear_correlation,
    configure_logging,
    get_correlation,
    get_logger,
)


@pytest.fixture(autouse=True)
def _reset_correlation():
    clear_correlation()
    yield
    clear_correlation()


def _format(msg, *, args=(), level=logging.INFO, **extra):
    rec = logging.LogRecord("test.logger", level, __file__, 1, msg, args, None)
    for k, v in extra.items():
        setattr(rec, k, v)
    return json.loads(JsonFormatter("brain-test-service").format(rec))


# --- the core bug: invalid JSON on quotes/newlines ---------------------------

def test_message_with_double_quotes_is_valid_json():
    out = _format('he said "hello" to the db')
    assert out["msg"] == 'he said "hello" to the db'


def test_message_with_newline_is_valid_json():
    out = _format("line one\nline two\twith tab")
    assert out["msg"] == "line one\nline two\twith tab"


def test_printf_style_args_are_rendered():
    out = _format("ingested %d rows for %s", args=(12, "shopify"))
    assert out["msg"] == "ingested 12 rows for shopify"


# --- envelope fields ---------------------------------------------------------

def test_envelope_has_service_level_logger_ts():
    out = _format("hi", level=logging.WARNING)
    assert out["service"] == "brain-test-service"
    assert out["level"] == "WARNING"
    assert out["logger"] == "test.logger"
    assert out["ts"].endswith("+00:00")  # ISO-8601 UTC


# --- correlation -------------------------------------------------------------

def test_correlation_absent_when_unbound():
    out = _format("hi")
    assert "request_id" not in out and "trace_id" not in out and "workspace_id" not in out


def test_correlation_emitted_when_bound():
    bind_correlation(request_id="r1", trace_id="t1", workspace_id="ws1")
    assert get_correlation() == {"request_id": "r1", "trace_id": "t1", "workspace_id": "ws1"}
    out = _format("hi")
    assert out["request_id"] == "r1"
    assert out["trace_id"] == "t1"
    assert out["workspace_id"] == "ws1"


# --- PII redaction -----------------------------------------------------------

def test_pii_extra_fields_are_redacted():
    out = _format("customer seen", email="a@b.com", phone="+91999", raw_payload={"x": 1})
    assert out["email"] == "[REDACTED]"
    assert out["phone"] == "[REDACTED]"
    assert out["raw_payload"] == "[REDACTED]"


def test_non_pii_extra_fields_pass_through():
    out = _format("ingested", vendor="shopify", rows=12)
    assert out["vendor"] == "shopify"
    assert out["rows"] == 12


# --- exceptions --------------------------------------------------------------

def test_exception_info_is_serialized():
    try:
        raise ValueError("boom")
    except ValueError:
        rec = logging.LogRecord("t", logging.ERROR, __file__, 1, "failed", (), __import__("sys").exc_info())
    out = json.loads(JsonFormatter("svc").format(rec))
    assert "boom" in out["exc"]


# --- configure_logging end-to-end -------------------------------------------

def test_configure_logging_installs_json_formatter(capsys):
    configure_logging("brain-it", level="INFO")
    get_logger("it.test").info('quote " and newline\n here', extra={"rows": 3, "secret": "x"})
    line = capsys.readouterr().out.strip().splitlines()[-1]
    parsed = json.loads(line)  # must parse — the whole point
    assert parsed["service"] == "brain-it"
    assert parsed["rows"] == 3
    assert parsed["secret"] == "[REDACTED]"
