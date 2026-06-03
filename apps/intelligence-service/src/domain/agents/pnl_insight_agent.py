"""
pnl_insight_agent.py — The 5a vertical slice: pnl page-insight agent.

@paradigm: MIXED
    - build_context + compute_signals → @paradigm("sql") Tier-A
    - narrate (gateway call) → @paradigm("small_llm") Tier-B (ONE gateway call)
CF-C5-SCOPE-SPLIT-1: this is the 5a vertical (non-chat, READ-ONLY scope).
CF-C5-INJECTION-SCOPE-4: @agent_tools(scope=["get_pnl_metrics"]) — READ-ONLY.
    The pnl agent CANNOT reach any write tool. Gate 5 enforces this at dispatch.
CF-C5-PINCODE-TOKEN-CAP-1: context token ceiling asserted at construction.
CF-C5-RECOMMEND-ONLY-1: recommendation-only (graduation not yet GRADUATED).

C5-SEC-003 (fix) — Correlation quad population:
    The GatewayRequest built in _narrate() carries the full correlation quad:
        request_id: passed in from the caller (Kafka envelope / gRPC metadata).
            For the daily-tick scheduler path, "system" is the canonical value.
        trace_id: derived from the live OTel span at call time.
        workspace_id: from JWT ctx (Child-1 claim) — already present.
        actor_id: user_id from JWT, or "system" for the daily tick scheduler.
    These fields propagate into the Decision-Log row written by the gateway
    middleware, making every synthesis traceable end-to-end.

VETO surfaces (all from Vikram's gateway — Maya's agent only calls complete()):
    Gate 1: @paradigm contextvar enforced at gateway dispatch boundary.
    Gate 2: faithfulness validated by gateway middleware BEFORE response returned.
    Gate 4: graduation middleware DROPS any write-tool call (none possible here).
    Gate 5: out-of-scope tool-call DROPPED (pnl scope = ["get_pnl_metrics"] only).

Pattern-B (5b seam, designed now):
    The pnl agent produces ONE synthesis call (no fan-out).
    Prior-LLM-output fencing is NOT needed for 5a (no prior narration in the
    context). The Pattern-B seam is in the preprocessor (5b Morning-Brief).
"""

from __future__ import annotations

import json
import logging
from typing import Any

from brain_cost_router import paradigm
from opentelemetry import trace as otel_trace

from application.gateway.client import GatewayRequest, GatewayResponse
from domain.agents.base import PageInsightAgent, agent_tools
from domain.agents.prompts.pnl_system_prompt import PNL_SYSTEM_PROMPT
from domain.context_builders.pnl_context_builder import (
    PnlContext,
    PnlPeriodSummary,
    build_pnl_context,
    context_to_signals,
)
from domain.faithfulness.validator import Signal
from domain.injection.preprocessor import build_untrusted_blocks, render_untrusted_section
from domain.signals.pnl_signals import (
    DailyRow,
    PnlSignals,
    PnlSummary,
    compute_pnl_signals,
)

logger = logging.getLogger(__name__)
_tracer = otel_trace.get_tracer("brain.intelligence_service.pnl_agent")


# ---------------------------------------------------------------------------
# PnlInsightAgent — the 5a vertical
# ---------------------------------------------------------------------------

