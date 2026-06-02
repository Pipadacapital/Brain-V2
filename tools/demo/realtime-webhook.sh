#!/usr/bin/env bash
# =============================================================================
# Real-time ingestion demo — send a SIGNED Shopify orders/create webhook to the
# local gateway and watch it flow: gateway → ingestion (verify HMAC) →
# raw_shopify_orders (PG) + Kafka integrations.shopify.v1 → core consumer →
# connector_*_facts (PG+CH) → dashboard.
#
# Usage:  bash tools/demo/realtime-webhook.sh [ORDER_ID] [TOTAL]
#   ORDER_ID  unique Shopify order id (default: timestamped)
#   TOTAL     order total in rupees (default: 4999.00)
#
# Signing (per ingestion EnvAppSecretProvider): base64(HMAC-SHA256(raw_body,
# SHOPIFY_CLIENT_SECRET)) in header x-shopify-hmac-sha256. Secret read from
# .env.docker — never hardcoded, never logged.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/../.."

GATEWAY="${GATEWAY:-http://localhost:3001}"
SHOP_DOMAIN="sugandhlok.myshopify.com"        # seeded in connector_identity_map → Sugandhlok ws
ORDER_ID="${1:-$(date +%s)}"                   # unique → new fact each run
TOTAL="${2:-4999.00}"
WEBHOOK_ID="demo-$(date +%s)-$RANDOM"           # idempotency anchor (x-shopify-webhook-id)

# Secret from .env.docker (the dev Shopify app secret). NEVER printed.
SECRET="$(grep -E '^SHOPIFY_CLIENT_SECRET=' .env.docker | head -1 | cut -d= -f2-)"
if [ -z "${SECRET:-}" ]; then echo "FATAL: SHOPIFY_CLIENT_SECRET not in .env.docker"; exit 1; fi

# A realistic orders/create REST payload (snake_case, as Shopify sends).
read -r -d '' BODY <<JSON || true
{"id":${ORDER_ID},"order_number":${ORDER_ID},"financial_status":"paid","fulfillment_status":null,"email":"demo@example.com","currency":"INR","total_price":"${TOTAL}","subtotal_price":"${TOTAL}","total_discounts":"0.00","total_tax":"0.00","created_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","updated_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","closed_at":null,"cancelled_at":null,"billing_address":{"first_name":"Demo","last_name":"Buyer","zip":"560001","city":"Bengaluru"},"line_items":[{"id":${ORDER_ID}01,"sku":"DEMO-SKU-1","title":"Demo Attar 50ml","quantity":1,"price":"${TOTAL}"}]}
JSON

# HMAC-SHA256 over the EXACT bytes, base64-encoded.
SIG="$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)"

echo "▸ POST ${GATEWAY}/webhooks/shopify  (order_id=${ORDER_ID}, total=₹${TOTAL}, webhook_id=${WEBHOOK_ID})"
HTTP_CODE="$(printf '%s' "$BODY" | curl -s -o /tmp/rt-webhook-resp.txt -w '%{http_code}' \
  -X POST "${GATEWAY}/webhooks/shopify" \
  -H 'Content-Type: application/json' \
  -H "x-shopify-hmac-sha256: ${SIG}" \
  -H "x-shopify-shop-domain: ${SHOP_DOMAIN}" \
  -H "x-shopify-topic: orders/create" \
  -H "x-shopify-webhook-id: ${WEBHOOK_ID}" \
  --data-binary @-)"
echo "  HTTP ${HTTP_CODE}: $(cat /tmp/rt-webhook-resp.txt)"
echo "  (200 = accepted; 401 = HMAC/verify rejected; 429/413 = rate/size)"
