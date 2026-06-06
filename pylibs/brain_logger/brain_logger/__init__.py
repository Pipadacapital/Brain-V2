"""brain_logger — structured JSON logging + correlation for the Python services.

Counterpart to @brain/lib-logger (TS). stdlib-only (no structlog dependency):

  * A ``json.dumps``-based formatter that CANNOT break on quotes/newlines in the
    message — the previous hand-rolled ``format='{"msg":"%(message)s"}'`` string
    produced invalid JSON the moment a log message contained a ``"`` or ``\\n``,
    silently dropping lines in Fluent Bit / OpenSearch.
  * The correlation quad (request_id, trace_id, workspace_id) carried on
    contextvars and emitted on every line — the one id that ties HTTP -> gRPC ->
    Kafka -> LLM together.
  * PII redaction: known-sensitive keys in structured ``extra=`` fields are
    replaced with ``"[REDACTED]"`` before they reach a log sink.

Usage:
    from brain_logger import configure_logging, get_logger, bind_correlation
    configure_logging("brain-ingestion-service")          # once, at startup
    log = get_logger("ingestion.main")
    bind_correlation(request_id=rid, trace_id=tid, workspace_id=ws)  # per request
    log.info("event ingested", extra={"vendor": "shopify", "rows": 12})
"""

from __future__ import annotations

import contextvars
import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any

LOGGER_PACKAGE = "brain_logger"

# --- Correlation contextvars (shared across HTTP->gRPC->Kafka->LLM) ----------
_request_id: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="")
_trace_id: contextvars.ContextVar[str] = contextvars.ContextVar("trace_id", default="")
_workspace_id: contextvars.ContextVar[str] = contextvars.ContextVar("workspace_id", default="")

# Structured-field keys that must NEVER reach a log sink (DPDP / CF-C6-PII-*).
_PII_KEYS = frozenset({
    "email", "phone", "first_name", "last_name", "full_name", "name",
    "customer_email", "customer_phone", "address", "billing_address", "shipping_address",
    "raw_payload", "payload", "password", "token", "authorization", "api_key",
    "secret", "credential", "credential_enc", "salt", "salt_enc",
})

# Standard LogRecord attributes — anything NOT here is treated as a structured
# ``extra=`` field and emitted (after redaction).
_RESERVED = frozenset({
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
    "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
    "created", "msecs", "relativeCreated", "thread", "threadName",
    "processName", "process", "taskName", "message", "asctime",
})


def bind_correlation(
    *,
    request_id: str | None = None,
    trace_id: str | None = None,
    workspace_id: str | None = None,
) -> None:
    """Bind correlation ids onto the current context (call per request/event)."""
    if request_id is not None:
        _request_id.set(request_id)
    if trace_id is not None:
        _trace_id.set(trace_id)
    if workspace_id is not None:
        _workspace_id.set(workspace_id)


def clear_correlation() -> None:
    """Reset the correlation context (call at the end of a request/event)."""
    _request_id.set("")
    _trace_id.set("")
    _workspace_id.set("")


def get_correlation() -> dict[str, str]:
    """Return the currently-bound correlation quad (empty strings if unset)."""
    return {
        "request_id": _request_id.get(),
        "trace_id": _trace_id.get(),
        "workspace_id": _workspace_id.get(),
    }


def _redact(key: str, value: Any) -> Any:
    return "[REDACTED]" if key.lower() in _PII_KEYS else value


class JsonFormatter(logging.Formatter):
    """Emit one JSON object per record via ``json.dumps`` (escaping-safe)."""

    def __init__(self, service: str) -> None:
        super().__init__()
        self._service = service

    def format(self, record: logging.LogRecord) -> str:  # noqa: A003
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "level": record.levelname,
            "service": self._service,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for key, value in get_correlation().items():
            if value:
                payload[key] = value
        # Structured extra= fields (record attrs that are not reserved).
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                payload[key] = _redact(key, value)
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        # default=str keeps the formatter total (datetimes, UUIDs, etc.).
        return json.dumps(payload, default=str, ensure_ascii=False)


def configure_logging(service: str, level: str = "INFO") -> None:
    """Install the JSON formatter on the root logger (call once at startup).

    Replaces logging.basicConfig — idempotent (resets handlers each call).
    """
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter(service))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())


def get_logger(name: str) -> logging.Logger:
    """Return a stdlib logger; emits JSON once configure_logging has run."""
    return logging.getLogger(name)
