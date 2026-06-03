/**
 * realtime-facts-consumer.test.ts — unit tests for the envelope→OrderFact/LineItemFact mapping.
 *
 * @paradigm sql (pure deterministic mapping; NO network, NO DB, NO live broker)
 *
 * Tests the exported mapEnvelopeToFacts() function with:
 *   - the verified Kafka envelope from the task spec (positive cases)
 *   - edge cases (no subtotal → fallback total_price, missing customer id, missing line items)
 *   - negative cases (empty vendor_order_id, non-order event_type, invalid money string)
 *
 * PG writers (withWorkspace) and CH writers (chInsert) are NOT invoked — this is a
 * pure unit test of the mapping layer. Integration with the live broker is verified
 * end-to-end in the Docker stack.
 */

import { describe, it, expect } from 'vitest'
import { mapEnvelopeToFacts } from './realtime-facts-consumer.js'

// ---------------------------------------------------------------------------
// Verified test fixture — mirrors the task-spec envelope exactly.
// ---------------------------------------------------------------------------

const RAW_LINE_ITEM = {
  id: 12345678,
  sku: 'SKU-001',
  title: 'Test Product',
  quantity: 2,
  price: '4444.00',
}

const RAW_SHOPIFY_ORDER = {
  id: 999888777,
  customer: { id: 111222333 },
  payment_gateway: 'razorpay',
  payment_gateway_names: ['razorpay'],
  shipping_address: { zip: '400001', city: 'Mumbai' },
  line_items: [RAW_LINE_ITEM],
}

/** Build a complete, valid envelope matching the verified spec. */
function makeEnvelope(overrides: Partial<{
  shopify_order_id: string
  subtotal_price: string
  total_price: string
  total_discounts: string
  total_tax: string
  currency: string
  created_at: string
  cancelled_at: string | null
  raw_payload: object | null
  event_type: string
}> = {}) {
  const payload = {
    shopify_order_id: overrides.shopify_order_id ?? '999888777',
    order_number: 1001,
    financial_status: 'paid',
    fulfillment_status: 'fulfilled',
    email: 'customer@example.com',
    first_name: 'Jane',
    last_name: 'Doe',
    total_price: overrides.total_price ?? '8888.00',
    subtotal_price: overrides.subtotal_price ?? '8888.00',
    total_discounts: overrides.total_discounts ?? '0.00',
    total_tax: overrides.total_tax ?? '1600.00',
    currency: overrides.currency ?? 'INR',
    created_at: overrides.created_at ?? '2024-01-15T10:30:00Z',
    updated_at: '2024-01-15T11:00:00Z',
    closed_at: null,
    cancelled_at: overrides.cancelled_at !== undefined ? overrides.cancelled_at : null,
    raw_payload: JSON.stringify(
      overrides.raw_payload !== undefined ? overrides.raw_payload : RAW_SHOPIFY_ORDER,
    ),
  }

  return {
    workspace_id: '11111111-2222-3333-4444-555555555555',
    vendor: 'shopify',
    vendor_event_id: 'delivery-abc123',
    event_type: overrides.event_type ?? 'order',
    occurred_at: '2024-01-15T10:30:00Z',
    ingested_at: '2024-01-15T10:30:01Z',
    payload: JSON.stringify(payload),
    lawful_basis: 'contract',
    purpose_code: 'order-processing',
    request_id: 'req-test-001',
    trace_id: 'trace-test-001',
    actor: 'system:ingest',
  }
}

// ---------------------------------------------------------------------------
// POSITIVE — verified envelope from the task spec
// ---------------------------------------------------------------------------

