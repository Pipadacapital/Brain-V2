// @paradigm: sql
// Data-plane test: prove logistics forward/cod charges are SUMMED from facts
// (not hardcoded 0) in the loopback StubDataPlane.
//
// POSITIVE: loopback getLogistics returns non-zero forward_charges_mu
// POSITIVE: loopback getLogistics returns non-zero cod_charges_mu
// POSITIVE: forward + cod + rto = total (no phantom discrepancy)
// POSITIVE: loopback getCodPrepaid computes effective revenue (not gross = effective)
// POSITIVE: loopback getCodPrepaid computes non-zero fee_total_mu per row
// POSITIVE: loopback getCodPrepaid break-even is non-null
// POSITIVE: loopback getCodPrepaid accepts fee overrides and recomputes
// POSITIVE: loopback getRtoAnalytics includes connected=true for seeded workspace
// POSITIVE: loopback getRtoAnalytics includes by_product (may be empty)
// POSITIVE: loopback getCodPrepaid includes connected=true for seeded workspace
// POSITIVE: loopback getCodPrepaid includes fee_overrides echoed back
// NEGATIVE: wrong workspace_id throws UnscopedQueryError

import { describe, it, expect } from 'vitest';
import { StubDataPlane, InMemoryDecisionLog, SUGANDH_LOK_WORKSPACE_ID } from './loopback-data-plane.js';

const WS = SUGANDH_LOK_WORKSPACE_ID;
const DATE_RANGE = { start: '2026-04-01', end: '2026-04-30' };

function makeStub() {
  return new StubDataPlane(new InMemoryDecisionLog(), WS);
}

// ---------------------------------------------------------------------------
// Logistics — charge decomposition
// ---------------------------------------------------------------------------

