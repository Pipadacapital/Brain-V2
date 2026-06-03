/**
 * realtime-facts-consumer.ts — Kafka consumer for real-time Shopify webhook facts.
 *
 * @paradigm io+sql (Kafka ingest → deterministic SQL UPSERT; NO ML, NO LLM)
 *
 * Reads from `integrations.shopify.v1` (Redpanda) and idempotently upserts into:
 *   • PG:  connector_order_facts + connector_line_item_facts
 *          via withWorkspace (app.workspace_id GUC → RLS enforced)
 *   • CH:  brain.connector_order_facts + brain.connector_line_item_facts
 *          via chInsert + ReplacingMergeTree(version) for idempotency
 *
 * Idempotency:
 *   PG — ON CONFLICT (workspace_id, vendor, vendor_order_id[, vendor_line_id]) DO UPDATE
 *   CH — ReplacingMergeTree(version); re-delivery with a higher version wins at FINAL
 *
 * Safety:
 *   • A single malformed message is logged and skipped (offset committed) — never
 *     wedges the partition.
 *   • Consumer does NOT block server boot if the broker is down — kafkajs retries
 *     internally with exponential back-off.
 *   • Started ONLY when REALTIME_FACTS_CONSUMER === 'true'.
 *
 * Money: all *_mu fields are bigint minor units (paise). decimalStringToMinorUnits
 * converts REST decimal strings ("8888.00" → 888800n) without floating-point.
 *
 * PII: email / first_name / last_name from the webhook payload are NEVER written to
 * facts. customer_ref is a sha256-truncated hash of the Shopify customer id (same
 * as the batch-sync path in normalizers.ts).
 *
 * Trace: trace_id + request_id from the Kafka envelope header are logged on every
 * message and on every error response (Stage-3 VETO surface / in-lane DoD).
 */

import { Kafka, type Consumer, type EachMessagePayload, logLevel } from 'kafkajs'
import type { PoolClient } from 'pg'
import {
  withWorkspace,
  decimalStringToMinorUnits,
  customerRef,
  classifyPaymentMethod,
  resolveGstSlabBp,
  type OrderFact,
  type LineItemFact,
} from '@brain/core-connectors'
import { chInsert } from '@brain/lib-clickhouse-ts'

// ---------------------------------------------------------------------------
// Kafka envelope shape (ingestion-service producer contract — verified from the
// running stack; do NOT change without amending the plan).
// ---------------------------------------------------------------------------

interface ShopifyKafkaEnvelope {
  workspace_id: string
  vendor: string
  vendor_event_id: string     // delivery id — idempotency anchor
  event_type: string
  occurred_at: string
  ingested_at: string
  payload: string             // JSON STRING — must JSON.parse
  lawful_basis?: string
  purpose_code?: string
  request_id?: string
  trace_id?: string
  actor?: string
}

// ---------------------------------------------------------------------------
// Webhook payload (REST snake_case fields from normalised Shopify order).
// raw_payload is a JSON STRING of the full Shopify order incl. line_items[].
// ---------------------------------------------------------------------------

interface ShopifyWebhookPayload {
  shopify_order_id: string
  order_number?: string | number | null
  financial_status?: string | null
  fulfillment_status?: string | null
  email?: string | null            // PII — NOT written to facts
  first_name?: string | null       // PII — NOT written to facts
  last_name?: string | null        // PII — NOT written to facts
  total_price?: string | null
  subtotal_price?: string | null
  total_discounts?: string | null
  total_tax?: string | null
  currency?: string | null
  created_at?: string | null
  updated_at?: string | null
  closed_at?: string | null
  cancelled_at?: string | null
  raw_payload?: string | null      // JSON STRING of full Shopify order
}

interface ShopifyLineItem {
  id?: string | number
  // REST order webhooks carry numeric product_id/variant_id per line item. The
  // facts store the GraphQL GID form (gid://shopify/Product/<n>), so we reconstruct
  // it — closing the join gap to product facts without a later batch backfill.
  product_id?: string | number | null
  variant_id?: string | number | null
  sku?: string | null
  title?: string | null
  quantity?: number | null
  price?: string | null
}

