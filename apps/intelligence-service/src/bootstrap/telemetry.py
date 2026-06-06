"""telemetry.py — OpenTelemetry provider wiring for intelligence-service.

The cost-router meters (paradigm_distribution, faithfulness_retry_total) and the
gateway tracer create OTel *instruments* at import time, but those instruments
are silent no-ops until a MeterProvider / TracerProvider is installed. This is
where they get installed — the sink the rest of the code assumes exists.

Exports via OTLP when ``OTEL_EXPORTER_OTLP_ENDPOINT`` is set (e.g. an ADOT
sidecar / collector in EKS); stays a deliberate no-op when it is unset, so local
dev and the test suite never block on or spam a collector that isn't there.

OTel's API uses proxy instruments that bind to the global provider lazily at
record time, so calling this at startup — even after the instrument modules have
been imported — correctly activates the already-created meters/tracers.
"""

from __future__ import annotations

import logging
import os

_log = logging.getLogger("intelligence.telemetry")


def configure_telemetry(service_name: str) -> bool:
    """Install OTLP-exporting Tracer + Meter providers if an endpoint is set.

    Returns True if providers were installed, False if telemetry stayed no-op
    (no endpoint configured). Safe to call once at process startup.
    """
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    if not endpoint:
        _log.info(
            "OTel disabled: OTEL_EXPORTER_OTLP_ENDPOINT unset — instruments stay no-op."
        )
        return False

    # Imports are local: the SDK + OTLP exporter are only needed on this path.
    from opentelemetry import metrics, trace
    from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
    from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
    from opentelemetry.sdk.resources import SERVICE_NAME, Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    resource = Resource.create({SERVICE_NAME: service_name})

    tracer_provider = TracerProvider(resource=resource)
    tracer_provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint))
    )
    trace.set_tracer_provider(tracer_provider)

    meter_provider = MeterProvider(
        resource=resource,
        metric_readers=[PeriodicExportingMetricReader(OTLPMetricExporter(endpoint=endpoint))],
    )
    metrics.set_meter_provider(meter_provider)

    _log.info(
        "OTel configured: traces + metrics -> %s (service=%s)", endpoint, service_name
    )
    return True
