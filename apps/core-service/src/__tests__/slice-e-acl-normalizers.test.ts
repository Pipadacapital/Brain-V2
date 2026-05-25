/**
 * Slice E — ACL + normalizer UNIT tests (no DB, runs in CI).
 *
 * Covers the pure money/GST/normalize logic the persona flagged (P-004/P-005), with
 * both POSITIVE and NEGATIVE scenarios per the code-clarity + coverage standard.
 */

import { describe, it, expect } from 'vitest'
import {
  decimalStringToMinorUnits,
  microsToMinorUnits,
  classifyPaymentMethod,
  customerRef,
  resolveGstSlabBp,
  INDIA_DEFAULT_GST_BP,
} from '../application/connectors/sync/acl.js'
import {
  normalizeShopifyOrder,
  normalizeMetaSpend,
  normalizeGoogleSpend,
  type ShopifyOrderNode,
} from '../application/connectors/sync/normalizers.js'

describe('Slice E — decimalStringToMinorUnits (no float drift)', () => {
  it('converts a 2-decimal rupee string exactly (the float trap)', () => {
    // parseFloat('4999.00')*100 === 499899.99999999994 — this must be 499900n.
    expect(decimalStringToMinorUnits('4999.00', 'INR')).toBe(499900n)
    expect(decimalStringToMinorUnits('899.82', 'INR')).toBe(89982n)
  })
  it('pads a short fraction and truncates a long one', () => {
    expect(decimalStringToMinorUnits('1234.5', 'INR')).toBe(123450n)
    expect(decimalStringToMinorUnits('10.999', 'INR')).toBe(1099n) // truncate to 2 dp
  })
  it('handles whole numbers, zero, empty, null', () => {
    expect(decimalStringToMinorUnits('100', 'INR')).toBe(10000n)
    expect(decimalStringToMinorUnits('0.00', 'INR')).toBe(0n)
    expect(decimalStringToMinorUnits('', 'INR')).toBe(0n)
    expect(decimalStringToMinorUnits(null, 'INR')).toBe(0n)
    expect(decimalStringToMinorUnits(undefined, 'INR')).toBe(0n)
  })
  it('respects the currency subunit exponent (KWD ×1000, JPY ×1)', () => {
    expect(decimalStringToMinorUnits('1.234', 'KWD')).toBe(1234n)
    expect(decimalStringToMinorUnits('500', 'JPY')).toBe(500n)
  })
  it('handles negatives (refund-style amounts)', () => {
    expect(decimalStringToMinorUnits('-50.00', 'INR')).toBe(-5000n)
  })
  it('NEGATIVE: throws on a non-decimal string', () => {
    expect(() => decimalStringToMinorUnits('abc', 'INR')).toThrow()
    expect(() => decimalStringToMinorUnits('1.2.3', 'INR')).toThrow()
  })
})

describe('Slice E — microsToMinorUnits (Google Ads cost_micros)', () => {
  it('converts micros → paise: ₹3000.00 = 3_000_000_000 micros → 300000 paise', () => {
    // cost_micros = currency-units × 1e6. ₹3000 = 3_000_000_000 micros = 300000 paise.
    expect(microsToMinorUnits('3000000000', 'INR')).toBe(300000n)
    // 30_000_000 micros = ₹30.00 = 3000 paise.
    expect(microsToMinorUnits('30000000', 'INR')).toBe(3000n)
  })
  it('rounds half-up on the integer division', () => {
    // 49999 micros for INR → 49999/10000 = 4.9999 → 5 paise.
    expect(microsToMinorUnits('49999', 'INR')).toBe(5n)
  })
  it('handles zero / null', () => {
    expect(microsToMinorUnits('0', 'INR')).toBe(0n)
    expect(microsToMinorUnits(null, 'INR')).toBe(0n)
  })
})

describe('Slice E — classifyPaymentMethod (India COD/Prepaid)', () => {
  it('detects COD from gateway names', () => {
    expect(classifyPaymentMethod(['cod'])).toBe('COD')
    expect(classifyPaymentMethod(['Cash on Delivery'])).toBe('COD')
  })
  it('treats everything else as Prepaid', () => {
    expect(classifyPaymentMethod(['razorpay'])).toBe('Prepaid')
    expect(classifyPaymentMethod('stripe')).toBe('Prepaid')
  })
  it('NEGATIVE: null/empty → null', () => {
    expect(classifyPaymentMethod(null)).toBe(null)
    expect(classifyPaymentMethod([])).toBe(null)
  })
})