describe('StubDataPlane.getLogistics — charge decomposition', () => {
  it('forward_charges_mu is non-zero (summed, not hardcoded 0)', async () => {
    const stub = makeStub();
    const { result } = await stub.getLogistics({ workspace_id: WS, date_range: DATE_RANGE });
    expect(result.forward_charges_mu).toBeGreaterThan(0n);
  });

  it('cod_charges_mu is non-zero (summed, not hardcoded 0)', async () => {
    const stub = makeStub();
    const { result } = await stub.getLogistics({ workspace_id: WS, date_range: DATE_RANGE });
    expect(result.cod_charges_mu).toBeGreaterThan(0n);
  });

  it('forward + cod + rto sums to total_shiprocket_charges_mu', async () => {
    const stub = makeStub();
    const { result } = await stub.getLogistics({ workspace_id: WS, date_range: DATE_RANGE });
    const summed = result.forward_charges_mu + result.cod_charges_mu + result.rto_charges_mu;
    expect(summed).toBe(result.total_shiprocket_charges_mu);
  });

  it('cod_count and prepaid_count are present (By Payment Method data)', async () => {
    const stub = makeStub();
    const { result } = await stub.getLogistics({ workspace_id: WS, date_range: DATE_RANGE });
    expect(result.cod_count).toBeGreaterThanOrEqual(0n);
    expect(result.prepaid_count).toBeGreaterThanOrEqual(0n);
  });

  it('by_courier is non-empty for seeded workspace', async () => {
    const stub = makeStub();
    const { result } = await stub.getLogistics({ workspace_id: WS, date_range: DATE_RANGE });
    expect(result.by_courier.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// CodPrepaid — effective revenue and fee computation
// ---------------------------------------------------------------------------

describe('StubDataPlane.getCodPrepaid — real computation', () => {
  it('connected=true for seeded workspace', async () => {
    const stub = makeStub();
    const { result } = await stub.getCodPrepaid({ workspace_id: WS, date_range: DATE_RANGE });
    expect(result.connected).toBe(true);
  });

  it('effective_revenue_cod_mu < gross_revenue (RTO + fees deducted)', async () => {
    const stub = makeStub();
    const { result } = await stub.getCodPrepaid({ workspace_id: WS, date_range: DATE_RANGE });
    const codRow = result.comparison.find((r) => r.payment_method === 'COD');
    expect(codRow).toBeDefined();
    expect(result.effective_revenue_cod_mu).toBeLessThan(codRow!.gross_revenue_mu);
  });

  it('fee_total_mu is non-zero for COD row', async () => {
    const stub = makeStub();
    const { result } = await stub.getCodPrepaid({ workspace_id: WS, date_range: DATE_RANGE });
    const codRow = result.comparison.find((r) => r.payment_method === 'COD');
    expect(codRow!.fee_total_mu).toBeGreaterThan(0n);
  });

  it('fee_total_mu is non-zero for Prepaid row', async () => {
    const stub = makeStub();
    const { result } = await stub.getCodPrepaid({ workspace_id: WS, date_range: DATE_RANGE });
    const prepaidRow = result.comparison.find((r) => r.payment_method === 'Prepaid');
    expect(prepaidRow!.fee_total_mu).toBeGreaterThan(0n);
  });

  it('net_revenue_mu = effective_revenue_mu - fee_total_mu for each row', async () => {
    const stub = makeStub();
    const { result } = await stub.getCodPrepaid({ workspace_id: WS, date_range: DATE_RANGE });
    for (const row of result.comparison) {
      expect(row.net_revenue_mu).toBe(row.effective_revenue_mu - row.fee_total_mu);
    }
  });

  it('breakeven_cod_rto_rate_bp is non-null', async () => {
    const stub = makeStub();
    const { result } = await stub.getCodPrepaid({ workspace_id: WS, date_range: DATE_RANGE });
    expect(result.breakeven_cod_rto_rate_bp).not.toBeNull();
  });

  it('prepaid_premium_mu = effective_prepaid - effective_cod', async () => {
    const stub = makeStub();
    const { result } = await stub.getCodPrepaid({ workspace_id: WS, date_range: DATE_RANGE });
    expect(result.prepaid_premium_mu).toBe(
      result.effective_revenue_prepaid_mu - result.effective_revenue_cod_mu,
    );
  });

  it('fee_overrides are echoed back', async () => {
    const stub = makeStub();
    const { result } = await stub.getCodPrepaid({ workspace_id: WS, date_range: DATE_RANGE });
    // Default overrides are always echoed
    expect(result.fee_overrides.cod_fee_per_order_mu).toBeDefined();
    expect(result.fee_overrides.return_shipping_per_rto_mu).toBeDefined();
    expect(result.fee_overrides.gateway_fee_bp).toBeDefined();
  });

  it('fee override changes breakeven (higher COD fee → lower breakeven)', async () => {
    const stub = makeStub();
    const { result: defaultResult } = await stub.getCodPrepaid({
      workspace_id: WS, date_range: DATE_RANGE,
    });
    // Double the COD fee — break-even should change
    const { result: highFeeResult } = await stub.getCodPrepaid({
      workspace_id: WS,
      date_range: DATE_RANGE,
      fee_overrides: {
        cod_fee_per_order_mu: 6000n, // ₹60 instead of default ₹30
      },
    });
    // With a higher COD fee the break-even COD RTO rate shifts
    expect(highFeeResult.breakeven_cod_rto_rate_bp).not.toBe(
      defaultResult.breakeven_cod_rto_rate_bp,
    );
  });

  it('wrong workspace_id throws UnscopedQueryError', async () => {
    const stub = makeStub();
    await expect(
      stub.getCodPrepaid({ workspace_id: 'wrong-ws', date_range: DATE_RANGE }),
    ).rejects.toThrow('UnscopedQueryError');
  });
});

// ---------------------------------------------------------------------------
// RtoAnalytics — connected flag + by_product
// ---------------------------------------------------------------------------

describe('StubDataPlane.getRtoAnalytics — connected + by_product', () => {
  it('connected=true for seeded workspace', async () => {
    const stub = makeStub();
    const { result } = await stub.getRtoAnalytics({ workspace_id: WS, date_range: DATE_RANGE });
    expect(result.connected).toBe(true);
  });

  it('by_product is an array (may be empty — Shopify enrichment optional)', async () => {
    const stub = makeStub();
    const { result } = await stub.getRtoAnalytics({ workspace_id: WS, date_range: DATE_RANGE });
    expect(Array.isArray(result.by_product)).toBe(true);
  });

  it('by_payment_method has COD and Prepaid entries', async () => {
    const stub = makeStub();
    const { result } = await stub.getRtoAnalytics({ workspace_id: WS, date_range: DATE_RANGE });
    const methods = result.by_payment_method.map((r) => r.payment_method);
    expect(methods).toContain('COD');
    expect(methods).toContain('Prepaid');
  });

  it('rto_rate_bp is non-null (seeded workspace has shipments)', async () => {
    const stub = makeStub();
    const { result } = await stub.getRtoAnalytics({ workspace_id: WS, date_range: DATE_RANGE });
    expect(result.rto_rate_bp).not.toBeNull();
  });

  it('wrong workspace_id throws UnscopedQueryError', async () => {
    const stub = makeStub();
    await expect(
      stub.getRtoAnalytics({ workspace_id: 'wrong-ws', date_range: DATE_RANGE }),
    ).rejects.toThrow('UnscopedQueryError');
  });
});
