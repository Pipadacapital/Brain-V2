# Convention: Event Model (Kafka + Avro)

## Single event spine
One Kafka cluster (MSK, ap-south-1). All domain events flow through it.
No per-channel event bus forks (Single-Primitive Rule).

## Schema home
`protos/events/` — Avro event schemas + Glue Schema Registry config.
(Avro for events, proto3 for gRPC — two different formats for two different transports.)

## Topic naming
`<domain>.<entity>.<event>.vN`
Examples:
- `orders.order.placed.v1`
- `analytics.metric.computed.v1`
- `lifecycle.campaign.sent.v1`

## Standard 10-field envelope
Every event must carry these fields (enforced by the Avro schema):
```
1. event_id        — UUID (unique per event)
2. event_type      — string (matches topic name without vN)
3. event_version   — int (N in .vN)
4. workspace_id    — UUID (partition key; REQUIRED)
5. user_id         — UUID (nullable for system events)
6. request_id      — UUID (correlation — propagated from the originating HTTP request)
7. trace_id        — string (OTel trace ID)
8. idempotency_key — UUID (caller-generated; used for exactly-once on the consumer side)
9. occurred_at     — ISO 8601 UTC
10. payload        — Avro record (event-specific body)
```

## Partition key
`workspace_id` — always. Every consumer can assume all events for a workspace
arrive on the same partition, enabling stateful per-workspace processing without
cross-partition shuffle.

## Exactly-once strategy
**Producer side:** Transactional outbox pattern — the producer writes the event to an
`outbox` table in the same Postgres transaction as the domain write, then a relay
process publishes to Kafka. Home: each producer service's `src/infrastructure/`.

**Consumer side:** `idempotency_key` + ClickHouse version dedup. Before processing,
the consumer checks `idempotency_key` against Redis (workspace-scoped key
`ws:<workspace_id>:idem:<idempotency_key>`, TTL 24h). If already processed, skip.
ClickHouse dedup: `ReplacingMergeTree` or `AggregatingMergeTree` on `event_id`.

## Consumer workspace_id assertion
Every consumer MUST assert `envelope.workspace_id == expected_workspace_id` before
processing. Home: each service's `src/infrastructure/` Kafka consumers.

## MSK config (deferred)
MSK provisioning is deferred infra. No broker is created at scaffold time.
The event spine home (`protos/events/`) is established so the first producer has a
place for its Avro schema the moment MSK is provisioned.