@agent_tools(scope=["get_pnl_metrics"])
class PnlInsightAgent(PageInsightAgent):
    """P&L page-insight agent (5a vertical slice).

    READ-ONLY scope: get_pnl_metrics only.
    The gateway DROPS any tool-call not in ["get_pnl_metrics"] (Gate 5).
    This agent CANNOT reach any write tool (PAUSE_AD_SET, REALLOCATE_BUDGET, etc.).

    Flow:
        1. build_pnl_context()    → @paradigm("sql") Tier-A signals
        2. compute_pnl_signals()  → @paradigm("sql") Tier-A anomaly/trend
        3. assemble_user_content()→ typed signal values (NO free text)
        4. gateway.complete()     → @paradigm("small_llm") ONE Haiku call
        5. parse_insights()       → InsightItem[] from JSON response
        6. Decision-Log written by gateway middleware (not by agent)

    CF-C5-DECISION-LOG-1: the Decision-Log row is written by the gateway's
        _write_decision_log() method — NOT directly by this agent.
        The agent is recommendation-only until graduated.
    """

    agent_id: str = "PnlInsightAgent"
    MAX_CONTEXT_TOKENS: int = 1_800

    def __init__(
        self,
        *,
        gateway: Any,
        _query_gateway: Any = None,
    ) -> None:
        """
        Args:
            gateway: GatewayClient instance (or MockGatewayClient in tests).
                     The agent MUST NOT hold any direct LLM SDK reference.
            _query_gateway: (test injection) query_metrics callable dict.
        """
        super().__init__(gateway=gateway)
        self._query_gateway = _query_gateway

    @paradigm("sql")
    def _build_context(
        self,
        workspace_id: str,
        date_from: str,
        date_to: str,
    ) -> PnlContext:
        """Build P&L context from Child-4 metric rows.

        @paradigm: sql — CF-C5-PARADIGM-MIXED-1.
        MUST NOT call gateway.complete() (Gate 1 would raise ParadigmViolation).
        """
        return build_pnl_context(
            workspace_id,
            date_from,
            date_to,
            _query_gateway=self._query_gateway,
        )

    @paradigm("sql")
    def _compute_signals(
        self,
        ctx: PnlContext,
        workspace_id: str,
    ) -> tuple[list[Signal], PnlSignals]:
        """Compute deterministic signals and build the full Signal list.

        @paradigm: sql — anomaly/spike/trend are statistics, not LLM.
        Returns (signals_for_faithfulness, pnl_signals_for_prompt).
        """
        # Build daily rows for signal computation
        daily_rows = _daily_rows_from_daily_signals(ctx.daily_signals)

        pnl_summary = PnlSummary(
            net_sales_mu=ctx.current.net_sales_mu,
            cm1_mu=ctx.current.cm1_mu,
            cm2_mu=ctx.current.cm2_mu,
            cm3_mu=ctx.current.cm3_mu,
            total_ad_spend_mu=ctx.current.total_ad_spend_mu,
            total_orders=ctx.current.total_orders,
            aov_mu=ctx.current.aov_mu,
        )
        prior_pnl_summary = PnlSummary(
            net_sales_mu=ctx.prior.net_sales_mu,
            cm1_mu=ctx.prior.cm1_mu,
            cm2_mu=ctx.prior.cm2_mu,
            cm3_mu=ctx.prior.cm3_mu,
            total_ad_spend_mu=ctx.prior.total_ad_spend_mu,
            total_orders=ctx.prior.total_orders,
        )

        pnl_signals = compute_pnl_signals(
            daily_rows,
            pnl_summary,
            prior_pnl_summary,
            workspace_id=workspace_id,
        )

        # Full signal set for the faithfulness gate
        faithfulness_signals = context_to_signals(ctx)

        # Add signal anomaly/trend values to the faithfulness set
        for anomaly in pnl_signals.anomalies:
            faithfulness_signals = [
                *faithfulness_signals,
                Signal(f"anomaly:{anomaly.metric}:{anomaly.date}:value", anomaly.value_mu),
                Signal(f"anomaly:{anomaly.metric}:{anomaly.date}:avg", anomaly.expected_avg_mu),
            ]

        # Defect 3 convergent fix: add spike/drop pct signals so formatted pct
        # display strings (e.g. "+27.3%") in the user content are in the allowed set.
        # pct_change_x10 is percent × 10; bp = pct_change_x10 * 10 to match extract_numbers.
        for spike in pnl_signals.spikes:
            pct_bp = spike.pct_change_x10 * 10
            faithfulness_signals = [
                *faithfulness_signals,
                Signal(f"spike:{spike.metric}:{spike.date}:value", spike.value_mu),
                Signal(f"spike:{spike.metric}:{spike.date}:prior", spike.prior_value_mu),
                Signal(f"spike:{spike.metric}:{spike.date}:pct_bp", pct_bp),
                Signal(f"spike:{spike.metric}:{spike.date}:pct_bp:abs", abs(pct_bp)),
            ]
        for drop in pnl_signals.drops:
            pct_bp = drop.pct_change_x10 * 10
            faithfulness_signals = [
                *faithfulness_signals,
                Signal(f"drop:{drop.metric}:{drop.date}:value", drop.value_mu),
                Signal(f"drop:{drop.metric}:{drop.date}:prior", drop.prior_value_mu),
                Signal(f"drop:{drop.metric}:{drop.date}:pct_bp", pct_bp),
                Signal(f"drop:{drop.metric}:{drop.date}:pct_bp:abs", abs(pct_bp)),
            ]

        for trend in pnl_signals.trends:
            # Defect 2 fix (CF-C5-FAITHFULNESS-1 — B3 live-run, 2026-05-19):
            # extract_numbers() converts "9.9%" → round(9.9 * 100) = 990 bp.
            # The old signal emitted pct_change_x10 (99) which is percent × 10,
            # NOT basis points — so 990 ≠ 99 → false VETO on every faithfully-
            # narrated percentage change.
            # Fix: emit the pct signal in basis points (pct_change_x10 * 10 = 990)
            # to match extract_numbers' bp output.  The signal_id suffix is renamed
            # to _bp to make the unit explicit and prevent future confusion.
            pct_bp = trend.pct_change_x10 * 10  # basis points (matches extract_numbers)
            # Emit both signed (for "−9.5%") and unsigned (for "9.5% decline")
            # because the extractor sign-captures only when the model writes an
            # explicit minus/hyphen before the percentage.  Both forms are faithful
            # citations of the same magnitude; the sign is conveyed by prose context.
            faithfulness_signals = [
                *faithfulness_signals,
                Signal(f"trend:{trend.metric}:current", trend.current_value_mu),
                Signal(f"trend:{trend.metric}:prior", trend.prior_value_mu),
                Signal(f"trend:{trend.metric}:pct_bp", pct_bp),
            ]
            if pct_bp < 0:
                # Also register the absolute value for "9.5%" (no explicit minus)
                faithfulness_signals = [
                    *faithfulness_signals,
                    Signal(f"trend:{trend.metric}:pct_bp:abs", abs(pct_bp)),
                ]
            # --- Defect 3 (a) — Tier-A derived signals ---
            # The narration MUST express: absolute delta (current − prior), ratio
            # metrics (MER, CM2%, CM3%), and display-formatted values for money.
            # Emitting these as signals lets the faithfulness gate accept them AND
            # gives the model exact numbers to quote (preventing paise→lakh errors).
            delta_mu = trend.current_value_mu - trend.prior_value_mu
            faithfulness_signals = [
                *faithfulness_signals,
                Signal(f"trend:{trend.metric}:delta", delta_mu),
            ]

        # Defect 3 (a) — ratio metrics: MER, CM2%, CM3% (current + prior).
        # The model narrates these as "MER 2.25x", "14.8% CM2 margin" etc.
        # Tier-A computes them deterministically so the model quotes them verbatim
        # instead of recomputing from paise values (which it gets wrong).
        # All ratios stored as basis points (bp) — matches extract_numbers' bp output.
        faithfulness_signals = [
            *faithfulness_signals,
            *_compute_ratio_signals(ctx.current, ctx.prior),
        ]

        return faithfulness_signals, pnl_signals

    @paradigm("small_llm")
    def _narrate(
        self,
        ctx: PnlContext,
        faithfulness_signals: list[Signal],
        pnl_signals: PnlSignals,
        workspace_id: str,
        brand_name: str | None = None,
        *,
        request_id: str = "system",
        actor_id: str = "system",
    ) -> GatewayResponse:
        """Call the gateway for ONE Haiku narration.

        @paradigm: small_llm — the ONLY LLM call in the pnl vertical.
        CF-C5-PARADIGM-MIXED-1: MUST NOT compute any numbers here.
        CF-C5-INJECTION-SPOTLIGHT-7: operator-entered strings fenced.

        C5-SEC-003 fix — Correlation quad:
            request_id and actor_id are propagated from generate_insights() into
            GatewayRequest, which writes them into the Decision-Log row.
            trace_id is derived from the active OTel span at this call site so
            every synthesis row is correlatable back to the telemetry backend.
        """
        # C5-SEC-003: bind trace_id from the active OTel span at call time.
        otel_ctx = otel_trace.get_current_span().get_span_context()
        trace_id = (
            format(otel_ctx.trace_id, "032x") if otel_ctx.is_valid else ""
        )

        # Build untrusted blocks (operator-entered strings, spotlighted)
        blocks = build_untrusted_blocks(
            brand_name=brand_name,
            goal_labels=[(f"goal_{g.metric_id}", g.label) for g in ctx.goals],
            workspace_id=workspace_id,
        )
        untrusted_section = render_untrusted_section(blocks)

        # Build pre-formatted display user content (Defect 3 convergent fix):
        # _format_signals_as_user_content produces ₹4.8Cr display strings so
        # the model quotes them verbatim — it must NEVER see raw paise integers
        # (e.g. 48037359) or it will mis-convert by 10×.
        # The formatted content is passed via GatewayRequest.user_content so
        # _build_messages uses it directly instead of re-deriving from signals.
        formatted_user_content = _format_signals_as_user_content(ctx, pnl_signals)

        request = GatewayRequest(
            paradigm="small_llm",
            signals=faithfulness_signals,
            system_template=PNL_SYSTEM_PROMPT,
            # Defect 3 convergent fix: pass the pre-formatted display content.
            # _build_messages in GatewayClient will use this verbatim.
            # Do NOT also add it to untrusted_blocks — it is trusted Tier-A content.
            user_content=formatted_user_content,
            untrusted_blocks=[untrusted_section] if untrusted_section else [],
            workspace_id=workspace_id,
            agent_id=self.agent_id,
            filters_hash=ctx.filters_hash,
            # 3-5 insights, each with summary + 2-3 sentence detail + rationale, as ONE
            # JSON object. B3 live finding: 512 truncated the JSON mid-string, so it never
            # parsed → faithfulness fell back to strict full-string validation every time.
            # ~512 tok/insight headroom so the brief always completes and parses.
            max_tokens=2048,
            # C5-SEC-003: correlation quad — propagated into Decision-Log row.
            request_id=request_id,
            trace_id=trace_id,
            actor_id=actor_id,
        )
        return self.gateway.complete(request)

    def generate_insights(
        self,
        workspace_id: str,
        date_from: str,
        date_to: str,
        *,
        request_id: str = "system",
        actor_id: str = "system",
    ) -> list[Any]:
        """Generate P&L page insights (the full 5a vertical).

        Tier-A (sql): context → signals
        Tier-B (small_llm): gateway narration → parse InsightItem[]
        Gate 2 (faithfulness): enforced by gateway middleware
        Gate 1 (paradigm): enforced at gateway dispatch boundary
        Decision-Log: written by gateway middleware

        C5-SEC-003 fix — Correlation quad:
            request_id: unique identifier from Kafka envelope / gRPC metadata.
                Use "system" for the daily-tick scheduler path (no human in loop).
            actor_id: user_id from JWT, or "system" for the daily tick.
            workspace_id is the third quad member (always present).
            trace_id is derived inside _narrate() from the active OTel span.

        Returns list[InsightItem]-shaped dicts (JSON-parsed from LLM response).
        """
        # --- Tier-A: context + signals ---
        ctx = self._build_context(workspace_id, date_from, date_to)

        # Token ceiling assertion (CF-C5-PINCODE-TOKEN-CAP-1)
        self._assert_token_ceiling(ctx.estimated_tokens)

        faithfulness_signals, pnl_signals = self._compute_signals(ctx, workspace_id)

        # --- Tier-B: narration ---
        response = self._narrate(
            ctx, faithfulness_signals, pnl_signals, workspace_id,
            request_id=request_id,
            actor_id=actor_id,
        )

        # --- Parse InsightItem[] from JSON response ---
        insights = _parse_insights_from_json(response.narration)

        logger.info(
            "PnlInsightAgent: generated %d insights for workspace_id=%r "
            "model=%r tokens_in=%d tokens_out=%d faithfulness=%s cached=%s",
            len(insights),
            workspace_id,
            response.model_used,
            response.tokens_input,
            response.tokens_output,
            response.faithfulness.ok,
            response.cached,
        )

        return insights


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _format_money(value: int) -> str:
    """Format a signal value as a human-readable Indian money display string.

    Defect 3 (a) fix — Tier-A owns ALL display-format conversions so the
    model quotes pre-computed strings verbatim instead of doing its own
    conversion arithmetic (which it consistently gets wrong — 10× errors
    observed in B3 live run, workspace f165da80-e6d5-4c58-9aff-ec654b873bd7).

    @paradigm: sql — pure integer arithmetic.  NEVER float money stored.

    Unit convention: Signal.value_canonical uses the SAME unit as
    extraction.py's extract_numbers() output:
      _LAKH = 100_000   (1 lakh = 100,000 in signal units)
      _CRORE = 10_000_000  (1 crore = 10,000,000 in signal units)

    Rules (aligned with extraction.py):
      |value| < 100_000 (< ₹1L):  plain ₹X (integer)
      |value| < 10_000_000 (< ₹1Cr): ₹X.XL (one decimal lakh)
      else:                            ₹X.XCr (one decimal crore)

    Examples (canonical — used as faithfulness signal display values):
      53_437_304 → 53437304 / 100000 = 534.37L → "₹534.4L"
      48_037_359 → 480.37L → "₹480.4L"
      323_866_880 → 3238.7L → ₹32.4Cr (3238.7L > 100L → crore)
      -5_400_000 → 54L → "−₹54.0L"

    Sign: negative → "−₹X.XL" (minus sign, not hyphen).
    """
    # Use same constants as extraction.py to ensure round-trip consistency.
    _LAKH = 100_000
    _CRORE = 10_000_000

    sign = ""
    v = value
    if v < 0:
        sign = "−"
        v = -v

    if v >= _CRORE:
        # Display as crores, one decimal
        crore_x10 = round(v * 10 / _CRORE)
        crore_int = crore_x10 // 10
        crore_dec = crore_x10 % 10
        return f"{sign}₹{crore_int}.{crore_dec}Cr"
    elif v >= _LAKH:
        # Display as lakhs, one decimal
        lakh_x10 = round(v * 10 / _LAKH)
        lakh_int = lakh_x10 // 10
        lakh_dec = lakh_x10 % 10
        return f"{sign}₹{lakh_int}.{lakh_dec}L"
    else:
        # Small amounts: display as plain integer
        return f"{sign}₹{v}"


