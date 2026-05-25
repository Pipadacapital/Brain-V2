"""
pnl_signals.py — Deterministic Tier-A signal computation for the P&L page.

@paradigm: sql
CF-C5-PARADIGM-MIXED-1 (HIGH): anomaly/spike/drop/trend are STATISTICS (z-score,
    %-delta, period-over-period), NOT ML models and NOT LLM calls. They are
    tagged @paradigm("sql") as deterministic query-side operations.
    LLMs NEVER produce a number. The signals here are the source of truth that
    the LLM narration MUST faithfully cite (Gate 2 set-compare).

Ported deterministic from legacy:
    legacy project/backend/src/module/ai/pipeline/signals.ts
    Spike/drop threshold: ±25% day-over-day
    Anomaly threshold: |z| ≥ 2.0 over min 5 days
    Trend: period-over-period > 5% = up, < -5% = down, else flat

All money values are canonical integers (minor units / paise).
All ratio values are canonical integers (basis points).
No float money. No LLM.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

from brain_cost_router import paradigm


# ---------------------------------------------------------------------------
# Constants (ported from legacy signals.ts)
# ---------------------------------------------------------------------------

SPIKE_DROP_PCT_THRESHOLD = 25      # ±25% day-over-day
ANOMALY_Z_THRESHOLD = 2.0          # |z| ≥ 2 standard deviations
MIN_DAYS_FOR_ANOMALY = 5           # minimum data days for z-score validity
TREND_PCT_THRESHOLD = 5.0          # >5% up, <-5% down, else flat


# ---------------------------------------------------------------------------
# Signal data types (canonical integers only — no float money)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class DailyRow:
    """One day's metric values from the Child-4 MetricRow, projected for PnL.

    All money fields are integer minor units (paise).
    All ratio fields are integer basis points.
    """
    date: str                       # ISO "YYYY-MM-DD"
    net_sales_mu: int               # paise
    cogs_mu: int                    # paise
    cm1_mu: int                     # paise
    cm2_mu: int                     # paise
    cm3_mu: int                     # paise
    total_ad_spend_mu: int          # paise
    rto_rate_bp: int | None = None  # basis points


@dataclass(frozen=True)
class PnlSummary:
    """Period summary values for trend computation."""
    net_sales_mu: int
    cm1_mu: int
    cm2_mu: int
    cm3_mu: int
    total_ad_spend_mu: int
    total_orders: int
    aov_mu: int | None = None
    blended_roas_x100: int | None = None  # display_only


@dataclass(frozen=True)
class SignalAnomaly:
    type: str = "anomaly"
    metric: str = ""
    date: str = ""
    value_mu: int = 0             # canonical integer
    expected_avg_mu: int = 0      # canonical integer
    deviation_z_x100: int = 0     # z-score × 100 (int, no float)
    direction: str = ""           # "high" | "low"
    description: str = ""


@dataclass(frozen=True)
class SignalSpike:
    type: str = "spike"
    metric: str = ""
    date: str = ""
    value_mu: int = 0
    prior_value_mu: int = 0
    pct_change_x10: int = 0       # percent × 10 (e.g. 27.3% → 273)
    description: str = ""


@dataclass(frozen=True)
class SignalDrop:
    type: str = "drop"
    metric: str = ""
    date: str = ""
    value_mu: int = 0
    prior_value_mu: int = 0
    pct_change_x10: int = 0       # percent × 10 (negative value)
    description: str = ""


@dataclass(frozen=True)
class SignalTrend:
    type: str = "trend"
    metric: str = ""
    direction: str = ""           # "up" | "down" | "flat"
    pct_change_x10: int = 0       # percent × 10
    current_value_mu: int = 0
    prior_value_mu: int = 0
    description: str = ""


@dataclass
class PnlSignals:
    """Full signal set for the pnl page-insight agent."""
    anomalies: list[SignalAnomaly] = field(default_factory=list)
    spikes: list[SignalSpike] = field(default_factory=list)
    drops: list[SignalDrop] = field(default_factory=list)
    trends: list[SignalTrend] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Private helpers (integer-only arithmetic — no float money)
# ---------------------------------------------------------------------------

def _int_mean(values: list[int]) -> int:
    if not values:
        return 0
    return sum(values) // len(values)


def _int_std_x100(values: list[int]) -> int:
    """Return standard deviation × 100 as integer (avoids float in final result).

    Uses the sample std (N-1 denominator) matching legacy signals.ts:std().
    Returns 0 if fewer than 2 data points.
    """
    n = len(values)
    if n < 2:
        return 0
    mean = sum(values) / n         # float local only — not stored or returned
    variance = sum((v - mean) ** 2 for v in values) / (n - 1)
    std_float = variance ** 0.5
    return round(std_float * 100)


def _pct_x10(curr: int, prev: int) -> int:
    """Day-over-day percent change × 10 as integer.  Returns 0 if prev == 0."""
    if prev == 0:
        return 0
    return round(((curr - prev) / abs(prev)) * 1000)


# ---------------------------------------------------------------------------
# Anomaly detection
# ---------------------------------------------------------------------------

def _detect_anomalies(
    daily: Sequence[DailyRow],
    metric_label: str,
    get_value: object,   # Callable[[DailyRow], int]
) -> list[SignalAnomaly]:
    """Z-score anomaly detection over a metric's daily integer values.

    Ported from legacy signals.ts:detectAnomalies().
    @paradigm: sql — pure integer statistics, no LLM.
    """
    if len(daily) < MIN_DAYS_FOR_ANOMALY:
        return []

    get = get_value  # type: ignore[assignment]
    values: list[int] = [get(d) for d in daily]   # type: ignore[operator]
    valid = [v for v in values if isinstance(v, int)]
    if len(valid) < MIN_DAYS_FOR_ANOMALY:
        return []

    avg = _int_mean(valid)
    std_x100 = _int_std_x100(valid)
    if std_x100 == 0:
        return []

    results: list[SignalAnomaly] = []
    for d in daily:
        v = get(d)   # type: ignore[operator]
        if not isinstance(v, int):
            continue
        # z = (v - avg) / std; we compute z × 100 as integer
        z_x100 = ((v - avg) * 100 * 100) // (std_x100 if std_x100 else 1)
        abs_z_x100 = abs(z_x100)
        if abs_z_x100 >= round(ANOMALY_Z_THRESHOLD * 100):
            direction = "high" if z_x100 > 0 else "low"
            results.append(SignalAnomaly(
                type="anomaly",
                metric=metric_label,
                date=d.date,
                value_mu=v,
                expected_avg_mu=avg,
                deviation_z_x100=z_x100,
                direction=direction,
                description=(
                    f"{metric_label} {direction} on {d.date}: "
                    f"{v} (avg {avg}, z={z_x100/100:.2f})"
                ),
            ))
    return results


# ---------------------------------------------------------------------------
# Spike / drop detection
# ---------------------------------------------------------------------------

def _detect_spikes_drops(
    daily: Sequence[DailyRow],
    metric_label: str,
    get_value: object,   # Callable[[DailyRow], int]
) -> tuple[list[SignalSpike], list[SignalDrop]]:
    """Day-over-day ±25% spike/drop detection.

    Ported from legacy signals.ts:detectSpikesAndDrops().
    @paradigm: sql — pure integer arithmetic, no LLM.
    """
    get = get_value  # type: ignore[assignment]
    spikes: list[SignalSpike] = []
    drops: list[SignalDrop] = []
    for i in range(1, len(daily)):
        curr_val = get(daily[i])      # type: ignore[operator]
        prev_val = get(daily[i - 1])  # type: ignore[operator]
        if not isinstance(curr_val, int) or not isinstance(prev_val, int):
            continue
        if prev_val == 0:
            continue
        pct_x10 = _pct_x10(curr_val, prev_val)
        threshold_x10 = round(SPIKE_DROP_PCT_THRESHOLD * 10)
        if pct_x10 >= threshold_x10:
            spikes.append(SignalSpike(
                type="spike",
                metric=metric_label,
                date=daily[i].date,
                value_mu=curr_val,
                prior_value_mu=prev_val,
                pct_change_x10=pct_x10,
                description=(
                    f"{metric_label} spiked {pct_x10/10:.1f}% on {daily[i].date} "
                    f"({curr_val} vs {prev_val})"
                ),
            ))
        elif pct_x10 <= -threshold_x10:
            drops.append(SignalDrop(
                type="drop",
                metric=metric_label,
                date=daily[i].date,
                value_mu=curr_val,
                prior_value_mu=prev_val,
                pct_change_x10=pct_x10,
                description=(
                    f"{metric_label} dropped {abs(pct_x10/10):.1f}% on {daily[i].date} "
                    f"({curr_val} vs {prev_val})"
                ),
            ))
    return spikes, drops


# ---------------------------------------------------------------------------
# Trend detection (period-over-period)
# ---------------------------------------------------------------------------

def _detect_trends(
    current: PnlSummary,
    prior: PnlSummary,
) -> list[SignalTrend]:
    """Period-over-period trend detection for the key P&L metrics.

    Ported from legacy signals.ts:detectTrends().
    Trend threshold: >5% = up, <-5% = down, else flat.
    @paradigm: sql — pure integer arithmetic, no LLM.

    Note: blended_roas_x100 is display_only — included in signal output but
    the system prompt is instructed to narrate CM2/CM3 first (M-A1-2 India framing).
    """
    pairs: list[tuple[str, int, int]] = [
        ("Net sales", current.net_sales_mu, prior.net_sales_mu),
        ("CM1", current.cm1_mu, prior.cm1_mu),
        ("CM2", current.cm2_mu, prior.cm2_mu),
        ("CM3", current.cm3_mu, prior.cm3_mu),
        ("Ad spend", current.total_ad_spend_mu, prior.total_ad_spend_mu),
    ]
    if current.aov_mu is not None and prior.aov_mu is not None:
        pairs.append(("AOV", current.aov_mu, prior.aov_mu))

    trends: list[SignalTrend] = []
    for label, curr_val, prev_val in pairs:
        if prev_val == 0:
            continue
        pct_x10 = _pct_x10(curr_val, prev_val)
        threshold_x10 = round(TREND_PCT_THRESHOLD * 10)
        if pct_x10 > threshold_x10:
            direction = "up"
        elif pct_x10 < -threshold_x10:
            direction = "down"
        else:
            direction = "flat"
        trends.append(SignalTrend(
            type="trend",
            metric=label,
            direction=direction,
            pct_change_x10=pct_x10,
            current_value_mu=curr_val,
            prior_value_mu=prev_val,
            description=(
                f"{label} {direction} {pct_x10/10:+.1f}% vs prior period"
            ),
        ))

    # Blended ROAS (display_only — included as signal but CM2 narrated first)
    if (
        current.blended_roas_x100 is not None
        and prior.blended_roas_x100 is not None
        and prior.blended_roas_x100 != 0
    ):
        pct_x10 = _pct_x10(current.blended_roas_x100, prior.blended_roas_x100)
        threshold_x10 = round(TREND_PCT_THRESHOLD * 10)
        direction = "up" if pct_x10 > threshold_x10 else "down" if pct_x10 < -threshold_x10 else "flat"
        trends.append(SignalTrend(
            type="trend",
            metric="Blended ROAS",
            direction=direction,
            pct_change_x10=pct_x10,
            current_value_mu=current.blended_roas_x100,
            prior_value_mu=prior.blended_roas_x100,
            description=f"Blended ROAS {direction} {pct_x10/10:+.1f}% vs prior period",
        ))
    return trends


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

@paradigm("sql")
def compute_pnl_signals(
    daily: Sequence[DailyRow],
    current_summary: PnlSummary,
    prior_summary: PnlSummary,
    *,
    workspace_id: str = "unknown",
) -> PnlSignals:
    """Compute all deterministic P&L signals.

    @paradigm: sql — z-score / %-delta / period-over-period.  NO LLM.
    CF-C5-PARADIGM-MIXED-1: this is a Tier-A operation.  Calling the LLM
    gateway from this function body would raise ParadigmViolation (Gate 1).

    Args:
        daily: ordered daily rows from the Child-4 query_gateway (paise values).
        current_summary: period summary for trend computation.
        prior_summary: prior period summary for trend computation.
        workspace_id: for telemetry (not used in computation).

    Returns:
        PnlSignals with anomalies, spikes, drops, and trends.
        All value fields are canonical integers (minor units or basis points).
        LLMs NEVER produce these numbers — they are the ground-truth source
        that the faithfulness validator checks narration against.
    """
    anomalies: list[SignalAnomaly] = []
    spikes: list[SignalSpike] = []
    drops: list[SignalDrop] = []

    metric_extractors: list[tuple[str, object]] = [
        ("Net sales", lambda d: d.net_sales_mu),
        ("CM1", lambda d: d.cm1_mu),
        ("CM2", lambda d: d.cm2_mu),
        ("CM3", lambda d: d.cm3_mu),
        ("Ad spend", lambda d: d.total_ad_spend_mu),
    ]

    # Include RTO only if we have RTO data
    if any(d.rto_rate_bp is not None for d in daily):
        metric_extractors.append(("RTO %", lambda d: d.rto_rate_bp or 0))

    for label, getter in metric_extractors:
        anomalies.extend(_detect_anomalies(daily, label, getter))
        day_spikes, day_drops = _detect_spikes_drops(daily, label, getter)
        spikes.extend(day_spikes)
        drops.extend(day_drops)

    trends = _detect_trends(current_summary, prior_summary)

    return PnlSignals(
        anomalies=anomalies,
        spikes=spikes,
        drops=drops,
        trends=trends,
    )