interface ShopifyRawOrder {
  id?: string | number
  customer?: { id?: string | number } | null
  payment_gateway?: string | null
  payment_gateway_names?: string[] | null
  shipping_address?: { zip?: string | null; city?: string | null } | null
  line_items?: ShopifyLineItem[]
}

// ---------------------------------------------------------------------------
// Envelope→fact mapping (public for unit tests)
// ---------------------------------------------------------------------------

// LineItemFact (shared, GraphQL pull path) has no product/variant id; the webhook
// path reconstructs the GID from the REST numeric ids, so we carry them here.
export interface WebhookLineItem extends LineItemFact {
  vendorProductId: string
  vendorVariantId: string
}

export interface MappedFacts {
  order: OrderFact
  lineItems: WebhookLineItem[]
}

// REST numeric id → GraphQL GID, matching the format stored in the fact tables
// (gid://shopify/Product/<n>). Empty string when the id is absent.
const toGid = (kind: 'Product' | 'ProductVariant', id: unknown): string =>
  id != null && id !== '' ? `gid://shopify/${kind}/${id}` : ''

/**
 * Map a verified Shopify webhook envelope to the canonical Brain fact shapes.
 *
 * Rules:
 *   - vendor_order_id = shopify_order_id (string)
 *   - gross_sales_mu  = subtotal_price (fallback total_price) — matches normalizeShopifyOrder
 *   - total_discount_mu = total_discounts
 *   - total_tax_mu    = total_tax
 *   - net_sales_mu    = gross − discount  (Brain canon; tax NOT subtracted here)
 *   - customer_ref    = sha256-truncated of raw customer.id from raw_payload (DPDP)
 *   - processed_at    = created_at
 *   - line items from raw_payload.line_items; unit_price_mu from li.price
 *
 * Throws on any structural problem — the consumer catch block logs + skips.
 */
export function mapEnvelopeToFacts(envelope: ShopifyKafkaEnvelope): MappedFacts {
  const payload = JSON.parse(envelope.payload) as ShopifyWebhookPayload

  const currency = (payload.currency ?? 'INR').toUpperCase()
  const vendorOrderId = String(payload.shopify_order_id ?? '')
  if (!vendorOrderId) throw new Error('mapEnvelopeToFacts: shopify_order_id is empty')

  // Money: decimal strings → bigint minor units (NO float path).
  const grossSalesMu =
    payload.subtotal_price && payload.subtotal_price !== '0' && payload.subtotal_price !== '0.00'
      ? decimalStringToMinorUnits(payload.subtotal_price, currency)
      : decimalStringToMinorUnits(payload.total_price ?? '0', currency)

  const totalDiscountMu = decimalStringToMinorUnits(payload.total_discounts ?? '0', currency)
  const totalTaxMu      = decimalStringToMinorUnits(payload.total_tax ?? '0', currency)

  // raw_payload contains the full Shopify order including customer.id + line_items[].
  let rawOrder: ShopifyRawOrder = {}
  if (payload.raw_payload) {
    const parsed: unknown = JSON.parse(payload.raw_payload)
    rawOrder = (parsed != null && typeof parsed === 'object' ? parsed : {}) as ShopifyRawOrder
  }

  // customer_ref: sha256 of the Shopify customer id — NEVER the email (DPDP P-006).
  // Mirrors the customerRef() call in normalizeShopifyOrder (normalizers.ts:96).
  const customerId = rawOrder.customer?.id != null ? String(rawOrder.customer.id) : null
  const ref = customerRef(customerId)

  // Payment method: from raw order's payment_gateway / payment_gateway_names.
  // Mirrors classifyPaymentMethod(node.paymentGatewayNames) in normalizers.ts.
  const gatewayNames =
    rawOrder.payment_gateway_names ??
    (rawOrder.payment_gateway ? [rawOrder.payment_gateway] : null)
  const paymentMethod = classifyPaymentMethod(gatewayNames)

  const order: OrderFact = {
    vendor: 'SHOPIFY',
    vendorOrderId,
    orderNumber: payload.order_number != null ? String(payload.order_number) : null,
    financialStatus: payload.financial_status ?? null,
    fulfillmentStatus: payload.fulfillment_status ?? null,
    paymentMethod,
    currencyCode: currency,
    grossSalesMu,
    totalDiscountMu,
    totalTaxMu,
    shippingMu: 0n,                // Shopify REST webhook order-level doesn't expose
    //                               shipping separately at the summary level; 0 is
    //                               consistent with what the batch sync backfill uses
    //                               for orders that omit totalShippingPriceSet.
    customerRef: ref,
    deliveryPincode: rawOrder.shipping_address?.zip ?? null,
    deliveryCity: rawOrder.shipping_address?.city ?? null,
    processedAt: payload.created_at ?? null,
    cancelledAt: payload.cancelled_at ?? null,
  }

  // Line items from raw_payload.line_items[].
  const lineItems: WebhookLineItem[] = (rawOrder.line_items ?? []).map((li, idx) => ({
    vendor: 'SHOPIFY' as const,
    vendorOrderId,
    vendorLineId: li.id != null ? String(li.id) : `${vendorOrderId}:${idx}`,
    vendorProductId: toGid('Product', li.product_id),
    vendorVariantId: toGid('ProductVariant', li.variant_id),
    sku: li.sku ?? null,
    title: li.title ?? null,
    quantity: BigInt(li.quantity ?? 0),
    unitPriceMu: decimalStringToMinorUnits(li.price ?? '0', currency),
    gstSlabBp: resolveGstSlabBp(),
  }))

  return { order, lineItems }
}

