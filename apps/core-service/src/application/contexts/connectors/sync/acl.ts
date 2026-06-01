/**
 * ACL — raw vendor response → canonical Brain fact (Slice E).
 *
 * @paradigm sql (deterministic normalization; NO ML, NO LLM, NO network here)
 *
 * This is the anti-corruption layer the Child-3 contract names ("adapters land raw
 * money verbatim; conversion happens at the ACL"). Slice E's ACL converts vendor
 * decimal-string money → BIGINT minor units WITHOUT float (persona P-004), resolves
 * per-SKU GST slab (India GST 2.0 — feeds the slice-1 per-SKU revenue ladder),
 * classifies payment method (COD/Prepaid), and reduces PII to an OPAQUE customer_ref
 * (sha256 of the vendor customer id) + pincode/city (India RTO metric) — NO email,
 * NO name, NO full address, NO phone reaches the canonical fact (DPDP minimization).
 *
 * Pure functions only. The fetch (network) seam is provider-fetch.ts; the DB write
 * is sync-use-cases.ts. This file is unit-testable with zero IO.
 */

import { createHash } from 'node:crypto'
import type { ConnectorVendor } from '../oauth-state.js'

// ISO 4217 subunit multiplier lookup (mirrors @brain/lib-metrics subunits — CF-C2-SUBUNIT-1:
// read this, never hardcode 100). core-service has no lib-metrics dependency, so the lookup is
// kept local (a few entries) rather than introducing a cross-package dep. INR/AED/SAR/USD=100,
// KWD/BHD=1000 (3-decimal), JPY=1 (0-decimal). Default 100 (the 2-decimal common case).
const SUBUNIT_MULTIPLIERS: Readonly<Record<string, number>> = {
  KWD: 1000, BHD: 1000, JPY: 1, INR: 100, AED: 100, SAR: 100, USD: 100, EUR: 100, GBP: 100,
}
function subunitMultiplier(currencyCode: string): number {
  return SUBUNIT_MULTIPLIERS[currencyCode.toUpperCase()] ?? 100
}

// ---------------------------------------------------------------------------
// Canonical fact shapes (what the ACL produces; what sync-use-cases UPSERTs).
// All *_mu are bigint minor units (paise). NEVER float.
// ---------------------------------------------------------------------------

export interface OrderFact {
  vendor: ConnectorVendor
  vendorOrderId: string
  orderNumber: string | null
  financialStatus: string | null
  fulfillmentStatus: string | null
  paymentMethod: 'COD' | 'Prepaid' | null
  currencyCode: string
  grossSalesMu: bigint
  totalDiscountMu: bigint
  totalTaxMu: bigint
  shippingMu: bigint
  customerRef: string | null
  deliveryPincode: string | null
  deliveryCity: string | null
  processedAt: string | null
  cancelledAt: string | null
}

export interface LineItemFact {
  vendor: ConnectorVendor
  vendorOrderId: string
  vendorLineId: string
  sku: string | null
  title: string | null
  quantity: bigint
  unitPriceMu: bigint
  gstSlabBp: number | null
}

export interface ProductFact {
  vendor: ConnectorVendor
  vendorProductId: string
  title: string | null
  productType: string | null
  status: string | null
}

export interface AdSpendFact {
  vendor: ConnectorVendor
  campaignId: string
  campaignName: string | null
  spendDate: string // ISO yyyy-mm-dd
  spendMu: bigint
  impressions: bigint
  clicks: bigint
  currencyCode: string
}

// ---------------------------------------------------------------------------
// Money — decimal STRING → minor units, WITHOUT float (persona P-004).
//   "4999.00" INR → 499900n   (NOT parseFloat("4999.00")*100 = 499899.99…)
// Splits on '.', integer-parses each part, pads/truncates the fraction to the
// currency's subunit exponent (subunitMultiplier from lib-metrics — never hardcode 100).
// ---------------------------------------------------------------------------

