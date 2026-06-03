"""
pnl_eval.py — Golden-set + faithfulness/groundedness eval harness for the pnl agent.

@paradigm: sql  (eval harness — pure comparison logic, no LLM)
CF-C5-FAITHFULNESS-1: the 07:15-class synthesis must NEVER contradict
    deterministic numbers. The golden-set tests enforce this.

THREE-POINT CI RELEASE GATE:
    1. OFFLINE: golden-set eval with fixed fixtures → must pass in CI.
    2. PRE-MERGE: run against a mocked gateway with known outputs.
    3. ONLINE (sampling): @pytest.mark.smoke — real Haiku call, skipped in CI.

KILLED MUTANT (required by §A0.3):
    The eval set includes a deliberately hallucinated narration
    ("net sales were ₹1,40,000" when signal is 120,000) → ok=False (RED).
    Inverse mutant: replacing validate_faithfulness with a no-op → test goes
    GREEN-when-RED-expected → caught.

FALSE-REJECT PASS CASES (CF-C5-FAITHFULNESS-COST-1):
    - "approximately ₹1.2L" vs signal 120,000 → PASS
    - "₹1,20,000" (Indian grouping) vs signal 120,000 → PASS
    - "12.5%" vs 1,250 bp → PASS
    - "₹1,40,000 paise" vs signal 14,000,000 paise → need explicit paise → special case

RETRY-RATE ASSERTION:
    The eval harness tracks faithfulness retries. An alarm fires when
    retry_rate > 20% (CF-C5-FAITHFULNESS-COST-1).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

from brain_cost_router import paradigm

from domain.faithfulness.validator import FaithfulnessResult, Signal, validate_faithfulness


# ---------------------------------------------------------------------------
# Golden-set fixture types
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class GoldenCase:
    """One golden-set evaluation case.

    case_id: unique identifier (for CI reporting).
    narration: the LLM-generated text to validate.
    signals: the ground-truth Tier-A signal values.
    expected_ok: True if the narration should pass faithfulness (PASS case),
                 False if it should fail (KILLED MUTANT / hallucination case).
    description: human-readable description of what this case tests.
    """
    case_id: str
    narration: str
    signals: list[Signal]
    expected_ok: bool
    description: str


@dataclass
class EvalResult:
    """Result of running the golden-set eval harness."""
    total: int = 0
    passed: int = 0
    failed: int = 0
    retries_triggered: int = 0
    failures: list[dict] = field(default_factory=list)

    @property
    def retry_rate(self) -> float:
        """Faithfulness retry rate. Alarm if > 20% (CF-C5-FAITHFULNESS-COST-1)."""
        if self.total == 0:
            return 0.0
        return self.retries_triggered / self.total

    @property
    def all_passed(self) -> bool:
        return self.failed == 0


# ---------------------------------------------------------------------------
# The canonical golden-set (LOCKED — these cases must not be removed)
# ---------------------------------------------------------------------------

GOLDEN_SET: list[GoldenCase] = [
    # --- KILLED MUTANT: hallucinated number → RED ---
    GoldenCase(
        case_id="GATE2-KM-001",
        narration="Your net sales were ₹1,40,000 this period.",
        signals=[Signal("net_sales_mu", 120_000)],
        expected_ok=False,
        description="GATE2 KILLED MUTANT: hallucinated ₹1,40,000 vs signal 120,000 → RED.",
    ),
    GoldenCase(
        case_id="GATE2-KM-002",
        narration="CM2 margin improved to 15% this month.",
        signals=[Signal("cm2_pct_bp", 1_000)],  # signal = 10% = 1000bp
        expected_ok=False,
        description="GATE2 KILLED MUTANT: hallucinated 15% vs signal 1000bp (10%) → RED.",
    ),

    # --- FALSE-REJECT PASS CASES (CF-C5-FAITHFULNESS-COST-1) ---
    GoldenCase(
        case_id="GATE2-FR-001",
        narration="Revenue was approximately ₹1.2L this week.",
        signals=[Signal("net_sales_mu", 120_000)],
        expected_ok=True,
        description="FALSE-REJECT PASS: ₹1.2L normalizes to 120,000 → must PASS.",
    ),
    GoldenCase(
        case_id="GATE2-FR-002",
        narration="Your net sales were ₹1,20,000 vs prior ₹1,00,000.",
        signals=[
            Signal("net_sales_mu", 120_000),
            Signal("prior_net_sales_mu", 100_000),
        ],
        expected_ok=True,
        description="FALSE-REJECT PASS: Indian grouping ₹1,20,000 → 120,000 → PASS.",
    ),
    GoldenCase(
        case_id="GATE2-FR-003",
        narration="Your RTO rate was 12.5% last month.",
        signals=[Signal("rto_rate_bp", 1_250)],
        expected_ok=True,
        description="FALSE-REJECT PASS: 12.5% → 1250 bp → PASS.",
    ),
    GoldenCase(
        case_id="GATE2-FR-004",
        narration="CM2 declined to ₹50,000 from ₹80,000 prior period.",
        signals=[
            Signal("cm2_mu", 50_000),
            Signal("prior_cm2_mu", 80_000),
        ],
        expected_ok=True,
        description="FALSE-REJECT PASS: Multiple Indian grouping values all match.",
    ),

    # --- POSITIVE: faithful narration with no numbers → trivially faithful ---
    GoldenCase(
        case_id="GATE2-POS-001",
        narration="CM2 margins improved significantly this period.",
        signals=[Signal("cm2_mu", 50_000)],
        expected_ok=True,
        description="POSITIVE: no numbers in narration → trivially faithful.",
    ),

    # --- POSITIVE: exact integer match ---
    GoldenCase(
        case_id="GATE2-POS-002",
        narration="Net sales: 120000 paise for the period.",
        signals=[Signal("net_sales_mu", 120_000)],
        expected_ok=True,
        description="POSITIVE: plain integer paise match → PASS.",
    ),

    # --- NEGATIVE: close but not equal → must fail ---
    GoldenCase(
        case_id="GATE2-NEG-001",
        narration="Revenue was ₹1,21,000 (close to goal).",
        signals=[Signal("net_sales_mu", 120_000)],
        expected_ok=False,
        description="NEGATIVE: 121,000 ≠ 120,000 → RED (close but different).",
    ),

    # --- Crore notation ---
    GoldenCase(
        case_id="GATE2-FR-005",
        narration="Total revenue reached ₹1.2Cr this quarter.",
        signals=[Signal("net_sales_mu", 12_000_000)],
        expected_ok=True,
        description="FALSE-REJECT PASS: ₹1.2Cr → 12,000,000 → PASS.",
    ),

    # -----------------------------------------------------------------------
    # SLICE-9 (feat-ai-insight-narration) page-narration golden cases.
    # These mirror the /pnl InsightStrip narration against the Sugandh-Lok seed
    # (rupee-canonical: cm2 320_000, realized 1_850_000, ad_spend 650_000, rto 1800 bp).
    # -----------------------------------------------------------------------
    GoldenCase(
        case_id="S9-PNL-POS-1",
        narration=(
            "On ₹18.5L realized revenue, contribution margin after ads (CM2) is ₹3.2L. "
            "Ad spend of ₹6.5L is being earned back — CM2 stays positive."
        ),
        signals=[
            Signal("realized_revenue_mu", 1_850_000),
            Signal("cm2_mu", 320_000),
            Signal("total_ad_spend_mu", 650_000),
        ],
        expected_ok=True,
        description="S9 PASS: every page-narration number grounded in the /pnl signal set.",
    ),
    GoldenCase(
        case_id="S9-PNL-RTO-POS-1",
        narration="Return-to-origin is running at 18%, netting out of the ₹18.5L realized base.",
        signals=[
            Signal("rto_rate_bp", 1_800),  # 18% → 1800 bp
            Signal("realized_revenue_mu", 1_850_000),
        ],
        expected_ok=True,
        description="S9 PASS: RTO 18% (1800 bp) + ₹18.5L both grounded.",
    ),
    GoldenCase(
        case_id="S9-PNL-KM-1",
        narration="On ₹18.5L realized revenue, CM2 is actually ₹4.0L this period.",
        signals=[
            Signal("realized_revenue_mu", 1_850_000),
            Signal("cm2_mu", 320_000),  # ₹3.2L — NOT ₹4.0L (400_000)
        ],
        expected_ok=False,
        description="S9 KILLED MUTANT: narration hallucinates CM2 ₹4.0L (400_000) ∉ signals → RED.",
    ),
]


# ---------------------------------------------------------------------------
# Eval harness
# ---------------------------------------------------------------------------

@paradigm("sql")
def run_golden_set_eval(
    golden_set: Sequence[GoldenCase] | None = None,
    *,
    workspace_id: str = "eval",
) -> EvalResult:
    """Run the golden-set faithfulness eval.

    @paradigm: sql — pure comparison logic, no LLM.
    CF-C5-FAITHFULNESS-1: every golden case must pass for CI green.

    THREE-POINT CI gate: this is the OFFLINE (point 1) gate.
    Pre-merge (point 2) is the mock-gateway integration test.
    Online sampling (point 3) is the @pytest.mark.smoke test.

    Args:
        golden_set: the cases to evaluate. Defaults to GOLDEN_SET.
        workspace_id: for telemetry (not used in eval logic).

    Returns:
        EvalResult with pass/fail counts and retry_rate.
        all_passed=True is the CI gate condition.
    """
    cases = golden_set if golden_set is not None else GOLDEN_SET
    result = EvalResult(total=len(cases))

    for case in cases:
        faith_result = validate_faithfulness(case.narration, case.signals)

        # Simulate the retry mechanic: if faith_result.ok == False and we
        # expected ok=True (a false-reject), this would trigger a retry.
        # We track this for the retry_rate metric.
        if not faith_result.ok and case.expected_ok:
            result.retries_triggered += 1

        if faith_result.ok == case.expected_ok:
            result.passed += 1
        else:
            result.failed += 1
            result.failures.append({
                "case_id": case.case_id,
                "description": case.description,
                "expected_ok": case.expected_ok,
                "got_ok": faith_result.ok,
                "offending_numbers": faith_result.offending_numbers,
            })

    return result


@paradigm("sql")
def assert_golden_set_passes(
    golden_set: Sequence[GoldenCase] | None = None,
    *,
    workspace_id: str = "eval",
) -> None:
    """Assert the golden-set eval passes completely.

    @paradigm: sql — pure comparison logic, no LLM.
    Raises AssertionError with failure details if any case fails.
    Called by the CI gate test (test_pnl_eval_harness.py).

    CF-C5-FAITHFULNESS-COST-1: also asserts retry_rate <= 20%.
    """
    result = run_golden_set_eval(golden_set, workspace_id=workspace_id)

    if not result.all_passed:
        failure_details = "\n".join(
            f"  [{f['case_id']}] {f['description']}\n"
            f"    expected_ok={f['expected_ok']}, got={f['got_ok']}, "
            f"offending={f['offending_numbers']}"
            for f in result.failures
        )
        raise AssertionError(
            f"Golden-set eval FAILED: {result.failed}/{result.total} cases failed.\n"
            f"{failure_details}\n"
            "CF-C5-FAITHFULNESS-1: the 07:15 synthesis must never contradict "
            "deterministic numbers."
        )

    if result.retry_rate > 0.20:
        raise AssertionError(
            f"Faithfulness retry_rate={result.retry_rate:.1%} > 20% threshold. "
            f"{result.retries_triggered} false-rejects in {result.total} cases. "
            "CF-C5-FAITHFULNESS-COST-1: canonical normalization must prevent false-rejects."
        )