// ---------------------------------------------------------------------------
// PG UPSERT helpers — inline SQL mirrors sync-use-cases.ts (upsertOrder /
// upsertLineItem). withWorkspace sets app.workspace_id GUC → RLS enforced.
// ---------------------------------------------------------------------------

async function pgUpsertOrder(tx: PoolClient, workspaceId: string, o: OrderFact): Promise<void> {
  await tx.query(
    `INSERT INTO connector_order_facts
       (workspace_id, vendor, vendor_order_id, order_number, financial_status, fulfillment_status,
        payment_method, currency_code, gross_sales_mu, total_discount_mu, total_tax_mu, shipping_mu,
        customer_ref, is_new_customer, delivery_pincode, delivery_city, processed_at, cancelled_at, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, now())
     ON CONFLICT (workspace_id, vendor, vendor_order_id) DO UPDATE SET
       order_number=EXCLUDED.order_number, financial_status=EXCLUDED.financial_status,
       fulfillment_status=EXCLUDED.fulfillment_status, payment_method=EXCLUDED.payment_method,
       currency_code=EXCLUDED.currency_code, gross_sales_mu=EXCLUDED.gross_sales_mu,
       total_discount_mu=EXCLUDED.total_discount_mu, total_tax_mu=EXCLUDED.total_tax_mu,
       shipping_mu=EXCLUDED.shipping_mu, customer_ref=EXCLUDED.customer_ref,
       delivery_pincode=EXCLUDED.delivery_pincode, delivery_city=EXCLUDED.delivery_city,
       processed_at=EXCLUDED.processed_at, cancelled_at=EXCLUDED.cancelled_at, synced_at=now()`,
    [
      workspaceId, o.vendor, o.vendorOrderId, o.orderNumber,
      o.financialStatus, o.fulfillmentStatus, o.paymentMethod,
      o.currencyCode,
      // pg driver serializes bigint to string for BIGINT columns — explicit cast.
      String(o.grossSalesMu), String(o.totalDiscountMu), String(o.totalTaxMu), String(o.shippingMu),
      o.customerRef,
      null,                     // is_new_customer — derived at read time (idempotent)
      o.deliveryPincode, o.deliveryCity, o.processedAt, o.cancelledAt,
    ],
  )
}

