"""cohort_matrix_query.py — CohortMatrixQuery use-case (Phase 2, slice 5).

@paradigm: sql (deterministic integer aggregation + cumulative bucket-walk; zero LLM/ML)

The cohort retention/repeat heatmap for ONE workspace over a date range, ported Brain-native
from legacy lib/cohorts/compute.ts onto the slice-1..4 foundation.

LEGACY GROUND TRUTH (lib/cohorts/compute.ts — read at Stage 1, NOT the slice-table shorthand):
  - cohort = customer's first-order MONTH (YYYY-MM).
  - cm1 = price − cogs − shipping − packaging − website; cm2 = cm1 − adSpend;
    cm3 = cm2 − misc.  COHORTS USE CM3 (Rohan Finding 1), not CM2.
  - realized cm3 = 0 if RTO else cm3 − refundShare (refundShare = (price/grossSales)·totalReturns).
  - bucket = min(12, floor((daysDiff−1)/30)+1) for repeat orders with 1 ≤ daysDiff ≤ 360.
  - per-cohort: newCustomers, cac = monthSpend/newCustomers, rr90 (90-day repeat rate),
    firstOrder (avg cm3 of first orders), firstOrderR (avg realized cm3),
    payback (CUMULATIVE BUCKET-WALK WITH INTERPOLATION — Rohan Finding 3, NOT CAC/MonthlyCM2).
  - metric families: cm3 | revenue | repeat | repurchase. modes: post | cumulative | incr | pct | ltvcac.
  - summary: averageCac = totalAdSpend/totalNewCustomers, avg90DayRepeat, averagePayback
    (customer-weighted mean of per-cohort cm3 payback), newCustomers.

PAYBACK (the load-bearing correction — DDR _ROW_CAC_PAYBACK, anchor CF-S5-COHORT-PAYBACK-1):
  cum = firstOrderR − cac
  if cum >= 0 → payback = 0 (immediate)
  else for k in 1..12: prevCum = cum; cum += incr_cm3[k-1]
        if cum >= 0:
          (cm3 + post mode, incrVal > eps, prevCum < 0) → payback = (k-1) + (0 − prevCum)/incrVal
          else → payback = k
          break
        → if never reached: None
  Stored as centi-months (×100) so the interpolation is integer (no float). 100 = 1.0 month.

HONEST-INPUT PATTERN: the connector/fact use-case produces the per-cohort aggregates with the
RTO/refund/tax exclusion ALREADY applied (it owns the per-order facts). This use-case assembles
the registry-traceable summary + applies the mode transforms + the payback bucket-walk.
money in BIGINT paise; FX poison ABSENT (no static EXCHANGE_RATES — Rohan Finding 5).

TENANCY: query_metrics(workspace_id, ...) only; falsy workspace_id → UnscopedQueryError.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from brain_metrics.registry.definitions import (
    cac_mu as _CAC_DEF,
    repeat_rate_bp as _REPEAT_RATE_DEF,
    cohort_ltv_mu as _COHORT_LTV_DEF,
    ltv_cac_bp as _LTV_CAC_DEF,
)

from ...infrastructure.clickhouse.query_gateway import (
    DateRange,
    UnscopedQueryError,
    query_metrics,
)

# Metric families and display modes (mirror legacy cohorts/types.ts).
COHORT_METRICS = ("cm3", "revenue", "repeat", "repurchase")
COHORT_MODES = ("post", "cumulative", "incr", "pct", "ltvcac")

_BUCKETS = 12  # M1..M12 (30-day windows)


@dataclass(frozen=True)
class CohortFact:
    """One cohort (first-order month) of pre-aggregated facts (paise / counts).

    All per-order RTO/refund/tax exclusion is ALREADY applied upstream.
    incr_* arrays are length-12 (M1..M12): the per-bucket SUM across all repeat orders.
    """

    cohort_month: str  # YYYY-MM
    new_customers: int
    month_spend_mu: int  # cohort-month ad spend (for CAC)
    sum_first_order_cm3_mu: int  # SUM of first-order cm3 (original)
    sum_first_order_realized_cm3_mu: int  # SUM of first-order realized cm3
    repeat_customers_90d: int  # distinct customers with a repeat within 90 days
    incr_cm3_mu: tuple[int, ...] = field(default_factory=tuple)  # len 12, SUM realized cm3 per bucket
    incr_revenue_mu: tuple[int, ...] = field(default_factory=tuple)  # len 12, SUM revenue per bucket
    incr_repeat_customers: tuple[int, ...] = field(default_factory=tuple)  # len 12, distinct repeat custs
    incr_repurchase_orders: tuple[int, ...] = field(default_factory=tuple)  # len 12, repeat order count


@dataclass(frozen=True)
class CohortFacts:
    """Per-workspace cohort aggregates for the range."""

    cohorts: tuple[CohortFact, ...] = field(default_factory=tuple)
    total_ad_spend_mu: int = 0


@dataclass(frozen=True)
class CohortRow:
    cohort_month: str
    new_customers: int
    cac_mu: int | None
    rr90_bp: int | None
    payback_centimonths: int | None  # None = not reached; 0 = immediate; 100 = 1.0 month
    first_order_cm3_mu: int
    first_order_realized_cm3_mu: int
    cohort_ltv_mu: int  # cumulative realized CM3 at horizon 12 (feeds ltv_cac_bp)
    ltv_cac_bp: int | None
    m: tuple[int, ...]  # length 12, post-mode-transform display values (centi-units for pct/ltvcac scale)


@dataclass(frozen=True)
class CohortMatrixResult:
    workspace_id: str
    metric: str
    mode: str
    average_cac_mu: int | None
    avg_90day_repeat_bp: int | None
    average_payback_centimonths: int | None
    new_customers: int
    rows: tuple[CohortRow, ...]
    currency_code: str


def _avg_int(total: int, n: int) -> int:
    """Integer FLOOR average; 0 when n == 0 (matches legacy newCustomers>0 guard)."""
    return total // n if n > 0 else 0


def _cohort_payback_centimonths(
    first_order_realized_cm3_mu: int,
    cac_mu: int,
    incr_cm3_mu: tuple[int, ...],
    new_customers: int,
    metric: str,
    mode: str,
) -> int | None:
    """The legacy cumulative bucket-walk payback in CENTI-MONTHS (×100).

    DDR _ROW_CAC_PAYBACK / anchor CF-S5-COHORT-PAYBACK-1. Integer interpolation:
    centi-months = (k-1)*100 + FLOOR(100 * (−prevCum) / incrVal). Returns None if never reached.
    Payback is only defined for cm3 / revenue families (legacy guards the same).
    """
    if metric not in ("cm3", "revenue"):
        return None
    if new_customers <= 0:
        return None
    # Per-customer incrementals (legacy divides bucket sums by newCustomers before the walk).
    incr = [v // new_customers for v in incr_cm3_mu] if incr_cm3_mu else [0] * _BUCKETS
    fo_per_cust = first_order_realized_cm3_mu // new_customers
    cum = fo_per_cust - cac_mu
    if cum >= 0:
        return 0
    for k in range(1, _BUCKETS + 1):
        incr_val = incr[k - 1] if k - 1 < len(incr) else 0
        prev_cum = cum
        cum += incr_val
        if cum >= 0:
            # cm3 + post mode interpolates (legacy compute.ts:622); else whole month k.
            if metric == "cm3" and mode == "post" and incr_val > 0 and prev_cum < 0:
                # centi-months = (k-1)*100 + FLOOR(100 * (-prev_cum) / incr_val)
                frac_centi = (100 * (-prev_cum)) // incr_val
                return (k - 1) * 100 + frac_centi
            return k * 100
    return None


class CohortMatrixQuery:
    """Assemble the cohort retention/repeat matrix for one workspace + range."""

    def execute(
        self,
        workspace_id: str,
        date_range: DateRange,
        facts: CohortFacts,
        *,
        metric: str = "cm3",
        mode: str = "post",
        currency_code: str = "INR",
        _client: object | None = None,
    ) -> CohortMatrixResult:
        if not workspace_id or not workspace_id.strip():
            raise UnscopedQueryError(
                "CohortMatrixQuery.execute: workspace_id must not be empty or None. "
                "An un-scoped query is a tenancy violation. CF-C4-QUERY-SCOPE-ISOLATION-1."
            )
        if metric not in COHORT_METRICS:
            metric = "cm3"
        if mode not in COHORT_MODES:
            mode = "post"

        # Fail-closed scoped read (observability + tenancy choke).
        query_metrics(workspace_id, "cac_mu", date_range, _client=_client)

        rows: list[CohortRow] = []
        total_new = 0
        repeat90_total = 0
        payback_weighted_sum = 0
        payback_weight = 0

        for c in sorted(facts.cohorts, key=lambda x: x.cohort_month):
            n = c.new_customers
            total_new += n
            cac = _CAC_DEF.formula_py(c.month_spend_mu, n) if n > 0 else None
            rr90 = _REPEAT_RATE_DEF.formula_py(c.repeat_customers_90d, n) if n > 0 else None
            repeat90_total += c.repeat_customers_90d

            first_order = _avg_int(c.sum_first_order_cm3_mu, n)
            first_order_r = _avg_int(c.sum_first_order_realized_cm3_mu, n)

            # Per-customer incremental for the selected metric family.
            if metric == "cm3":
                incr_per = [v // n if n > 0 else 0 for v in (c.incr_cm3_mu or (0,) * _BUCKETS)]
            elif metric == "revenue":
                incr_per = [v // n if n > 0 else 0 for v in (c.incr_revenue_mu or (0,) * _BUCKETS)]
            elif metric == "repeat":
                incr_per = [
                    _REPEAT_RATE_DEF.formula_py(v, n) if n > 0 else 0
                    for v in (c.incr_repeat_customers or (0,) * _BUCKETS)
                ]
            else:  # repurchase
                incr_per = [v // n if n > 0 else 0 for v in (c.incr_repurchase_orders or (0,) * _BUCKETS)]

            # cohort_ltv = cumulative realized CM3 at horizon 12 (always CM3 — feeds ltv_cac_bp).
            cm3_per = [v // n if n > 0 else 0 for v in (c.incr_cm3_mu or (0,) * _BUCKETS)]
            ltv = first_order_r
            for step in cm3_per:
                ltv = _COHORT_LTV_DEF.formula_py(ltv, step)
            ltv_cac = _LTV_CAC_DEF.formula_py(ltv, cac) if (cac is not None and cac > 0) else None

            # Payback (cm3/revenue only; cm3+post interpolates).
            payback = _cohort_payback_centimonths(
                c.sum_first_order_realized_cm3_mu, cac or 0, c.incr_cm3_mu or (0,) * _BUCKETS, n, metric, mode
            )
            if payback is not None and n > 0:
                payback_weighted_sum += payback * n
                payback_weight += n

            m = self._apply_mode(metric, mode, first_order, first_order_r, cac or 0, incr_per)

            rows.append(
                CohortRow(
                    cohort_month=c.cohort_month,
                    new_customers=n,
                    cac_mu=cac,
                    rr90_bp=rr90,
                    payback_centimonths=payback,
                    first_order_cm3_mu=first_order,
                    first_order_realized_cm3_mu=first_order_r,
                    cohort_ltv_mu=ltv,
                    ltv_cac_bp=ltv_cac,
                    m=tuple(m),
                )
            )

        average_cac = _CAC_DEF.formula_py(facts.total_ad_spend_mu, total_new) if total_new > 0 else None
        avg90 = _REPEAT_RATE_DEF.formula_py(repeat90_total, total_new) if total_new > 0 else None
        avg_payback = payback_weighted_sum // payback_weight if payback_weight > 0 else None

        return CohortMatrixResult(
            workspace_id=workspace_id,
            metric=metric,
            mode=mode,
            average_cac_mu=average_cac,
            avg_90day_repeat_bp=avg90,
            average_payback_centimonths=avg_payback,
            new_customers=total_new,
            rows=tuple(rows),
            currency_code=currency_code,
        )

    @staticmethod
    def _apply_mode(
        metric: str,
        mode: str,
        first_order: int,
        first_order_r: int,
        cac: int,
        incr: list[int],
    ) -> list[int]:
        """Apply the display mode to the incremental M1..M12 (legacy compute.ts:667-742).

        cm3/revenue: post→incremental; cumulative seeds firstOrderR(cm3)/firstOrder(revenue);
        pct→cumulative/|fo|*100 (bp-style centi-pct); ltvcac→cumulative/cac (bp ×10000).
        repeat/repurchase: post→running sum; else incremental.
        Integer-only (no float): pct/ltvcac scaled to centi-units / bp.
        """
        n = len(incr)
        if metric in ("cm3", "revenue"):
            fo = first_order_r if metric == "cm3" else first_order
            if mode == "incr":
                return list(incr)
            if mode == "post":
                if metric == "cm3":
                    return list(incr)  # cm3+post keeps incremental (legacy line 743)
                s = 0
                out = []
                for v in incr:
                    s += v
                    out.append(s)
                return out
            if mode == "cumulative":
                s = fo
                out = []
                for v in incr:
                    s += v
                    out.append(s)
                return out
            if mode == "pct":
                denom = abs(fo) if abs(fo) > 0 else 1
                s = fo
                out = []
                for v in incr:
                    s += v
                    out.append((s * 10000) // denom)  # centi-pct (×100 of percent → bp)
                return out
            if mode == "ltvcac":
                denom = cac if cac > 0 else 1
                s = fo
                out = []
                for v in incr:
                    s += v
                    out.append((s * 10000) // denom)  # bp (×10000)
                return out
        else:  # repeat / repurchase
            if mode == "post":
                s = 0
                out = []
                for v in incr:
                    s += v
                    out.append(s)
                return out
            return list(incr)
        return list(incr)