describe('Slice E — customerRef (PII minimization)', () => {
  it('returns an opaque 32-char hex, NOT the input', () => {
    const ref = customerRef('gid://shopify/Customer/55')
    expect(ref).toMatch(/^[0-9a-f]{32}$/)
    expect(ref).not.toContain('55')
    expect(ref).not.toContain('Customer')
  })
  it('is stable (same id → same ref) for new-vs-returning', () => {
    expect(customerRef('abc')).toBe(customerRef('abc'))
    expect(customerRef('abc')).not.toBe(customerRef('xyz'))
  })
  it('NEGATIVE: null → null', () => {
    expect(customerRef(null)).toBe(null)
    expect(customerRef(undefined)).toBe(null)
  })
})

describe('Slice E — resolveGstSlabBp', () => {
  it('defaults to 18% (the common DTC slab) when no explicit slab', () => {
    expect(resolveGstSlabBp()).toBe(INDIA_DEFAULT_GST_BP)
    expect(resolveGstSlabBp()).toBe(1800)
  })
  it('respects an explicit slab (0/5/40)', () => {
    expect(resolveGstSlabBp({ explicitBp: 0 })).toBe(0)
    expect(resolveGstSlabBp({ explicitBp: 500 })).toBe(500)
    expect(resolveGstSlabBp({ explicitBp: 4000 })).toBe(4000)
  })
})

describe('Slice E — normalizeShopifyOrder (real GraphQL shape)', () => {
  const node: ShopifyOrderNode = {
    id: 'gid://shopify/Order/1001',
    name: '#1001',
    currencyCode: 'INR',
    subtotalPriceSet: { shopMoney: { amount: '4999.00', currencyCode: 'INR' } },
    totalTaxSet: { shopMoney: { amount: '899.82', currencyCode: 'INR' } },
    totalDiscountsSet: { shopMoney: { amount: '0.00' } },
    paymentGatewayNames: ['razorpay'],
    customer: { id: 'gid://shopify/Customer/55' },
    shippingAddress: { zip: '560001', city: 'Bengaluru' },
    processedAt: '2026-05-01T10:00:00Z',
    lineItems: {
      edges: [
        {
          node: {
            id: 'gid://shopify/LineItem/9001',
            title: 'Attar Oud 12ml',
            quantity: 2,
            sku: 'OUD-12',
            originalUnitPriceSet: { shopMoney: { amount: '2499.50' } },
          },
        },
      ],
    },
  }

  it('maps money to minor units + classifies payment + minimizes PII', () => {
    const { order, lineItems } = normalizeShopifyOrder(node)
    expect(order.vendorOrderId).toBe('gid://shopify/Order/1001')
    expect(order.grossSalesMu).toBe(499900n)
    expect(order.totalTaxMu).toBe(89982n)
    expect(order.totalDiscountMu).toBe(0n)
    expect(order.paymentMethod).toBe('Prepaid')
    expect(order.deliveryPincode).toBe('560001')
    expect(order.deliveryCity).toBe('Bengaluru')
    // PII minimization: customerRef is opaque, NOT the raw id; no email/name on the fact.
    expect(order.customerRef).toMatch(/^[0-9a-f]{32}$/)
    const serialized = JSON.stringify(order, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    expect(serialized).not.toContain('Customer/55')
    expect(serialized).not.toContain('email')
  })

  it('maps line items with sku + per-SKU GST slab', () => {
    const { lineItems } = normalizeShopifyOrder(node)
    expect(lineItems).toHaveLength(1)
    expect(lineItems[0]!.sku).toBe('OUD-12')
    expect(lineItems[0]!.quantity).toBe(2n)
    expect(lineItems[0]!.unitPriceMu).toBe(249950n)
    expect(lineItems[0]!.gstSlabBp).toBe(1800)
  })
})

describe('Slice E — normalizeMetaSpend / normalizeGoogleSpend', () => {
  it('Meta: spend string → minor units, ints parsed', () => {
    const f = normalizeMetaSpend({ campaign_id: 'm1', campaign_name: 'P', impressions: '12000', clicks: '340', spend: '5000.00', date_start: '2026-05-01', currency: 'INR' })
    expect(f.vendor).toBe('META')
    expect(f.spendMu).toBe(500000n)
    expect(f.impressions).toBe(12000n)
    expect(f.clicks).toBe(340n)
    expect(f.spendDate).toBe('2026-05-01')
  })
  it('Google: cost_micros → minor units (₹3000.00 = 3_000_000_000 micros)', () => {
    const f = normalizeGoogleSpend({ campaign: { id: 'g1', name: 'S' }, metrics: { cost_micros: '3000000000', impressions: '8000', clicks: '210' }, segments: { date: '2026-05-01' } })
    expect(f.vendor).toBe('GOOGLE')
    expect(f.campaignId).toBe('g1')
    expect(f.spendMu).toBe(300000n)
    expect(f.impressions).toBe(8000n)
    expect(f.spendDate).toBe('2026-05-01')
  })
})