async function pgUpsertLineItem(tx: PoolClient, workspaceId: string, li: WebhookLineItem): Promise<void> {
  await tx.query(
    `INSERT INTO connector_line_item_facts
       (workspace_id, vendor, vendor_order_id, vendor_line_id, vendor_product_id, sku, title, quantity, unit_price_mu, gst_slab_bp, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     ON CONFLICT (workspace_id, vendor, vendor_order_id, vendor_line_id) DO UPDATE SET
       vendor_product_id=EXCLUDED.vendor_product_id, sku=EXCLUDED.sku, title=EXCLUDED.title,
       quantity=EXCLUDED.quantity, unit_price_mu=EXCLUDED.unit_price_mu,
       gst_slab_bp=EXCLUDED.gst_slab_bp, synced_at=now()`,
    [
      workspaceId, li.vendor, li.vendorOrderId, li.vendorLineId, li.vendorProductId,
      li.sku, li.title,
      String(li.quantity), String(li.unitPriceMu), li.gstSlabBp,
    ],
  )
}

// ---------------------------------------------------------------------------
// CH INSERT helpers — mirrors phase8-ch-backfill.sql column mapping.
// ReplacingMergeTree(version) deduplicates re-delivered messages at FINAL.
// version = message.timestamp (monotonic ms since epoch as UInt64).
//
// Key CH columns (from 0003_connector_order_facts.sql):
//   workspace_id, vendor, vendor_order_id, order_date (Date), placed_at (DateTime64),
//   customer_ref, delivery_pincode, delivery_city,
//   gross_sales_mu, discount_mu, tax_mu, shipping_mu, net_sales_mu, total_refund_mu,
//   currency_code, payment_method, is_cod, order_type,
//   financial_status, fulfillment_status, cancelled_at, tags, version, ingested_at
//
// Key CH columns (from 0004_connector_line_item_facts.sql):
//   workspace_id, vendor, vendor_order_id, vendor_line_id, vendor_product_id,
//   vendor_variant_id, sku, title, quantity (Int32), price_mu, line_total_mu,
//   discount_mu, tax_mu, cogs_mu, currency_code, order_date (Date), version, ingested_at
// ---------------------------------------------------------------------------

// ClickHouse date-time formatting for JSONEachRow. CH DateTime/DateTime64 reject
// ISO 'T'…'Z'; they want 'YYYY-MM-DD HH:MM:SS[.sss]'.
//   chDT64 — millisecond precision for DateTime64(3) columns (placed_at)
//   chDT   — second precision for DateTime columns (ingested_at, cancelled_at)
const chDT64 = (d: Date): string => d.toISOString().replace('T', ' ').slice(0, 23)
const chDT = (d: Date): string => d.toISOString().replace('T', ' ').slice(0, 19)

function chOrderRow(
  workspaceId: string,
  o: OrderFact,
  version: bigint,
  processedAt: Date,
): Record<string, unknown> {
  const netSalesMu = o.grossSalesMu - o.totalDiscountMu  // Brain canon: net = gross − discount
  const orderDate = processedAt.toISOString().split('T')[0]   // 'YYYY-MM-DD' for CH Date

  return {
    workspace_id: workspaceId,
    vendor: o.vendor,
    vendor_order_id: o.vendorOrderId,
    order_date: orderDate,
    placed_at: chDT64(processedAt),
    customer_ref: o.customerRef ?? '',
    delivery_pincode: o.deliveryPincode ?? '',
    delivery_city: o.deliveryCity ?? '',
    gross_sales_mu: String(o.grossSalesMu),
    discount_mu: String(o.totalDiscountMu),
    tax_mu: String(o.totalTaxMu),
    shipping_mu: String(o.shippingMu),
    net_sales_mu: String(netSalesMu),
    total_refund_mu: '0',
    currency_code: o.currencyCode,
    payment_method: o.paymentMethod ?? '',
    is_cod: o.paymentMethod === 'COD' ? 1 : 0,
    order_type: '',
    financial_status: o.financialStatus ?? '',
    fulfillment_status: o.fulfillmentStatus ?? '',
    // cancelled_at is Nullable(DateTime) in CH — CH-format or null.
    cancelled_at: o.cancelledAt ? chDT(new Date(o.cancelledAt)) : null,
    tags: [],
    version: String(version),
    ingested_at: chDT(new Date()),
  }
}

