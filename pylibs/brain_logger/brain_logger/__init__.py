# brain_logger — structured logging + correlation for Python services
# (spec: pylibs/brain_logger). Counterpart to @brain/lib-logger (TS). Every line carries
# workspace_id + trace_id (the one correlation id HTTP→gRPC→Kafka→LLM); PII-redaction on.
# The shared logger lands here as the Python services adopt it.

LOGGER_PACKAGE = "brain_logger"