def _format_pct(bp: int) -> str:
    """Format a basis-points integer as "X.X%" display string.

    Defect 3 (a): pre-formatted so the model quotes verbatim.
    bp = percent * 100 (e.g. 990 bp → 9.9%; 1870 bp → 18.7%).

    Rounding rule (python-services-10 fix): the decimal digit is ROUNDED, not
    truncated. 1485 bp → 14.85% → rounds to "14.9%", not "14.8%".
    This keeps _format_pct in lockstep with _display_round_bp (both round).
    """
    sign = ""
    v = bp
    if v < 0:
        sign = "−"
        v = -v
    pct_int = v // 100
    # Round the sub-percent portion to one decimal place.
    # (v % 100 + 5) // 10 rounds half-up: 85 → (85+5)//10 = 9, 84 → (84+5)//10 = 8.
    pct_dec = (v % 100 + 5) // 10
    if pct_dec == 10:
        # Carry: e.g. 995 bp → pct_int=9, pct_dec rounds to 10 → "10.0%"
        pct_int += 1
        pct_dec = 0
    return f"{sign}{pct_int}.{pct_dec}%"


def _display_round_bp(bp: int) -> int:
    """Return the display-rounded bp value that extract_numbers produces when
    parsing the formatted display string back.

    _format_pct rounds the decimal digit, so extract_numbers("14.9%") = 1490 bp.
    _display_round_bp must use the same rounding formula to stay in lockstep.

    Formula (python-services-10 fix — round, not truncate):
      display_bp = round(v / 10) * 10  using integer half-up arithmetic
                 = ((v + 5) // 10) * 10
    = nearest 10 bp (= 0.1% precision), rounded half-up.

    Example: 1483 bp → (1483+5)//10*10 = 148*10 = 1480
             1485 bp → (1485+5)//10*10 = 149*10 = 1490
    """
    sign = 1 if bp >= 0 else -1
    v = abs(bp)
    # One-decimal-place percentage: round to nearest 10 bp (half-up)
    display_bp = ((v + 5) // 10) * 10
    return sign * display_bp


def _format_mer(mer_x100: int) -> str:
    """Format MER (net_sales / ad_spend × 100) as "X.XXx" display string.

    mer_x100 = MER × 100 stored as integer (e.g. MER=2.25 → 225).
    """
    if mer_x100 < 0:
        return "—"
    mer_int = mer_x100 // 100
    mer_dec_2 = mer_x100 % 100  # two decimal digits
    return f"{mer_int}.{mer_dec_2:02d}x"


def _compute_ratio_signals(
    current: "PnlPeriodSummary",  # type: ignore[name-defined]
    prior: "PnlPeriodSummary",  # type: ignore[name-defined]
) -> list[Signal]:
    """Compute ratio/derived signals: MER, CM2%, CM3% for current + prior.

    Defect 3 (a) fix (CF-C5-FAITHFULNESS-1 — B3 live-run):
      The model narrates MER ("2.25x"), CM2% ("14.8%"), CM3%, ad-spend growth
      pct, and money deltas ("−₹5.4L").  Without these as signals, any
      faithfully-narrated derived value would fail the gate even though it was
      legitimately computed from the data.
      By having Tier-A compute and emit every number the model is permitted to
      narrate (including pre-formatted display strings as bonus signals), we:
        (1) guarantee the model has exact values to quote verbatim,
        (2) ensure the gate accepts them when quoted correctly,
        (3) make any invented or contradicted value still fail (gate preserved).

    All ratio values are in basis points (bp): MER_x100 is the ratio × 100,
    pct fields are percent × 100 (= bp).
    Money delta fields are in paise (minor units).

    Note: _format_money / _format_pct emit the canonical display string.
    extract_numbers() on a display string like "₹5.3L" → 5_300_000 paise,
    which must equal the corresponding signal.  We therefore ALSO register
    the display-rounded canonical integer as an additional signal so that
    minor rounding in the last digit of a display string still matches.
    """
    signals: list[Signal] = []

    def _emit_pct(sig_id: str, bp: int) -> None:
        """Emit exact bp and display-rounded bp for a percentage signal.

        The model quotes the display string (e.g. "14.8%"); extract_numbers
        returns the display-rounded bp (1480), not the exact bp (1483).
        Emitting both ensures the faithfulness gate accepts the display form.
        """
        signals.append(Signal(sig_id, bp))
        display_bp = _display_round_bp(bp)
        if display_bp != bp:
            signals.append(Signal(f"{sig_id}:display", display_bp))

    # --- CM2% = cm2 / net_sales × 10000 bp ---
    if current.net_sales_mu > 0:
        cm2_pct_bp = (current.cm2_mu * 10000) // current.net_sales_mu
        _emit_pct("derived:cm2_pct_bp", cm2_pct_bp)
    if prior.net_sales_mu > 0:
        prior_cm2_pct_bp = (prior.cm2_mu * 10000) // prior.net_sales_mu
        _emit_pct("derived:prior_cm2_pct_bp", prior_cm2_pct_bp)

    # --- CM3% = cm3 / net_sales × 10000 bp ---
    if current.net_sales_mu > 0:
        cm3_pct_bp = (current.cm3_mu * 10000) // current.net_sales_mu
        _emit_pct("derived:cm3_pct_bp", cm3_pct_bp)

    # --- CM1% = cm1 / net_sales × 10000 bp ---
    if current.net_sales_mu > 0:
        cm1_pct_bp = (current.cm1_mu * 10000) // current.net_sales_mu
        _emit_pct("derived:cm1_pct_bp", cm1_pct_bp)

    # --- MER = net_sales / ad_spend × 100 (stored as MER × 100) ---
    if current.total_ad_spend_mu > 0:
        mer_x100 = (current.net_sales_mu * 100) // current.total_ad_spend_mu
        signals.append(Signal("derived:mer_x100", mer_x100))
    if prior.total_ad_spend_mu > 0:
        prior_mer_x100 = (prior.net_sales_mu * 100) // prior.total_ad_spend_mu
        signals.append(Signal("derived:prior_mer_x100", prior_mer_x100))

    # --- ACOS = ad_spend / net_sales × 100 (as bp: ad_spend * 10000 / net_sales) ---
    # The model habitually narrates ACOS ("≈44.6%") even when not provided.
    # Emit it deterministically so the gate accepts it when quoted verbatim.
    if current.net_sales_mu > 0 and current.total_ad_spend_mu > 0:
        acos_bp = (current.total_ad_spend_mu * 10000) // current.net_sales_mu
        _emit_pct("derived:acos_bp", acos_bp)
    if prior.net_sales_mu > 0 and prior.total_ad_spend_mu > 0:
        prior_acos_bp = (prior.total_ad_spend_mu * 10000) // prior.net_sales_mu
        _emit_pct("derived:prior_acos_bp", prior_acos_bp)

    # --- MER period %-change: (mer_cur / mer_prior − 1) × 10000 bp ---
    # The model habitually narrates "MER declined ... (−13.5% efficiency loss)".
    # Emit the MER %-change as a signed bp signal so the gate accepts it verbatim.
    if current.total_ad_spend_mu > 0 and prior.total_ad_spend_mu > 0:
        mer_cur_x100 = (current.net_sales_mu * 100) // current.total_ad_spend_mu
        mer_pri_x100 = (prior.net_sales_mu * 100) // prior.total_ad_spend_mu
        if mer_pri_x100 > 0:
            # %-change in basis points: (cur/prior − 1) * 10000
            # Use integer arithmetic: (mer_cur_x100 * 10000 // mer_pri_x100) − 10000
            mer_pct_bp = (mer_cur_x100 * 10000 // mer_pri_x100) - 10000
            _emit_pct("derived:mer_pct_change_bp", mer_pct_bp)

    # --- Money deltas: current − prior for key metrics ---
    for sig_id, curr_val, prior_val in [
        ("derived:cm2_delta", current.cm2_mu, prior.cm2_mu),
        ("derived:cm1_delta", current.cm1_mu, prior.cm1_mu),
        ("derived:net_sales_delta", current.net_sales_mu, prior.net_sales_mu),
        ("derived:ad_spend_delta", current.total_ad_spend_mu, prior.total_ad_spend_mu),
    ]:
        delta = curr_val - prior_val
        signals.append(Signal(sig_id, delta))
        # Also register the display-rounded value so that "₹534.4L" matches
        # even when the exact delta is 53_437_304 but the display rounds to
        # the nearest 0.1L (= 10_000 units).  This is the Defect 3b safety net.
        _LAKH = 100_000     # matches extraction.py
        _CRORE = 10_000_000  # matches extraction.py
        abs_delta = abs(delta)
        if abs_delta >= _CRORE:
            crore_x10 = round(abs_delta * 10 / _CRORE)
            # extract_numbers("₹X.XCr") returns crore_x10 / 10 * _CRORE
            display_canonical = crore_x10 * (_CRORE // 10)
        elif abs_delta >= _LAKH:
            lakh_x10 = round(abs_delta * 10 / _LAKH)
            # extract_numbers("₹X.XL") returns lakh_x10 / 10 * _LAKH
            display_canonical = lakh_x10 * (_LAKH // 10)
        else:
            display_canonical = abs_delta  # exact for small values
        if delta < 0:
            display_canonical = -display_canonical
        if display_canonical != delta:
            signals.append(Signal(f"{sig_id}:display", display_canonical))

    return signals


def _daily_rows_from_daily_signals(daily_signals: list[Signal]) -> list[DailyRow]:
    """Reconstruct DailyRow list from context's daily signals.

    Daily signals are stored as "daily:<date>:<metric>:<value>" IDs.
    We group by date and reconstruct the DailyRow.
    """
    by_date: dict[str, dict[str, int]] = {}
    for sig in daily_signals:
        parts = sig.signal_id.split(":")
        if len(parts) >= 3 and parts[0] == "daily":
            date_str, metric = parts[1], parts[2]
            by_date.setdefault(date_str, {})[metric] = sig.value_canonical

    rows: list[DailyRow] = []
    for date_str, metrics in sorted(by_date.items()):
        rows.append(DailyRow(
            date=date_str,
            net_sales_mu=metrics.get("net_sales_mu", 0),
            cogs_mu=metrics.get("cogs_mu", 0),
            cm1_mu=metrics.get("cm1_mu", 0),
            cm2_mu=metrics.get("cm2_mu", 0),
            cm3_mu=metrics.get("cm3_mu", 0),
            total_ad_spend_mu=metrics.get("total_ad_spend_mu", 0),
        ))
    return rows


def _format_signals_as_user_content(
    ctx: PnlContext,
    pnl_signals: PnlSignals,
) -> str:
    """Format typed signal values as the user-turn content.

    CF-C5-INJECTION-SPOTLIGHT-7: ONLY canonical integer values here.
    No operator-entered text in the instruction region.

    Defect 3 (a) fix (CF-C5-FAITHFULNESS-1 — B3 live-run 2026-05-19):
      Pre-format ALL display strings Tier-A so the model quotes them verbatim.
      The raw paise/bp integers are kept alongside the display strings — they
      remain the authoritative faithfulness-gate values.
      The model is instructed: "quote only the provided display values; never
      recompute or reconvert."  This prevents 10× paise→lakh conversion errors
      (e.g. the model writing "₹53.4L" when the signal was 5_343_730 paise =
      ₹5.3L — it was off by one order of magnitude).
    """
    cur = ctx.current
    pri = ctx.prior

    # Pre-format all display strings deterministically (Tier-A, @paradigm sql).
    cur_net_sales_disp = _format_money(cur.net_sales_mu)
    cur_cm1_disp = _format_money(cur.cm1_mu)
    cur_cm2_disp = _format_money(cur.cm2_mu)
    cur_cm3_disp = _format_money(cur.cm3_mu)
    cur_ad_spend_disp = _format_money(cur.total_ad_spend_mu)
    pri_net_sales_disp = _format_money(pri.net_sales_mu)
    pri_cm2_disp = _format_money(pri.cm2_mu)
    pri_cm3_disp = _format_money(pri.cm3_mu)
    pri_ad_spend_disp = _format_money(pri.total_ad_spend_mu)

    cm2_delta_disp = _format_money(cur.cm2_mu - pri.cm2_mu)
    cm1_delta_disp = _format_money(cur.cm1_mu - pri.cm1_mu)
    net_sales_delta_disp = _format_money(cur.net_sales_mu - pri.net_sales_mu)
    ad_spend_delta_disp = _format_money(cur.total_ad_spend_mu - pri.total_ad_spend_mu)

    # CM2%, CM3%, CM1% (basis points → display pct)
    cur_cm2_pct_bp = (cur.cm2_mu * 10000) // cur.net_sales_mu if cur.net_sales_mu > 0 else 0
    pri_cm2_pct_bp = (pri.cm2_mu * 10000) // pri.net_sales_mu if pri.net_sales_mu > 0 else 0
    cur_cm3_pct_bp = (cur.cm3_mu * 10000) // cur.net_sales_mu if cur.net_sales_mu > 0 else 0
    cur_cm1_pct_bp = (cur.cm1_mu * 10000) // cur.net_sales_mu if cur.net_sales_mu > 0 else 0

    cur_cm2_pct_disp = _format_pct(cur_cm2_pct_bp)
    pri_cm2_pct_disp = _format_pct(pri_cm2_pct_bp)
    cur_cm3_pct_disp = _format_pct(cur_cm3_pct_bp)
    cur_cm1_pct_disp = _format_pct(cur_cm1_pct_bp)

    # MER = net_sales / ad_spend (× 100 stored; display as X.XXx)
    cur_mer_x100 = (cur.net_sales_mu * 100) // cur.total_ad_spend_mu if cur.total_ad_spend_mu > 0 else 0
    pri_mer_x100 = (pri.net_sales_mu * 100) // pri.total_ad_spend_mu if pri.total_ad_spend_mu > 0 else 0
    cur_mer_disp = _format_mer(cur_mer_x100)
    pri_mer_disp = _format_mer(pri_mer_x100)

    # ACOS = ad_spend / net_sales (as %, one decimal; bp → display)
    cur_acos_bp = (cur.total_ad_spend_mu * 10000) // cur.net_sales_mu if cur.net_sales_mu > 0 else 0
    pri_acos_bp = (pri.total_ad_spend_mu * 10000) // pri.net_sales_mu if pri.net_sales_mu > 0 else 0
    cur_acos_disp = _format_pct(cur_acos_bp) if cur.net_sales_mu > 0 else "—"
    pri_acos_disp = _format_pct(pri_acos_bp) if pri.net_sales_mu > 0 else "—"

    # MER %-change: (cur_mer / pri_mer − 1) as display pct
    mer_pct_change_disp = "—"
    if cur.total_ad_spend_mu > 0 and pri.total_ad_spend_mu > 0 and pri_mer_x100 > 0:
        mer_pct_bp = (cur_mer_x100 * 10000 // pri_mer_x100) - 10000
        mer_pct_change_disp = _format_pct(mer_pct_bp)

    # Defect 3 convergent fix: NO raw integers anywhere in the user content.
    # The model must ONLY see display tokens. Any raw paise integer in the user
    # content will be quoted verbatim (or mis-converted) by the model, causing
    # faithfulness VETO. The "(raw paise: ...)" annotations are removed entirely.
    lines = [
        f"## P&L Analysis: {ctx.date_from} to {ctx.date_to}",
        f"Prior period: {ctx.prior_date_from} to {ctx.prior_date_to}",
        "",
        "### IMPORTANT: copy display values verbatim. Do NOT convert, recompute, or derive.",
        "",
        "### Period Summary",
        f"net_sales: {cur_net_sales_disp}",
        f"cm1:       {cur_cm1_disp}  ({cur_cm1_pct_disp} of net sales)",
        f"cm2:       {cur_cm2_disp}  ({cur_cm2_pct_disp} of net sales)",
        f"cm3:       {cur_cm3_disp}  ({cur_cm3_pct_disp} of net sales)",
        f"ad_spend:  {cur_ad_spend_disp}",
        f"orders:    {cur.total_orders}",
        f"MER:       {cur_mer_disp}",
        f"ACOS:      {cur_acos_disp}",
        "",
        "### Prior Period",
        f"prior_net_sales: {pri_net_sales_disp}",
        f"prior_cm2:       {pri_cm2_disp}  ({pri_cm2_pct_disp} of prior net sales)",
        f"prior_cm3:       {pri_cm3_disp}",
        f"prior_ad_spend:  {pri_ad_spend_disp}",
        f"prior_MER:       {pri_mer_disp}",
        f"prior_ACOS:      {pri_acos_disp}",
        f"MER_pct_change:  {mer_pct_change_disp}",
        "",
        "### Period-over-Period Deltas (copy these verbatim, do NOT recompute)",
        f"cm2_delta:         {cm2_delta_disp}",
        f"cm1_delta:         {cm1_delta_disp}",
        f"net_sales_delta:   {net_sales_delta_disp}",
        f"ad_spend_delta:    {ad_spend_delta_disp}",
        "",
    ]

    # Defect 3 convergent fix: re-format anomaly/spike/drop/trend descriptions
    # using display tokens instead of raw paise integers.  The .description
    # strings from pnl_signals.py contain raw integer values (e.g. "CM2 high on
    # 2026-04-20: 6253340 (avg 4321000, z=2.05)") which the model would quote as
    # raw integers or mis-convert.  We rewrite them here using _format_money /
    # _format_pct so every number is a display token (₹X.XCr, X.X%).
    if pnl_signals.anomalies:
        lines.append("### Statistical Anomalies (z≥2.0)")
        for a in pnl_signals.anomalies:
            val_disp = _format_money(a.value_mu)
            avg_disp = _format_money(a.expected_avg_mu)
            z_disp = f"{a.deviation_z_x100 / 100:.2f}"
            lines.append(
                f"{a.metric} {a.direction} on {a.date}: "
                f"{val_disp} (avg {avg_disp}, z={z_disp})"
            )
        lines.append("")

    if pnl_signals.spikes or pnl_signals.drops:
        lines.append("### Spikes/Drops (±25% day-over-day)")
        for s in pnl_signals.spikes:
            val_disp = _format_money(s.value_mu)
            pri_disp = _format_money(s.prior_value_mu)
            pct_disp = _format_pct(s.pct_change_x10 * 10)  # pct_x10 → bp
            lines.append(
                f"{s.metric} spiked {pct_disp} on {s.date} "
                f"({val_disp} vs prior {pri_disp})"
            )
        for d in pnl_signals.drops:
            val_disp = _format_money(d.value_mu)
            pri_disp = _format_money(d.prior_value_mu)
            pct_disp = _format_pct(d.pct_change_x10 * 10)  # pct_x10 → bp
            lines.append(
                f"{d.metric} dropped {pct_disp} on {d.date} "
                f"({val_disp} vs prior {pri_disp})"
            )
        lines.append("")

    if pnl_signals.trends:
        lines.append("### Period-over-Period Trends")
        for t in pnl_signals.trends:
            pct_disp = _format_pct(t.pct_change_x10 * 10)  # pct_x10 → bp
            cur_disp = _format_money(t.current_value_mu)
            pri_disp = _format_money(t.prior_value_mu)
            lines.append(
                f"{t.metric} {t.direction} {pct_disp}: "
                f"{cur_disp} (prior {pri_disp})"
            )
        lines.append("")

    return "\n".join(lines)


def _parse_insights_from_json(narration: str) -> list[dict]:
    """Parse InsightItem[] from the LLM JSON response.

    The system prompt instructs the LLM to return valid JSON only (Rule 10).
    Defect 1 fix: strip markdown fence before json.loads() — the model emits
    ```json … ``` despite the instruction; be robust.
    Returns an empty list if parsing fails (graceful degradation).
    """
    from domain.faithfulness.validator import _strip_markdown_fence  # noqa: PLC0415

    cleaned = _strip_markdown_fence(narration)
    try:
        data = json.loads(cleaned)
        insights = data.get("insights", []) if isinstance(data, dict) else []
        return insights[:5]  # max 5 insights
    except (json.JSONDecodeError, TypeError, AttributeError):
        logger.warning(
            "PnlInsightAgent: failed to parse JSON from LLM response. "
            "narration_preview=%r",
            narration[:200],
        )
        return []
