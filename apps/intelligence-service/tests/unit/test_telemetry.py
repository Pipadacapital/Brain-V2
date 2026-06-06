"""Tests for bootstrap.telemetry.configure_telemetry.

no-op-by-default (the dev/test safety guarantee) is asserted in-process; the
provider-install path runs in a subprocess because setting a global OTel provider
is process-wide and one-shot — we must not pollute the rest of the suite's
no-op OTel state.
"""

import os
import subprocess
import sys
from pathlib import Path

from bootstrap.telemetry import configure_telemetry

_SERVICE_ROOT = Path(__file__).resolve().parents[2]  # apps/intelligence-service


def test_noop_when_endpoint_unset(monkeypatch):
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    assert configure_telemetry("brain-intelligence-service") is False


def test_noop_when_endpoint_blank(monkeypatch):
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "   ")
    assert configure_telemetry("brain-intelligence-service") is False


def test_installs_providers_when_endpoint_set():
    code = (
        "import os; os.environ['OTEL_EXPORTER_OTLP_ENDPOINT'] = 'http://localhost:4317';"
        "from bootstrap.telemetry import configure_telemetry;"
        "from opentelemetry import trace, metrics;"
        "from opentelemetry.sdk.trace import TracerProvider;"
        "from opentelemetry.sdk.metrics import MeterProvider;"
        "ok = configure_telemetry('brain-intelligence-service');"
        "assert ok is True, 'expected providers installed';"
        "assert isinstance(trace.get_tracer_provider(), TracerProvider), 'tracer provider not SDK';"
        "assert isinstance(metrics.get_meter_provider(), MeterProvider), 'meter provider not SDK';"
        "metrics.get_meter_provider().shutdown(); trace.get_tracer_provider().shutdown();"
        "print('TELEMETRY_OK')"
    )
    env = dict(os.environ, PYTHONPATH="src")
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=str(_SERVICE_ROOT),
        capture_output=True,
        text=True,
        env=env,
    )
    assert "TELEMETRY_OK" in result.stdout, f"stdout={result.stdout!r} stderr={result.stderr!r}"
