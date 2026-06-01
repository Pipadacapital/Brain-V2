/**
 * Bounded offset-pagination guard.
 *
 * @paradigm sql (pure arithmetic; no LLM)
 *
 * OFFSET pagination has an O(n) deep-page cliff: `OFFSET 5_000_000` makes the DB
 * scan and discard 5M rows. The Brain canon BANS OFFSET in prod read paths for
 * exactly this reason (conformance check C10). The few admin browse tables that
 * still use OFFSET (Store orders/products/customers, the COGS editor) are a
 * TIME-BOXED, allowlisted exception pending keyset conversion — tracked by
 * `docs/req-keyset-pagination-admin-tables.md`, gated before Scale-tier onboarding.
 *
 * This guard removes the UNBOUNDED cliff TODAY: any page whose offset would
 * exceed MAX_OFFSET is refused. The caller returns an empty, `capped: true`
 * ("refine your filters") page instead of running a deep-OFFSET scan, so the DB
 * never sees an offset larger than MAX_OFFSET.
 */

/** Hard ceiling on OFFSET. Pages past this must be reached by filtering, not paging. */
export const MAX_OFFSET = 10_000

export interface BoundedOffset {
  /** The offset to pass to SQL. Clamped to MAX_OFFSET as defense-in-depth even when capped. */
  offset: number
  /** true → the requested page is too deep; the caller MUST NOT run the OFFSET query. */
  capped: boolean
}

/**
 * Compute a bounded SQL offset for a 1-based page.
 *
 * @returns `{ offset, capped }`. When `capped` is true the requested page is
 *   beyond MAX_OFFSET — return an empty "refine your filters" result instead of
 *   querying. `offset` is clamped to MAX_OFFSET regardless (defense-in-depth).
 */
export function boundedOffset(page: number, pageSize: number): BoundedOffset {
  const raw = (page - 1) * pageSize
  if (raw > MAX_OFFSET) {
    return { offset: MAX_OFFSET, capped: true }
  }
  return { offset: raw, capped: false }
}
