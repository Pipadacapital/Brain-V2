/**
 * Platform-ads use-cases — campaign-level breakdown for /meta-ads and
 * /google-ads (Slice 5 of the parity epic).
 *
 * @paradigm sql (deterministic; no LLM)
 *
 * What we have today (PG schema):
 *   connector_ad_spend_facts(id, workspace_id, vendor::connector_vendor,
 *     campaign_id, campaign_name, spend_date, spend_mu, impressions, clicks,
 *     currency_code, synced_at).
 *   No ad_account_id, no conversions, no revenue_mu locally — the CH-side
 *   table 0006_connector_ad_facts.sql carries those, but the PG mirror was
 *   sized for the minimum metric-engine input. So ROAS / conversions columns
 *   surface as 0 here (honest 0n, per CF-S10-HONEST-STATE-1); when the wider
 *   facts arrive on PG these queries surface the real numbers without change.
 *
 * What this module returns
 *   - listCampaigns(vendor, date_range): per-campaign aggregate with intent
 *     joined from workspace_ad_campaign_classifications, sorted by spend DESC.
 *     Includes CTR/CPC/CPM/ROAS computed in SQL (integer math; CF-MONEY-MU-1).
 *   - listAdAccounts(vendor): distinct ad_account_id values for the account
 *     selector (legacy parity).
 *   - spendByIntent(vendor, date_range): aggregate spend grouped by intent.
 *
 * Slice 5 honesty contract (CF-S10-HONEST-STATE-1, persona C2): the Performance
 * tab uses these REAL functions on REAL data. Funnel + Creative tabs render
 * ConnectorPending stubs because the data (meta_ads_creative_daily,
 * meta_ads_funnel_daily, google_ads_funnel_daily) is not yet ingested into
 * Brain-native facts. NEVER fabricate.
 */

import type { PoolClient } from 'pg'
import { chQuery } from '@brain/lib-clickhouse-ts'
import { withWorkspace } from '../../../infrastructure/db/workspace-context.js'

// READ_FROM_CH overlays revenue/conversions/ROAS from the wider CH ad facts onto
// the PG result (PG mirror carries only spend/impressions/clicks). Default OFF.
const READ_FROM_CH = process.env.READ_FROM_CH === 'true'

export type AdVendor = 'META' | 'GOOGLE'

export interface CampaignRow {
  campaignId: string
  campaignName: string
  adAccountId: string
  intent: string                          // 'unclassified' when no classification row
  spendMu: bigint
  impressions: number
  clicks: number
  conversions: number
  revenueMu: bigint
  /** Click-through rate in basis points (clicks / impressions, ×10000). */
  ctrBp: number
  /** Cost per click in minor units. 0 when clicks = 0. */
  cpcMu: bigint
  /** Cost per mille (1000 impressions). 0 when impressions = 0. */
  cpmMu: bigint
  /** Return on ad spend in basis points (revenue / spend, ×10000). 0 when spend = 0. */
  roasBp: number
  currencyCode: string
}

export interface CampaignsListResult {
  rows: CampaignRow[]
  totalSpendMu: bigint
  totalImpressions: number
  totalClicks: number
  totalConversions: number
  totalRevenueMu: bigint
  currencyCode: string
}

export interface IntentSpendRow {
  intent: string
  spendMu: bigint
  spendBp: number                         // share of total ad spend, basis points
}

