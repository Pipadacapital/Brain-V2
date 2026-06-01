# brain_kafka — Kafka producer/consumer + rate limiter (spec: pylibs/brain_kafka).
# Envelope carries workspace_id (partition key) + trace_id (correlation HTTP→gRPC→Kafka→LLM).
# Producer/consumer wrappers land here as the MSK event flow is activated.

KAFKA_PACKAGE = "brain_kafka"
