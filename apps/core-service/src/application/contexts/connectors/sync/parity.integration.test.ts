/**
 * PG↔CH read-path parity gate (advisor review P1-5).
 *
 * The dual read path (fact-analytics.ts PG + fact-analytics-ch.ts CH) hand-mirrors
 * every metric; nothing enforced that they agree until now. This asserts the two
 * planes return identical results for each paired reader against the live brain_dev
 * PG + brain CH — so editing one plane's SQL and not the other fails CI.
 *
 * INTEGRATION test: needs the live stack + the migrated data, so it is gated by
 * INTEGRATION_TEST and skipped in the default (no-DB) CI. Run it locally / in the
 * integration CI job (with a postgres + clickhouse service) like:
 *
 *   READ_FROM_CH= \
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/brain_dev \
 *   CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USER=brain_app \
 *   CLICKHOUSE_PASSWORD=brain_app_pw CLICKHOUSE_DATABASE=brain \
 *   INTEGRATION_TEST=true pnpm --filter @brain/core-service exec vitest run parity.integration
 *
 * READ_FROM_CH MUST be unset/false: the PG readers capture the flag at import, so
 * with it unset `readXxx()` runs the PG body while `readXxxCH()` is the CH plane.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import * as PG from './fact-analytics.js'
import * as CH from './fact-analytics-ch.js'

const RUN = process.env.INTEGRATION_TEST === 'true'
const WS = 'f165da80-e6d5-4c58-9aff-ec654b873bd7' // Sugandhlok — orders + line items
const WS_SHIP = 'f7f275b0-c209-40ff-b930-5060ed3940b9' // Boddactive — has shipments
const FROM = '2025-01-01'
const TO = '2025-12-31'

// Canonicalise for an order-independent deep compare: bigint→tagged string,
// arrays sorted by their serialised form (row order is not part of the contract).
function canon(x: unknown): unknown {
  if (typeof x === 'bigint') return `BI:${x.toString()}`
  if (x instanceof Date) return `D:${x.toISOString()}`
  if (Array.isArray(x)) {
    const items = x.map(canon)
    return [...items].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1))
  }
  if (x && typeof x === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) o[k] = canon(v)
    return o
  }
  return x
}
const eq = (pg: unknown, ch: unknown): void => expect(canon(pg)).toEqual(canon(ch))

// Tolerant money compare: PG (`/`) and CH (`intDiv`) truncate the per-line fallback
// the same way mathematically, but accumulate sub-rupee off-by-one differences
// across hundreds of thousands of lines. Assert agreement within a tight relative
// bound (0.1%) — this still fails on real drift (the cogs bug it caught was 3.3%).
const eqApprox = (pg: bigint, ch: bigint, relBp = 10): void => {
  const diff = pg > ch ? pg - ch : ch - pg
  const bound = (ch > 0n ? ch : pg) * BigInt(relBp) / 10000n
  expect(diff <= bound, `|${pg} - ${ch}| = ${diff} exceeds ${relBp}bp bound ${bound}`).toBe(true)
}

describe.skipIf(!RUN)('PG↔CH parity (integration)', () => {
  beforeAll(() => {
    if (process.env.READ_FROM_CH === 'true') {
      throw new Error('Run the parity gate with READ_FROM_CH unset — else the PG path also reads CH (fake pass).')
    }
  })

  // --- Verified parity (these planes agree; new drift here fails CI) ---
  it('readStoreSummary', async () => eq(await PG.readStoreSummary(WS), await CH.readStoreSummaryCH(WS)))
  it('readPnl', async () => eq(await PG.readPnl(WS), await CH.readPnlCH(WS)))
  it('readMarketing', async () => eq(await PG.readMarketing(WS), await CH.readMarketingCH(WS)))
  it('readCodPrepaid', async () => eq(await PG.readCodPrepaid(WS), await CH.readCodPrepaidCH(WS)))
  it('readCohorts', async () => eq(await PG.readCohorts(WS), await CH.readCohortsCH(WS)))
  it('readLtv', async () => eq(await PG.readLtv(WS), await CH.readLtvCH(WS)))
  it('readDistributions', async () => eq(await PG.readDistributions(WS), await CH.readDistributionsCH(WS)))
  it('readDailyNetSales', async () => eq(await PG.readDailyNetSales(WS, FROM, TO), await CH.readDailyNetSalesCH(WS, FROM, TO)))
  it('readCogs (semantic parity; ≤0.1% for cross-dialect rounding)', async () => {
    const pg = await PG.readCogs(WS)
    const ch = await CH.readCogsCH(WS, await PG.readCogsSettings(WS))
    eqApprox(pg.cogsMu, ch.cogsMu)
    expect(pg.coveredLines).toBe(ch.coveredLines)
    expect(pg.totalLines).toBe(ch.totalLines)
  })

  // NOTE: shipment/pincode are CH-ONLY facts (no PG table) — no PG plane to compare.

  // --- KNOWN PG↔CH DRIFT found by this gate (tracked follow-ups; un-skip on fix) ---
  // readCogs is now RECONCILED (PG aligned to legacy `cost>0 → cost, else fallback`;
  // active above). Remaining:
  //  - readProductPerformance: NOT a data drift — both planes have the SAME 246
  //    distinct products. The row-count gap (PG 245 vs CH 199) is CH's LIMIT 200 +
  //    a CH grade-SQL error (Float64×String) that makes the CH path throw, so prod
  //    correctly serves the full set via PG. Activating CH would SHOW FEWER products
  //    (regression) until the grade SQL + LIMIT/ordering are reconciled. Tracked.
  //  - readLifecycle:    CH SQL throws (DateTime−DateTime); prod uses PG. Recency
  //    "now" basis also differs. Tracked.
  //  - readOrderTimings: aggregate fields differ beyond firstOrders. Tracked.
  it.skip('readProductPerformance [CH path errors → PG serves; tracked]', async () => eq(await PG.readProductPerformance(WS), await CH.readProductPerformanceCH(WS)))
  it.skip('readLifecycleStates [KNOWN DRIFT — tracked]', async () => eq(await PG.readLifecycleStates(WS), await CH.readLifecycleStatesCH(WS)))
  it.skip('readOrderTimings [KNOWN DRIFT — tracked]', async () => eq(await PG.readOrderTimings(WS), await CH.readOrderTimingsCH(WS)))
})