export async function listCampaigns(
  workspaceId: string,
  vendor: AdVendor,
  dateStart: string,
  dateEnd: string,
  opts: { adAccountId?: string | null; intent?: string | null } = {},
): Promise<CampaignsListResult> {
  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    const where: string[] = [
      `f.vendor = $1::connector_vendor`,
      `f.spend_date >= $2::date`,
      `f.spend_date <= $3::date`,
    ]
    const args: unknown[] = [vendor, dateStart, dateEnd]
    // adAccountId filter is a no-op locally (column not in PG mirror); accepted
    // for forward-compat with the wider CH facts.
    // intent is aggregated per-campaign (max(c.intent)); the HAVING filter must
    // reference the SAME aggregate expression — a bare c.intent here errors with
    // "must appear in the GROUP BY clause" since GROUP BY is f.campaign_id only.
    const intentWhere = opts.intent
      ? `AND coalesce(max(c.intent), 'unclassified') = $${args.length + 1}`
      : ``
    if (opts.intent) args.push(opts.intent)

    const res = await tx.query<{
      campaign_id: string
      campaign_name: string | null
      intent: string
      spend_mu: string
      impressions: string
      clicks: string
      currency_code: string | null
    }>(
      `SELECT f.campaign_id                                AS campaign_id,
              coalesce(max(f.campaign_name), '')           AS campaign_name,
              coalesce(max(c.intent), 'unclassified')      AS intent,
              sum(f.spend_mu)::text                        AS spend_mu,
              coalesce(sum(f.impressions), 0)::text        AS impressions,
              coalesce(sum(f.clicks),      0)::text        AS clicks,
              coalesce(max(f.currency_code), 'INR')        AS currency_code
         FROM public.connector_ad_spend_facts f
         LEFT JOIN public.workspace_ad_campaign_classifications c
                ON c.workspace_id = f.workspace_id
               AND c.platform = f.vendor::text
               AND c.campaign_id = f.campaign_id
        WHERE ${where.join(' AND ')}
        GROUP BY f.campaign_id
        HAVING true ${intentWhere}
        ORDER BY sum(f.spend_mu) DESC NULLS LAST
        LIMIT 500`,
      args,
    )

    const rows: CampaignRow[] = res.rows.map((r) => {
      const spend = BigInt(r.spend_mu ?? '0')
      const imp = Number(r.impressions ?? '0')
      const clicks = Number(r.clicks ?? '0')
      const ctrBp = imp > 0 ? Math.round((clicks * 10000) / imp) : 0
      const cpcMu = clicks > 0 ? spend / BigInt(clicks) : 0n
      const cpmMu = imp > 0 ? (spend * 1000n) / BigInt(imp) : 0n
      // Conversions / revenue / ROAS aren't in the PG ad facts mirror yet —
      // surface honest 0n / 0 so the column renders but the operator sees
      // we're not fabricating. When the wider facts land these flip to real.
      return {
        campaignId: r.campaign_id,
        campaignName: r.campaign_name || r.campaign_id,
        adAccountId: '',
        intent: r.intent || 'unclassified',
        spendMu: spend,
        impressions: imp,
        clicks,
        conversions: 0,
        revenueMu: 0n,
        ctrBp,
        cpcMu,
        cpmMu,
        roasBp: 0,
        currencyCode: r.currency_code ?? 'INR',
      }
    })

    // Overlay real revenue / conversions / ROAS from the CH ad facts (the PG
    // mirror only has spend/impressions/clicks). Best-effort: on any CH failure
    // the PG honest-0 stands, so the page never breaks.
    if (READ_FROM_CH && rows.length > 0) {
      try {
        const chRows = await chQuery<{ campaign_id: string; revenue_mu: string; conversions: string }>(
          `SELECT campaign_id,
                  toString(sum(revenue_mu))  AS revenue_mu,
                  toString(sum(conversions)) AS conversions
             FROM brain.connector_ad_spend_facts
            WHERE workspace_id = {workspace_id:String}
              AND vendor = {ad_vendor:String}
              AND date >= {date_start:String} AND date <= {date_end:String}
            GROUP BY campaign_id`,
          { workspaceId, params: { ad_vendor: vendor, date_start: dateStart, date_end: dateEnd } },
        )
        const chMap = new Map(chRows.map((c) => [c.campaign_id, c]))
        for (const r of rows) {
          const ch = chMap.get(r.campaignId)
          if (!ch) continue
          r.revenueMu = BigInt(ch.revenue_mu ?? '0')
          r.conversions = Number(ch.conversions ?? '0')
          r.roasBp = r.spendMu > 0n ? Number((r.revenueMu * 10000n) / r.spendMu) : 0
        }
      } catch { /* CH overlay best-effort; PG honest-0 stands */ }
    }

    const totals = rows.reduce(
      (a, r) => ({
        spend: a.spend + r.spendMu,
        impr: a.impr + r.impressions,
        clicks: a.clicks + r.clicks,
        conv: a.conv + r.conversions,
        rev: a.rev + r.revenueMu,
      }),
      { spend: 0n, impr: 0, clicks: 0, conv: 0, rev: 0n },
    )

    return {
      rows,
      totalSpendMu: totals.spend,
      totalImpressions: totals.impr,
      totalClicks: totals.clicks,
      totalConversions: totals.conv,
      totalRevenueMu: totals.rev,
      currencyCode: rows[0]?.currencyCode ?? 'INR',
    }
  })
}

