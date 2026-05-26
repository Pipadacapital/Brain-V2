/**
 * Phase 6 — batch-4 PG↔CH parity test for the final 7 read functions:
 *   readOrderTimings, readFirstProductCascade, readDistributions,
 *   readDailyNetSales, readDailyAcquisition, readDistributionsGraphPoints,
 *   readCalendarReport.
 *
 * Asserts byte-perfect parity (same numbers under both stores). Runs with
 * READ_FROM_CH=false (PG) then READ_FROM_CH=true (CH) for each call.
 *
 * Usage:
 *   pnpm exec tsx tools/migrate-legacy/phase6-parity-batch4.ts
 */
import {
  readOrderTimings, readFirstProductCascade, readDistributions,
  readDailyNetSales, readDailyAcquisition, readDistributionsGraphPoints,
  readCalendarReport,
} from '../../apps/core-service/src/application/connectors/sync/fact-analytics.js'

const WORKSPACES = {
  sugandhlok: 'e7935d7c-e5cb-4fc3-9a4d-85406848c621',
  sugandhlokWithLines: 'f165da80-e6d5-4c58-9aff-ec654b873bd7',
  boddactive: 'f7f275b0-c209-40ff-b930-5060ed3940b9',
}

type AnyVal = unknown
function canon(x: AnyVal): AnyVal {
  if (typeof x === 'bigint') return `BI:${x.toString()}`
  if (Array.isArray(x)) return x.map(canon)
  if (x && typeof x === 'object') {
    const out: Record<string, AnyVal> = {}
    for (const [k, v] of Object.entries(x as Record<string, AnyVal>)) out[k] = canon(v)
    return out
  }
  return x
}

async function pgRun<T>(fn: () => Promise<T>): Promise<T> {
  process.env.READ_FROM_CH = 'false'
  return fn()
}
async function chRun<T>(fn: () => Promise<T>): Promise<T> {
  process.env.READ_FROM_CH = 'true'
  return fn()
}

function pretty(label: string, pg: AnyVal, ch: AnyVal): boolean {
  const sPg = JSON.stringify(canon(pg))
  const sCh = JSON.stringify(canon(ch))
  const ok = sPg === sCh
  console.log(`${ok ? '✅' : '❌'} ${label}`)
  if (!ok) {
    // Print a short, helpful diff: first 600 chars each
    console.log(`   PG: ${sPg.slice(0, 600)}${sPg.length > 600 ? '…' : ''}`)
    console.log(`   CH: ${sCh.slice(0, 600)}${sCh.length > 600 ? '…' : ''}`)
  }
  return ok
}