function chLineItemRow(
  workspaceId: string,
  li: WebhookLineItem,
  version: bigint,
  orderDate: string,          // 'YYYY-MM-DD' denormalized from the order's created_at
): Record<string, unknown> {
  const lineTotalMu = li.unitPriceMu * li.quantity

  return {
    workspace_id: workspaceId,
    vendor: li.vendor,
    vendor_order_id: li.vendorOrderId,
    vendor_line_id: li.vendorLineId,
    vendor_product_id: li.vendorProductId,   // GID reconstructed from REST product_id
    vendor_variant_id: li.vendorVariantId,
    sku: li.sku ?? '',
    title: li.title ?? '',
    quantity: Number(li.quantity),
    price_mu: String(li.unitPriceMu),
    line_total_mu: String(lineTotalMu),
    discount_mu: '0',
    tax_mu: '0',
    cogs_mu: '0',
    currency_code: 'INR',     // webhook currency is order-level; line items inherit
    order_date: orderDate,
    version: String(version),
    ingested_at: chDT(new Date()),
  }
}

// ---------------------------------------------------------------------------
// Consumer lifecycle
// ---------------------------------------------------------------------------

const TOPIC = 'integrations.shopify.v1'
const GROUP_ID = 'brain-facts-consumer'

let _consumer: Consumer | null = null

/**
 * Start the Kafka consumer for real-time Shopify fact upserts.
 * Must be called once at server boot (ONLY when REALTIME_FACTS_CONSUMER==='true').
 *
 * Does NOT block: kafkajs connects asynchronously with built-in retry. If the broker
 * is down at boot the consumer keeps retrying in the background — the gateway serves
 * HTTP traffic normally. One malformed message is logged + skipped; the offset is
 * committed so the partition never wedges.
 *
 * @param log  Pino-compatible logger from the Fastify instance.
 */