export async function listAdAccounts(
  workspaceId: string,
  vendor: AdVendor,
): Promise<{ adAccountId: string; campaigns: number }[]> {
  // ad_account_id is not present on the PG facts mirror; legacy parity is the
  // shape of the selector (a list with at least one entry). We return a single
  // synthetic "all" row whose count is the total distinct campaigns. When the
  // wider PG facts land, swap this to a real GROUP BY ad_account_id.
  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    const res = await tx.query<{ n: string }>(
      `SELECT count(DISTINCT campaign_id)::text AS n
         FROM public.connector_ad_spend_facts
        WHERE vendor = $1::connector_vendor`,
      [vendor],
    )
    const n = Number(res.rows[0]?.n ?? '0')
    return n > 0 ? [{ adAccountId: 'all', campaigns: n }] : []
  })
}

export async function spendByIntent(
  workspaceId: string,
  vendor: AdVendor,
  dateStart: string,
  dateEnd: string,
): Promise<{ rows: IntentSpendRow[]; totalSpendMu: bigint }> {
  return withWorkspace(workspaceId, async (tx: PoolClient) => {
    const res = await tx.query<{ intent: string; spend_mu: string }>(
      `SELECT coalesce(max(c.intent), 'unclassified') AS intent,
              sum(f.spend_mu)::text                  AS spend_mu
         FROM public.connector_ad_spend_facts f
         LEFT JOIN public.workspace_ad_campaign_classifications c
                ON c.workspace_id = f.workspace_id
               AND c.platform = f.vendor::text
               AND c.campaign_id = f.campaign_id
        WHERE f.vendor = $1::connector_vendor
          AND f.spend_date >= $2::date
          AND f.spend_date <= $3::date
        GROUP BY f.campaign_id
        -- Re-aggregate at intent level (one row per campaign, then sum).
        `,
      [vendor, dateStart, dateEnd],
    )
    // Roll up campaign rows to intent-level. (PG's GROUP BY chooses one row
    // per campaign; we re-aggregate here so a campaign that's both in two
    // classifications doesn't double-count — defensive, normally a no-op.)
    const byIntent = new Map<string, bigint>()
    let total = 0n
    for (const r of res.rows) {
      const v = BigInt(r.spend_mu ?? '0')
      byIntent.set(r.intent, (byIntent.get(r.intent) ?? 0n) + v)
      total += v
    }
    const rows: IntentSpendRow[] = []
    for (const [intent, spend] of byIntent) {
      rows.push({
        intent,
        spendMu: spend,
        spendBp: total > 0n ? Number((spend * 10000n) / total) : 0,
      })
    }
    rows.sort((a, b) => (a.spendMu > b.spendMu ? -1 : a.spendMu < b.spendMu ? 1 : 0))
    return { rows, totalSpendMu: total }
  })
}
