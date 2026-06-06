/**
 * Bounded offset-pagination guard.
 *
 * @paradigm sql (pure arithmetic; no LLM)
 *
 * OFFSET pagination has an O(n) deep-page cliff: `OFFSET 5_000_000` makes the DB
 * scan and discard 5M rows. The Brain canon BANS OFFSET in prod read paths for
 * exactly this reason (conformance check C10). The Store browse tables
 * (orders/products/customers) were converted to keyset/seek pagination (see the
 * Keyset helpers below). The COGS editor is the ONE remaining bounded-OFFSET user
 * — a RATIFIED permanent exception (bounded SKU count, page-number UI retained).
 * This guard serves that editor; see `docs/req-keyset-pagination-admin-tables.md`.
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

// ─────────────────────────────────────────────────────────────────────────────
// Keyset (seek) pagination — the O(1) deep-page model that replaces OFFSET on the
// large admin browse tables (orders/customers/products). A cursor encodes the
// last row's (sort value, id tiebreaker); the seek predicate walks forward from
// it. Forward-only: the web layer keeps a cursor stack for "Previous".
// ─────────────────────────────────────────────────────────────────────────────

export type SortDir = 'ASC' | 'DESC'

/** The opaque cursor payload: the sort column value (NULL-aware) + the id tiebreaker. */
export interface Keyset {
  /** Sort column value as its full-precision SQL text, or null (NULLS LAST section). */
  v: string | null
  /** Row id (uuid) — the stable tiebreaker that makes the sort total. */
  id: string
}

/** Encode a keyset as a URL-safe opaque cursor string. */
export function encodeCursor(k: Keyset): string {
  return Buffer.from(JSON.stringify(k), 'utf8').toString('base64url')
}

/** Decode a cursor; returns null for absent/malformed input (treated as "first page"). */
export function decodeCursor(s: string | undefined | null): Keyset | null {
  if (!s) return null
  try {
    const obj = JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as unknown
    if (
      obj && typeof obj === 'object' &&
      'id' in obj && typeof (obj as Keyset).id === 'string' &&
      'v' in obj && ((obj as Keyset).v === null || typeof (obj as Keyset).v === 'string')
    ) {
      return obj as Keyset
    }
    return null
  } catch {
    return null
  }
}

/**
 * Build the seek WHERE predicate for `ORDER BY <col> <dir> NULLS LAST, id <dir>`.
 * Pushes its bind params onto `args` and returns the SQL fragment. The caller
 * appends it to the WHERE clause. `valueCast` casts the sort value bind (e.g.
 * `::timestamptz`); the id bind is always cast `::uuid`.
 */
export function keysetPredicate(
  col: string,
  dir: SortDir,
  cursor: Keyset,
  args: unknown[],
  opts: { valueCast?: string } = {},
): string {
  const cast = opts.valueCast ?? ''
  const cmp = dir === 'DESC' ? '<' : '>'
  if (cursor.v === null) {
    // Already inside the NULLS-LAST section: only further null rows, by id.
    args.push(cursor.id)
    return `(${col} IS NULL AND id ${cmp} $${args.length}::uuid)`
  }
  // Non-null cursor: null rows (sort last) + non-null rows past the cursor.
  args.push(cursor.v)
  const vIdx = args.length
  args.push(cursor.id)
  const idIdx = args.length
  return `(${col} IS NULL OR ${col} ${cmp} $${vIdx}${cast} OR (${col} = $${vIdx}${cast} AND id ${cmp} $${idIdx}::uuid))`
}

/** A keyset-paginated result page. `nextCursor` is null on the last page. */
export interface KeysetPage<T> {
  rows: T[]
  total: number
  pageSize: number
  nextCursor: string | null
}