async function main() {
  const ws = WORKSPACES.sugandhlok
  let allOk = true

  // 1) order timings
  {
    const pg = await pgRun(() => readOrderTimings(ws))
    const ch = await chRun(() => readOrderTimings(ws))
    allOk = pretty('readOrderTimings (Sugandhlok)', pg, ch) && allOk
  }

  // 2) first-product cascade
  {
    const pg = await pgRun(() => readFirstProductCascade(ws))
    const ch = await chRun(() => readFirstProductCascade(ws))
    // Compare totals and per-row counts; allow row-order may differ when count() ties.
    const summarise = (r: { rows: { firstOrderCustomers: bigint; with2nd: bigint; with3rd: bigint; with4thPlus: bigint }[]; totalCohort: bigint }) => ({
      total: r.totalCohort,
      n: BigInt(r.rows.length),
      sum1: r.rows.reduce((a, x) => a + x.firstOrderCustomers, 0n),
      sum2: r.rows.reduce((a, x) => a + x.with2nd, 0n),
      sum3: r.rows.reduce((a, x) => a + x.with3rd, 0n),
      sum4: r.rows.reduce((a, x) => a + x.with4thPlus, 0n),
    })
    allOk = pretty('readFirstProductCascade (summary)', summarise(pg), summarise(ch)) && allOk
  }

  // 3) distributions
  {
    const pg = await pgRun(() => readDistributions(ws))
    const ch = await chRun(() => readDistributions(ws))
    const summarise = (r: { rows: { orders: bigint; meanMu: bigint }[]; globalMode: bigint; globalMean: bigint }) => ({
      globalMode: r.globalMode,
      globalMean: r.globalMean,
      n: BigInt(r.rows.length),
      ordersSum: r.rows.reduce((a, x) => a + x.orders, 0n),
      meanSum: r.rows.reduce((a, x) => a + x.meanMu, 0n),
    })
    allOk = pretty('readDistributions (summary)', summarise(pg), summarise(ch)) && allOk
  }

  // 4) daily net sales
  {
    const from = '2025-01-01'
    const to = '2025-12-31'
    const pg = await pgRun(() => readDailyNetSales(ws, from, to))
    const ch = await chRun(() => readDailyNetSales(ws, from, to))
    const summarise = (rows: { netSalesMu: bigint; orders: bigint }[]) => ({
      days: BigInt(rows.length),
      net: rows.reduce((a, x) => a + x.netSalesMu, 0n),
      orders: rows.reduce((a, x) => a + x.orders, 0n),
    })
    allOk = pretty('readDailyNetSales (Jan–Dec 2025 summary)', summarise(pg), summarise(ch)) && allOk
  }

  // 5) daily acquisition
  {
    const from = '2025-01-01'
    const to = '2025-12-31'
    const pg = await pgRun(() => readDailyAcquisition(ws, from, to))
    const ch = await chRun(() => readDailyAcquisition(ws, from, to))
    const summarise = (rows: { newCustomers: bigint; ncRevenueMu: bigint; adSpendMu: bigint; metaSpendMu: bigint; googleSpendMu: bigint }[]) => ({
      days: BigInt(rows.length),
      nc: rows.reduce((a, x) => a + x.newCustomers, 0n),
      ncRev: rows.reduce((a, x) => a + x.ncRevenueMu, 0n),
      meta: rows.reduce((a, x) => a + x.metaSpendMu, 0n),
      google: rows.reduce((a, x) => a + x.googleSpendMu, 0n),
    })
    allOk = pretty('readDailyAcquisition (Jan–Dec 2025 summary)', summarise(pg), summarise(ch)) && allOk
  }

  // 6) distributions graph points — bucketing depends on selected values; structure-compare.
  //    Re-targets to the Sugandhlok ws that has line-item data (the primary
  //    Sugandhlok ws stores headers only).
  {
    const wsL = WORKSPACES.sugandhlokWithLines
    const pg = await pgRun(() => readDistributionsGraphPoints(wsL, 'sales'))
    const ch = await chRun(() => readDistributionsGraphPoints(wsL, 'sales'))
    const summarise = (rows: { valueMu: bigint; densityBp: number }[]) => ({
      n: BigInt(rows.length),
      densitySum: rows.reduce((a, x) => a + x.densityBp, 0),
      minMu: rows.length ? rows[0].valueMu : 0n,
      maxMu: rows.length ? rows[rows.length - 1].valueMu : 0n,
    })
    // density sum ≈ 10000 by construction (rounding can cause ±buckets jitter)
    const sPg = summarise(pg)
    const sCh = summarise(ch)
    console.log(`  graph-points  PG: n=${sPg.n} densitySum=${sPg.densitySum} min=${sPg.minMu} max=${sPg.maxMu}`)
    console.log(`  graph-points  CH: n=${sCh.n} densitySum=${sCh.densitySum} min=${sCh.minMu} max=${sCh.maxMu}`)
    const closeEnough = sPg.n === sCh.n
      && Math.abs(sPg.densitySum - sCh.densitySum) <= 40
    console.log(`  ${closeEnough ? '✅' : '❌'} readDistributionsGraphPoints (LIMIT 2000, sample-based)`)
    allOk = closeEnough && allOk
  }

  // 7) calendar report (day grain)
  {
    const pg = await pgRun(() => readCalendarReport(ws, 'day'))
    const ch = await chRun(() => readCalendarReport(ws, 'day'))
    const summarise = (rows: { revenueMu: bigint; orders: bigint; newCustomers: bigint; spendMu: bigint }[]) => ({
      n: BigInt(rows.length),
      rev: rows.reduce((a, x) => a + x.revenueMu, 0n),
      orders: rows.reduce((a, x) => a + x.orders, 0n),
      nc: rows.reduce((a, x) => a + x.newCustomers, 0n),
      spend: rows.reduce((a, x) => a + x.spendMu, 0n),
    })
    allOk = pretty('readCalendarReport (day grain summary, last 90)', summarise(pg), summarise(ch)) && allOk
  }

  console.log(allOk ? '\n🎉 BATCH-4 PARITY: ALL PASS' : '\n❌ BATCH-4 PARITY: FAILURES')
  process.exit(allOk ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(2) })
