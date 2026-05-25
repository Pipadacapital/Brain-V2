// @paradigm: sql
// CF-C4-SCOPE-SPLIT-1: TS registry types — byte-identity pair with Python registry.
// MetricDefinition shape locked per 06-architecture-plan §4 API contract.
// DO NOT add per-metric-family forks — Single-Primitive Rule; ONE home per language.

/**
 * Parity classification for a metric definition.
 *
 * "shadow_compare":      4a-style. Brain value can be compared byte-for-byte against
 *                        the legacy Postgres rollup. A delta is a BLOCKING_BUG unless
 *                        classified in the Definitional-Delta Register (DDR).
 *
 * "correctness_fixture": 4b-style. parity_gap:true Brain-native metric. No legacy
 *                        comparand exists. Routed to the correctness-fixture gate
 *                        (hand-calc worked example), NEVER to the shadow-compare gate.
 *                        A `shadow_compare` GREEN for this metric is structurally
 *                        impossible — it is never compared.
 */
export type ParityClass = 'shadow_compare' | 'correctness_fixture';

/**
 * Metric value kind — determines the integer representation contract.
 *
 * "money"  → Int64 minor units (µ). BIGINT in Postgres/ClickHouse.
 * "ratio"  → Int32 basis points (FLOOR(ratio × 10000)). Nullable on zero-denominator day.
 * "count"  → Int64 event count. Never negative in practice.
 */
export type MetricKind = 'money' | 'ratio' | 'count';

/**
 * Unit tag — suffix convention that must appear in the metric id.
 *
 * "mu"    → minor units (_mu suffix, e.g. cm2_mu, aov_mu)
 * "bp"    → basis points (_bp suffix, e.g. rto_rate_bp, acos_bp)
 * "x100"  → ×100 integer (for blended_roas_x100 — ratio expressed as integer × 100)
 * "count" → dimensionless count (e.g. total_orders)
 */
export type MetricUnit = 'mu' | 'bp' | 'x100' | 'count';

/**
 * MetricDefinition — the canonical metric contract.
 *
 * One record per metric, present in BOTH TS (this file) and Python
 * (pylibs/brain_metrics/brain_metrics/registry/). The two sides must produce
 * byte-identical integer outputs from the same inputs — enforced by the
 * extended check-metrics-parity.sh gate.
 *
 * Formula_ts and clickhouse_sql are the two expression surfaces.
 * They must produce the same integer result for the same inputs.
 *
 * CF-C4-RATIO-DIVOP-1: clickhouse_sql NEVER uses `/` on metric columns;
 * every division is `if(denom > 0, intDiv(num, denom), NULL)`.
 *
 * CF-C6-ROAS-DISPLAY-CONTRACT-1: scale field added (Child 6, additive).
 * The display layer reads displayValue = rawValue / scale instead of
 * branching on metric-ID strings. Parity-safe additive field.
 */
export interface MetricDefinition {
  /** Metric identifier. Must use the unit suffix: e.g. "cm2_mu", "rto_rate_bp". */
  readonly id: string;

  /** Value kind (determines the integer representation contract). */
  readonly kind: MetricKind;

  /** Unit tag (enforces the naming convention). */
  readonly unit: MetricUnit;

  /**
   * CF-C6-ROAS-DISPLAY-CONTRACT-1: display scale divisor.
   * The display layer computes: displayValue = rawValue / scale.
   *   10000 = basis-points metric (_bp): displayValue = rawValue / 10000 → percentage
   *   100   = ×100 integer metric (blended_roas_x100): displayValue = rawValue / 100 → "2.50×"
   *   1     = money (_mu) or count: displayValue = rawValue (use formatMoney for money)
   *
   * Byte-identity pair: same value in Python registry types.py.
   * The parity gate (check-metrics-parity.sh) asserts scale byte-identity.
   */
  readonly scale: 10000 | 100 | 1;

  /**
   * Pure TypeScript formula — integer arithmetic ONLY.
   * Zero float. For money metrics, all inputs are bigint (minor units).
   * For ratio metrics, returns number (INT32 basis points via ratioToBasisPoints).
   * The return type is bigint for money/count, number for ratio.
   *
   * Callers must guard zero denominators before invoking ratio formulas;
   * the formula itself throws on zero denominator (mirrors ratioToBasisPoints).
   */
  readonly formula_ts: (...args: bigint[]) => bigint | number;

  /**
   * ClickHouse SQL expression — the exact MV expression (not a full query).
   * Must use intDiv + null-guard (CF-C4-RATIO-DIVOP-1).
   * This is used for documentation and the parity harness round-trip check.
   */
  readonly clickhouse_sql: string;

  /**
   * True if this metric should be shown in the UI but NEVER used as a decision
   * input. ROAS and aCoS are display_only — Brain is CM2-first.
   *
   * display_only metrics cannot appear in Goal RAG thresholds.
   */
  readonly display_only: boolean;

  /**
   * Parity classification.
   * "shadow_compare":      exact-integer comparand exists in legacy Postgres.
   * "correctness_fixture": Brain-native; no legacy comparand; parity_gap:true.
   */
  readonly parity_class: ParityClass;
}