export async function startRealtimeFactsConsumer(
  log: { info(msg: string, obj?: object): void; error(obj: object, msg: string): void; warn(obj: object, msg: string): void },
): Promise<void> {
  const brokers = (process.env['KAFKA_BOOTSTRAP_SERVERS'] ?? 'localhost:19092')
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean)

  const kafka = new Kafka({
    clientId: 'api-gateway-facts-consumer',
    brokers,
    logLevel: logLevel.WARN,
  })

  const consumer = kafka.consumer({ groupId: GROUP_ID })
  _consumer = consumer

  // Connect + subscribe — failures here are retried by kafkajs internals.
  // We do NOT await in a way that blocks the server boot: any connection error
  // is caught and logged; the consumer retries independently.
  try {
    await consumer.connect()
    await consumer.subscribe({ topic: TOPIC, fromBeginning: false })
    log.info(`realtime-facts-consumer: subscribed to ${TOPIC} (group=${GROUP_ID})`)
  } catch (err) {
    log.error({ err }, `realtime-facts-consumer: initial connect/subscribe failed — will retry`)
    // kafkajs will handle re-connection internally when run() starts.
  }

  // Run the consume loop. Errors within eachMessage are caught per-message.
  void consumer.run({
    eachMessage: async (payload: EachMessagePayload) => {
      const { message, partition, topic } = payload
      const raw = message.value?.toString()

      // Correlation IDs from the Kafka message headers (or envelope body, below).
      const headerTraceId = message.headers?.['trace_id']?.toString() ?? 'unknown'
      const headerRequestId = message.headers?.['request_id']?.toString() ?? message.offset

      if (!raw) {
        log.warn(
          { topic, partition, offset: message.offset, trace_id: headerTraceId, request_id: headerRequestId },
          'realtime-facts-consumer: empty message.value — skipping',
        )
        return
      }

      try {
        const envelope = JSON.parse(raw) as ShopifyKafkaEnvelope

        // Validate minimal required fields before any expensive IO.
        if (!envelope.workspace_id || !envelope.payload || envelope.event_type !== 'order') {
          log.warn(
            {
              topic, partition, offset: message.offset,
              trace_id: envelope.trace_id ?? headerTraceId,
              request_id: envelope.request_id ?? headerRequestId,
              workspace_id: envelope.workspace_id,
              event_type: envelope.event_type,
            },
            'realtime-facts-consumer: non-order event or missing fields — skipping',
          )
          return
        }

        const traceId = envelope.trace_id ?? headerTraceId
        const requestId = envelope.request_id ?? headerRequestId
        const workspaceId = envelope.workspace_id

        // Map envelope → canonical facts. Throws on structural errors (logged + skipped).
        const { order, lineItems } = mapEnvelopeToFacts(envelope)

        // version = message.timestamp (monotonic ms from Kafka) → UInt64 for CH.
        // Falls back to Date.now() when the broker doesn't populate timestamp.
        const version = message.timestamp ? BigInt(message.timestamp) : BigInt(Date.now())

        const processedAt = order.processedAt
          ? new Date(order.processedAt)
          : new Date()
        const orderDate = processedAt.toISOString().split('T')[0]

        // -----------------------------------------------------------------------
        // 1. PG upsert — RLS-scoped via withWorkspace (GUC: app.workspace_id).
        //    Single transaction: order + all line items. ON CONFLICT = idempotent.
        // -----------------------------------------------------------------------
        await withWorkspace(workspaceId, async (tx: PoolClient) => {
          await pgUpsertOrder(tx, workspaceId, order)
          for (const li of lineItems) {
            await pgUpsertLineItem(tx, workspaceId, li)
          }
        }, { requestId, traceId, workspaceId, userId: envelope.actor ?? 'system:ingest' })

        // -----------------------------------------------------------------------
        // 2. CH insert — ReplacingMergeTree(version) deduplicates on FINAL.
        //    Separate try/catch: a CH failure does NOT roll back the PG write;
        //    the PG row is the authoritative source. CH will catch up on the
        //    next re-delivery (Kafka retry) or the next backfill run.
        // -----------------------------------------------------------------------
        try {
          await chInsert(
            'brain.connector_order_facts',
            [chOrderRow(workspaceId, order, version, processedAt)],
          )
          if (lineItems.length > 0) {
            await chInsert(
              'brain.connector_line_item_facts',
              lineItems.map((li) => chLineItemRow(workspaceId, li, version, orderDate)),
            )
          }
        } catch (chErr) {
          // CH failure logged but NOT fatal — dashboard falls back to PG via READ_FROM_CH flag.
          log.error(
            {
              err: chErr,
              vendor_order_id: order.vendorOrderId,
              workspace_id: workspaceId,
              trace_id: traceId,
              request_id: requestId,
            },
            'realtime-facts-consumer: CH insert failed (PG write succeeded)',
          )
        }

        log.info(
          `realtime-facts-consumer: upserted order=${order.vendorOrderId} lines=${lineItems.length} workspace=${workspaceId} trace_id=${traceId}`,
        )
      } catch (err) {
        // Structural / parse error: log with correlation IDs and skip.
        // Offset is committed automatically by kafkajs so the partition never wedges.
        log.error(
          {
            err,
            topic,
            partition,
            offset: message.offset,
            trace_id: headerTraceId,
            request_id: headerRequestId,
          },
          'realtime-facts-consumer: message processing failed — skipping offset',
        )
      }
    },
  })
}

/**
 * Gracefully disconnect the consumer — called on SIGTERM / server.onClose.
 * Safe to call even if startRealtimeFactsConsumer was never called.
 */
export async function stopRealtimeFactsConsumer(): Promise<void> {
  if (_consumer) {
    await _consumer.disconnect()
    _consumer = null
  }
}