export function decimalStringToMinorUnits(amount: string | number | null | undefined, currencyCode: string): bigint {
  if (amount === null || amount === undefined || amount === '') return 0n
  const mult = subunitMultiplier(currencyCode) // 100 | 1000 | 1
  const exponent = mult === 1 ? 0 : String(mult).length - 1 // 100→2, 1000→3, 1→0

  // Normalize to a plain decimal string (handles number input too, e.g. 4999 / 4999.5).
  let s = typeof amount === 'number' ? amount.toFixed(exponent) : String(amount).trim()
  let negative = false
  if (s.startsWith('-')) {
    negative = true
    s = s.slice(1)
  }
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') {
    throw new Error(`[acl] decimalStringToMinorUnits: not a decimal: ${JSON.stringify(amount)}`)
  }

  const [whole = '0', fracRaw = ''] = s.split('.')
  // Pad or truncate the fraction to exactly `exponent` digits (no rounding beyond cut —
  // vendor money is already at subunit precision; extra digits are a vendor quirk).
  const frac = (fracRaw + '0'.repeat(exponent)).slice(0, exponent)
  const minor = BigInt(whole) * BigInt(mult) + (exponent > 0 ? BigInt(frac) : 0n)
  return negative ? -minor : minor
}

// ---------------------------------------------------------------------------
// Google Ads cost_micros → minor units. Micros are 1e-6 of the currency unit;
// minor units are 1eN of the unit (N = subunit exponent). For INR (×100):
//   minor = round(micros / 10000). 49_990_000 micros → 4999_00 paise.
// Integer arithmetic only (no float).
// ---------------------------------------------------------------------------

export function microsToMinorUnits(micros: string | number | null | undefined, currencyCode: string): bigint {
  if (micros === null || micros === undefined || micros === '') return 0n
  const mult = subunitMultiplier(currencyCode)
  const exponent = mult === 1 ? 0 : String(mult).length - 1
  const m = BigInt(typeof micros === 'number' ? Math.round(micros) : micros.trim())
  // micros = unit * 1e6; minor = unit * 10^exponent → minor = micros * 10^exponent / 1e6
  const divisor = 10n ** BigInt(6 - exponent) // exponent 2 → 10^4 = 10000
  // round-half-up on the integer division
  return (m + divisor / 2n) / divisor
}

// ---------------------------------------------------------------------------
// Payment method classification (India adapter convention). Shopify exposes
// payment_gateway_names / gateway. COD gateways carry "cod"/"cash on delivery".
// ---------------------------------------------------------------------------

export function classifyPaymentMethod(gatewayNames: string[] | string | null | undefined): 'COD' | 'Prepaid' | null {
  if (!gatewayNames) return null
  const arr = Array.isArray(gatewayNames) ? gatewayNames : [gatewayNames]
  if (arr.length === 0) return null
  const joined = arr.join(' ').toLowerCase()
  if (joined.includes('cod') || joined.includes('cash on delivery') || joined.includes('cash_on_delivery')) {
    return 'COD'
  }
  return 'Prepaid'
}

// ---------------------------------------------------------------------------
// Per-SKU GST slab (India GST 2.0: 0 / 5 / 18 / 40 % → bp 0 / 500 / 1800 / 4000).
// Slice E lands the per-SKU STRUCTURE the slice-1 revenue ladder needs. A real
// HSN→slab map is a later slice; here we derive a deterministic per-line slab from
// the order's tax share when the vendor gives an explicit per-line tax, else the
// India-adapter default (18% — the most common DTC slab). Documented in the plan.
// ---------------------------------------------------------------------------

export const INDIA_DEFAULT_GST_BP = 1800

export function resolveGstSlabBp(opts: { explicitBp?: number | null } = {}): number {
  if (opts.explicitBp !== null && opts.explicitBp !== undefined && opts.explicitBp >= 0) {
    return opts.explicitBp
  }
  return INDIA_DEFAULT_GST_BP
}

// ---------------------------------------------------------------------------
// Opaque customer reference — sha256 of the vendor customer id. NOT reversible to
// PII; supports new-vs-returning without storing email/name (DPDP, persona P-006).
// ---------------------------------------------------------------------------

export function customerRef(vendorCustomerId: string | null | undefined): string | null {
  if (!vendorCustomerId) return null
  return createHash('sha256').update(String(vendorCustomerId)).digest('hex').slice(0, 32)
}
