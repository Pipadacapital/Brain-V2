# Requirement — connector-webhook-intake

| Field | Value |
|-------|-------|
| **req_id** | `connector-webhook-intake` |
| **Author** | rishabhporwal (Founder) |
| **Date** | 2026-05-29 |
| **Source** | Direct Founder directive; consumes the HMAC-custody seam built in `chore-app-hmac-secret-custody` |

## Goal

A production inbound webhook path for Shopify (extensible to other vendors):

> receive the webhook → verify HMAC (fail-closed) → idempotent intake → produce to the Brain ingest path.

This consumes seams already built and Stage-6-approved:
- `verify_shopify_hmac(data, hmac_header, client_secret) -> bool` — base64/raw-body HMAC-SHA256, constant-time compare (`apps/ingestion-service/src/interfaces/adapters/shopify_adapter.py:81`).
- `select_app_secret_provider()` + `provider.get_shopify_hmac_secret()` — the app-level singleton HMAC secret provider, fail-closed via `AppSecretUnavailableError` (`apps/ingestion-service/src/infrastructure/secrets/app_secret_factory.py`, `app_secret_provider.py`).
- `ingest_batch(adapter, workspace_id, window, *, dry_run, custody, kafka_producer, allowed_workspace_ids, request_id, trace_id)` — idempotent UPSERT (ON CONFLICT `(workspace_id, vendor_event_id)`) + Kafka produce to `integrations.<vendor>.v1` + correlation 4-tuple (`apps/ingestion-service/src/application/framework/ingest.py:371`).

## Carry-forward obligations (from the HMAC slice)

- N1 — the ingress must carry the **correlation ID end-to-end** (HTTP header → ingest → Kafka envelope).
- The fail-closed seam: `except AppSecretUnavailableError → REJECT` (never 200 / fall-open). `HeldAppSecretProvider` also raises on every access — REJECT.
- `CF-HMAC-ALGO-DISTINCT-1` / Single-Primitive: NO second HMAC verifier. The inbound base64/raw-body verifier is Python-only; the gateway's hex/sorted-query verifier is the **OAuth-callback** verifier (distinct routine, distinct purpose) and is NOT to be reused or duplicated for inbound webhooks.

## Scope boundary (Founder)

- Run autonomously; right-size; CHALLENGE-BACK or scope-to-vertical-slice as warranted.
- Live deploy / public-endpoint registration is **HELD-Stage-8**.
- No code, no commit at Stage 1.