describe('mapEnvelopeToFacts — POSITIVE (verified task-spec envelope)', () => {
  it('returns vendor_order_id = shopify_order_id', () => {
    const { order } = mapEnvelopeToFacts(makeEnvelope())
    expect(order.vendorOrderId).toBe('999888777')
  })

  it('returns vendor = SHOPIFY', () => {
    const { order } = mapEnvelopeToFacts(makeEnvelope())
    expect(order.vendor).toBe('SHOPIFY')
  })

  it('gross_sales_mu = 888800 for subtotal_price="8888.00" INR', () => {
    const { order } = mapEnvelopeToFacts(makeEnvelope({ subtotal_price: '8888.00' }))
    expect(order.grossSalesMu).toBe(888800n)
  })

  it('net_sales = gross − discount (brain canon, tax NOT subtracted)', () => {
    const { order } = mapEnvelopeToFacts(
      makeEnvelope({ subtotal_price: '8888.00', total_discounts: '200.00' }),
    )
    // gross = 888800, discount = 20000, net = 868800
    expect(order.grossSalesMu).toBe(888800n)
    expect(order.totalDiscountMu).toBe(20000n)
    // net is derived at read time (CH: net_sales_mu = gross − discount), but we
    // validate the raw components here:
    const net = order.grossSalesMu - order.totalDiscountMu
    expect(net).toBe(868800n)
  })

  it('total_tax_mu = 160000 for total_tax="1600.00" INR', () => {
    const { order } = mapEnvelopeToFacts(makeEnvelope({ total_tax: '1600.00' }))
    expect(order.totalTaxMu).toBe(160000n)
  })

  it('currency_code = INR', () => {
    const { order } = mapEnvelopeToFacts(makeEnvelope())
    expect(order.currencyCode).toBe('INR')
  })

  it('financial_status = paid, fulfillment_status = fulfilled', () => {
    const { order } = mapEnvelopeToFacts(makeEnvelope())
    expect(order.financialStatus).toBe('paid')
    expect(order.fulfillmentStatus).toBe('fulfilled')
  })

  it('processedAt = created_at from payload', () => {
    const { order } = mapEnvelopeToFacts(makeEnvelope({ created_at: '2024-01-15T10:30:00Z' }))
    expect(order.processedAt).toBe('2024-01-15T10:30:00Z')
  })

  it('cancelledAt = null when not cancelled', () => {
    const { order } = mapEnvelopeToFacts(makeEnvelope({ cancelled_at: null }))
    expect(order.cancelledAt).toBeNull()
  })

  it('cancelledAt is populated when order is cancelled', () => {
    const { order } = mapEnvelopeToFacts(
      makeEnvelope({ cancelled_at: '2024-01-16T08:00:00Z' }),
    )
    expect(order.cancelledAt).toBe('2024-01-16T08:00:00Z')
  })

  it('delivery_pincode and delivery_city from raw_payload.shipping_address', () => {
    const { order } = mapEnvelopeToFacts(makeEnvelope())
    expect(order.deliveryPincode).toBe('400001')
    expect(order.deliveryCity).toBe('Mumbai')
  })

  it('payment_method = Prepaid for non-COD gateway', () => {
    const { order } = mapEnvelopeToFacts(makeEnvelope())
    expect(order.paymentMethod).toBe('Prepaid')
  })

  it('payment_method = COD when gateway name contains "cod"', () => {
    const rawWithCOD = {
      ...RAW_SHOPIFY_ORDER,
      payment_gateway: 'cod',
      payment_gateway_names: ['cod'],
    }
    const { order } = mapEnvelopeToFacts(makeEnvelope({ raw_payload: rawWithCOD }))
    expect(order.paymentMethod).toBe('COD')
  })

  it('customer_ref is a 32-char hex string (sha256 truncated)', () => {
    const { order } = mapEnvelopeToFacts(makeEnvelope())
    expect(order.customerRef).toMatch(/^[0-9a-f]{32}$/)
  })

  it('customer_ref is NOT the raw email (PII protected)', () => {
    const { order } = mapEnvelopeToFacts(makeEnvelope())
    expect(order.customerRef).not.toContain('customer@example.com')
    expect(order.customerRef).not.toContain('Jane')
  })

  it('orderNumber = "1001"', () => {
    const { order } = mapEnvelopeToFacts(makeEnvelope())
    expect(order.orderNumber).toBe('1001')
  })

  it('shippingMu = 0n (REST webhook does not provide order-level shipping separately)', () => {
    const { order } = mapEnvelopeToFacts(makeEnvelope())
    expect(order.shippingMu).toBe(0n)
  })
})

// ---------------------------------------------------------------------------
// POSITIVE — line items
// ---------------------------------------------------------------------------

describe('mapEnvelopeToFacts — line items', () => {
  it('returns one LineItemFact per raw_payload.line_items entry', () => {
    const { lineItems } = mapEnvelopeToFacts(makeEnvelope())
    expect(lineItems).toHaveLength(1)
  })

  it('vendorLineId = String(li.id)', () => {
    const { lineItems } = mapEnvelopeToFacts(makeEnvelope())
    expect(lineItems[0]!.vendorLineId).toBe('12345678')
  })

  it('vendorOrderId matches order.vendorOrderId', () => {
    const { order, lineItems } = mapEnvelopeToFacts(makeEnvelope())
    expect(lineItems[0]!.vendorOrderId).toBe(order.vendorOrderId)
  })

  it('sku and title are populated', () => {
    const { lineItems } = mapEnvelopeToFacts(makeEnvelope())
    expect(lineItems[0]!.sku).toBe('SKU-001')
    expect(lineItems[0]!.title).toBe('Test Product')
  })

  it('quantity = 2n (bigint)', () => {
    const { lineItems } = mapEnvelopeToFacts(makeEnvelope())
    expect(lineItems[0]!.quantity).toBe(2n)
  })

  it('unit_price_mu = 444400 for price="4444.00" INR', () => {
    const { lineItems } = mapEnvelopeToFacts(makeEnvelope())
    expect(lineItems[0]!.unitPriceMu).toBe(444400n)
  })

  it('gstSlabBp = 1800 (India default)', () => {
    const { lineItems } = mapEnvelopeToFacts(makeEnvelope())
    expect(lineItems[0]!.gstSlabBp).toBe(1800)
  })

  it('returns empty lineItems when raw_payload has no line_items', () => {
    const rawNoLines = { ...RAW_SHOPIFY_ORDER, line_items: [] }
    const { lineItems } = mapEnvelopeToFacts(makeEnvelope({ raw_payload: rawNoLines }))
    expect(lineItems).toHaveLength(0)
  })

  it('generates fallback vendorLineId when li.id is missing', () => {
    const rawMissingId = {
      ...RAW_SHOPIFY_ORDER,
      line_items: [{ sku: 'A', title: 'B', quantity: 1, price: '100.00' }],
    }
    const { lineItems } = mapEnvelopeToFacts(makeEnvelope({ raw_payload: rawMissingId }))
    expect(lineItems[0]!.vendorLineId).toBe('999888777:0')
  })
})

// ---------------------------------------------------------------------------
// POSITIVE — fallback: subtotal_price is missing/zero → use total_price
// ---------------------------------------------------------------------------

describe('mapEnvelopeToFacts — gross_sales fallback', () => {
  it('falls back to total_price when subtotal_price is "0.00"', () => {
    const { order } = mapEnvelopeToFacts(
      makeEnvelope({ subtotal_price: '0.00', total_price: '9000.00' }),
    )
    expect(order.grossSalesMu).toBe(900000n)
  })

  it('falls back to total_price when subtotal_price is "0"', () => {
    const { order } = mapEnvelopeToFacts(
      makeEnvelope({ subtotal_price: '0', total_price: '9000.00' }),
    )
    expect(order.grossSalesMu).toBe(900000n)
  })

  it('uses subtotal_price when it is non-zero', () => {
    const { order } = mapEnvelopeToFacts(
      makeEnvelope({ subtotal_price: '7500.00', total_price: '9000.00' }),
    )
    expect(order.grossSalesMu).toBe(750000n)
  })
})

// ---------------------------------------------------------------------------
// POSITIVE — PII protection
// ---------------------------------------------------------------------------

describe('mapEnvelopeToFacts — PII protection', () => {
  it('customer_ref is null when raw_payload has no customer', () => {
    const rawNoCustomer = { ...RAW_SHOPIFY_ORDER, customer: null }
    const { order } = mapEnvelopeToFacts(makeEnvelope({ raw_payload: rawNoCustomer }))
    expect(order.customerRef).toBeNull()
  })

  it('customer_ref is null when raw_payload is absent', () => {
    const { order } = mapEnvelopeToFacts(makeEnvelope({ raw_payload: null }))
    expect(order.customerRef).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// NEGATIVE — structural failures: throw, so the consumer can log+skip
// ---------------------------------------------------------------------------

describe('mapEnvelopeToFacts — NEGATIVE (structural errors throw)', () => {
  it('throws when shopify_order_id is empty string', () => {
    expect(() =>
      mapEnvelopeToFacts(makeEnvelope({ shopify_order_id: '' })),
    ).toThrow('shopify_order_id is empty')
  })

  it('throws when envelope.payload is not valid JSON', () => {
    const badEnvelope = { ...makeEnvelope(), payload: 'not-json' }
    expect(() => mapEnvelopeToFacts(badEnvelope)).toThrow()
  })

  it('throws when raw_payload is not valid JSON', () => {
    // raw_payload is a JSON string inside the payload; corrupting it causes JSON.parse to throw.
    const payloadObj = JSON.parse(makeEnvelope().payload) as Record<string, unknown>
    payloadObj['raw_payload'] = 'corrupted{'
    const badEnvelope = { ...makeEnvelope(), payload: JSON.stringify(payloadObj) }
    expect(() => mapEnvelopeToFacts(badEnvelope)).toThrow()
  })

  it('throws when decimalStringToMinorUnits receives a non-numeric money string', () => {
    // total_price = "abc" is not a decimal string → the ACL helper throws.
    expect(() =>
      mapEnvelopeToFacts(makeEnvelope({ total_price: 'abc', subtotal_price: '0' })),
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// NEGATIVE — non-order event types (consumer skips these; mapping still called
// only for 'order' — validate that a non-order env would trigger a guard)
// ---------------------------------------------------------------------------

describe('mapEnvelopeToFacts — non-order event_type', () => {
  it('still maps if called with a non-order envelope (guard is in consumer, not here)', () => {
    // The consumer guards on event_type before calling mapEnvelopeToFacts.
    // This test confirms the function itself does not check event_type (single responsibility).
    const result = mapEnvelopeToFacts(makeEnvelope({ event_type: 'product' }))
    // Should succeed — event_type is not validated inside mapEnvelopeToFacts.
    expect(result.order.vendorOrderId).toBe('999888777')
  })
})
