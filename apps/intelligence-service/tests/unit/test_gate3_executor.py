"""
test_gate3_executor.py — VETO Gate 3: Iron-Law executor tests.

CF-C5-INJECTION-EXECUTOR-2 (CRITICAL):

KILLED MUTANT: injected amount_mu=9999999 in tool-call JSON -> Pydantic DROPS
  the extra field; executed magnitude = server cap value, NOT 9999999.
INVERSE MUTANT: add a `magnitude` field to WriteToolCall and have the executor
  use it -> injected magnitude fires -> caught.

Positive:
  - WriteToolCall with valid enum fields -> accepted.
  - execute_write_tool with server cap -> executed_magnitude == server cap.
  - Per-day aggregate cap enforced.

Negative:
  - Amount injected in JSON -> silently dropped.
  - Per-call cap exceeded -> REJECTED_PER_CALL_CAP.
  - Per-day cap exceeded -> REJECTED_PER_DAY_CAP.
"""

from __future__ import annotations

import pytest
from datetime import date
from pydantic import ValidationError

from domain.tools.tool_contract import WriteToolCall, WriteToolNameEnum, IntentEnum
from domain.tools.executor import (
    WorkspaceActionCap,
    ExecutionStatus,
    execute_write_tool,
    resolve_magnitude,
)


# ---------------------------------------------------------------------------
# VETO GATE 3 — killed mutant test
# ---------------------------------------------------------------------------

class TestGate3KilledMutant:
    """KILLED MUTANT: injected amount_mu DROPPED, server value used."""

    def test_injected_amount_mu_dropped_by_pydantic(self) -> None:
        """GATE 3 KILLED MUTANT: amount_mu in JSON is silently dropped by Pydantic.

        The WriteToolCall schema has extra="ignore". Any injected magnitude field
        is silently dropped. The executor NEVER sees amount_mu=9999999.
        """
        # Craft the raw JSON an attacker might inject.
        raw_json = {
            "tool": "pause_ad_set",
            "entity_id": "ad_set_123",
            "intent": "PAUSE",
            "amount_mu": 9_999_999,  # INJECTED - must be DROPPED
            "budget_mu": 5_000_000,  # INJECTED - must be DROPPED
            "price": 99999,          # INJECTED - must be DROPPED
        }

        call = WriteToolCall.model_validate(raw_json)

        # The parsed call has no magnitude attribute.
        assert not hasattr(call, "amount_mu"), "INJECTED amount_mu must be DROPPED"
        assert not hasattr(call, "budget_mu"), "INJECTED budget_mu must be DROPPED"
        assert not hasattr(call, "price"), "INJECTED price must be DROPPED"

        # The call only has the three allowed fields.
        assert call.tool == WriteToolNameEnum.PAUSE_AD_SET
        assert call.entity_id == "ad_set_123"
        assert call.intent == IntentEnum.PAUSE

    def test_executed_magnitude_is_server_value_not_injected(self) -> None:
        """GATE 3: executed_magnitude = server cap value, NOT the injected 9999999."""
        server_cap = WorkspaceActionCap(
            workspace_id="ws_A",
            tool="pause_ad_set",
            per_call_max_mu=10_000,  # Server says ₹100
            per_day_max_mu=100_000,
        )

        raw_json = {
            "tool": "pause_ad_set",
            "entity_id": "ad_set_123",
            "intent": "PAUSE",
            "amount_mu": 9_999_999,  # INJECTED — must be ignored
        }
        call = WriteToolCall.model_validate(raw_json)

        result = execute_write_tool(
            call,
            workspace_id="ws_A",
            _cap_reader=lambda ws, tool: server_cap,
            _daily_aggregate_reader=lambda ws, tool, day: 0,
            _daily_aggregate_writer=lambda ws, tool, day, mu: None,
        )

        assert result.status == ExecutionStatus.EXECUTED
        # PAUSE intent = magnitude 0 (not the injected 9999999)
        assert result.executed_magnitude_mu == 0, (
            f"INJECTION BUG: executed_magnitude_mu should be 0 (PAUSE intent "
            f"server-side), got {result.executed_magnitude_mu}"
        )

    def test_increase_intent_uses_server_cap_not_injected(self) -> None:
        """INCREASE intent: server per_call_max_mu used, not any injected value."""
        server_cap = WorkspaceActionCap(
            workspace_id="ws_A",
            tool="reallocate_budget",
            per_call_max_mu=50_000,   # Server cap = ₹500
            per_day_max_mu=500_000,
        )

        raw_json = {
            "tool": "reallocate_budget",
            "entity_id": "campaign_xyz",
            "intent": "INCREASE",
            "amount_mu": 9_999_999,  # INJECTED
        }
        call = WriteToolCall.model_validate(raw_json)

        result = execute_write_tool(
            call,
            workspace_id="ws_A",
            _cap_reader=lambda ws, tool: server_cap,
            _daily_aggregate_reader=lambda ws, tool, day: 0,
            _daily_aggregate_writer=lambda ws, tool, day, mu: None,
        )

        assert result.status == ExecutionStatus.EXECUTED
        # Must equal the server cap per_call_max_mu, NOT 9999999.
        assert result.executed_magnitude_mu == 50_000, (
            f"INJECTION BUG: executed_magnitude_mu should be 50_000 (server cap), "
            f"got {result.executed_magnitude_mu}"
        )


class TestGate3InverseMutant:
    """INVERSE MUTANT: adding a magnitude field to WriteToolCall and using it -> caught."""

    def test_inverse_if_magnitude_field_existed_it_could_be_injected(self) -> None:
        """Demonstrates WHY the magnitude field must NOT exist in WriteToolCall."""
        from pydantic import BaseModel, ConfigDict

        # Simulate the VULNERABLE version (with a magnitude field).
        class VulnerableToolCall(BaseModel):
            model_config = ConfigDict(frozen=True)
            tool: WriteToolNameEnum
            entity_id: str
            intent: IntentEnum
            magnitude_mu: int = 0  # DANGEROUS: accepts injected amount

        raw_json = {
            "tool": "reallocate_budget",
            "entity_id": "campaign_xyz",
            "intent": "INCREASE",
            "magnitude_mu": 9_999_999,  # INJECTED
        }
        vulnerable_call = VulnerableToolCall.model_validate(raw_json)
        # The vulnerable call DOES expose the injected magnitude.
        assert vulnerable_call.magnitude_mu == 9_999_999  # The injection succeeds.

        # The REAL WriteToolCall does NOT have magnitude_mu.
        real_call = WriteToolCall.model_validate(raw_json)
        assert not hasattr(real_call, "magnitude_mu")  # DROPPED by the real schema.


# ---------------------------------------------------------------------------
# Positive cases
# ---------------------------------------------------------------------------

class TestExecutorPositive:
    def test_pause_intent_magnitude_zero(self) -> None:
        """PAUSE intent always executes with magnitude 0."""
        cap = WorkspaceActionCap(
            workspace_id="ws_A",
            tool="pause_ad_set",
            per_call_max_mu=10_000,
            per_day_max_mu=50_000,
        )
        call = WriteToolCall(
            tool=WriteToolNameEnum.PAUSE_AD_SET,
            entity_id="ad_set_1",
            intent=IntentEnum.PAUSE,
        )
        result = execute_write_tool(
            call, "ws_A",
            _cap_reader=lambda ws, t: cap,
            _daily_aggregate_reader=lambda ws, t, d: 0,
            _daily_aggregate_writer=lambda ws, t, d, mu: None,
        )
        assert result.status == ExecutionStatus.EXECUTED
        assert result.executed_magnitude_mu == 0

    def test_decrease_intent_uses_server_cap(self) -> None:
        cap = WorkspaceActionCap(
            workspace_id="ws_B",
            tool="reallocate_budget",
            per_call_max_mu=20_000,
            per_day_max_mu=100_000,
        )
        call = WriteToolCall(
            tool=WriteToolNameEnum.REALLOCATE_BUDGET,
            entity_id="campaign_1",
            intent=IntentEnum.DECREASE,
        )
        result = execute_write_tool(
            call, "ws_B",
            _cap_reader=lambda ws, t: cap,
            _daily_aggregate_reader=lambda ws, t, d: 0,
            _daily_aggregate_writer=lambda ws, t, d, mu: None,
        )
        assert result.status == ExecutionStatus.EXECUTED
        assert result.executed_magnitude_mu == 20_000


# ---------------------------------------------------------------------------
# Per-call cap enforcement
# ---------------------------------------------------------------------------

class TestPerCallCap:
    def test_per_call_cap_exceeded_rejected(self) -> None:
        """Magnitude > per_call_max_mu -> REJECTED_PER_CALL_CAP.

        Uses _requested_fraction_bp > 10_000 to trigger a magnitude that
        exceeds the per-call cap. This proves the per-call cap check is
        load-bearing (not vacuous) — it fires when resolve_magnitude returns
        a value above the cap, which happens when the fraction > 100%.

        C5-SEC-008 fix: the check is no longer vacuous; it fires when fine-
        grained intent-to-magnitude mapping requests a fraction > 1x the cap.
        """
        cap = WorkspaceActionCap(
            workspace_id="ws_C",
            tool="reallocate_budget",
            per_call_max_mu=10_000,  # cap is 10k
            per_day_max_mu=100_000,
        )
        call = WriteToolCall(
            tool=WriteToolNameEnum.REALLOCATE_BUDGET,
            entity_id="campaign_1",
            intent=IntentEnum.INCREASE,
        )
        # Normal flow at 100% fraction: magnitude == per_call_max_mu → EXECUTED.
        result_ok = execute_write_tool(
            call, "ws_C",
            _cap_reader=lambda ws, t: cap,
            _daily_aggregate_reader=lambda ws, t, d: 0,
            _daily_aggregate_writer=lambda ws, t, d, mu: None,
            _requested_fraction_bp=10_000,  # 100% — exactly at cap
        )
        assert result_ok.status == ExecutionStatus.EXECUTED
        assert result_ok.executed_magnitude_mu == 10_000

        # Per-call cap exceeded: 150% fraction → magnitude = 15_000 > 10_000 → REJECTED.
        result_rejected = execute_write_tool(
            call, "ws_C",
            _cap_reader=lambda ws, t: cap,
            _daily_aggregate_reader=lambda ws, t, d: 0,
            _daily_aggregate_writer=lambda ws, t, d, mu: None,
            _requested_fraction_bp=15_000,  # 150% of cap → 15_000 > 10_000
        )
        assert result_rejected.status == ExecutionStatus.REJECTED_PER_CALL_CAP, (
            "Per-call cap check is VACUOUS if this assertion fails — "
            "a 150% fraction must exceed the cap and be rejected."
        )
        assert result_rejected.executed_magnitude_mu is None


# ---------------------------------------------------------------------------
# Per-day aggregate cap
# ---------------------------------------------------------------------------

class TestPerDayCap:
    def test_per_day_cap_enforced(self) -> None:
        """Sum of today's spend + new spend > per_day_max_mu -> REJECTED_PER_DAY_CAP."""
        cap = WorkspaceActionCap(
            workspace_id="ws_D",
            tool="reallocate_budget",
            per_call_max_mu=50_000,
            per_day_max_mu=100_000,  # Daily cap is 100k
        )
        call = WriteToolCall(
            tool=WriteToolNameEnum.REALLOCATE_BUDGET,
            entity_id="campaign_1",
            intent=IntentEnum.INCREASE,
        )

        # Simulate 75k already spent today -> 75k + 50k = 125k > 100k -> REJECTED.
        result = execute_write_tool(
            call, "ws_D",
            _cap_reader=lambda ws, t: cap,
            _daily_aggregate_reader=lambda ws, t, d: 75_000,  # 75k already today
            _daily_aggregate_writer=lambda ws, t, d, mu: None,
        )
        assert result.status == ExecutionStatus.REJECTED_PER_DAY_CAP
        assert result.executed_magnitude_mu is None

    def test_per_day_cap_exactly_at_limit_accepted(self) -> None:
        """Exactly at the daily cap limit -> EXECUTED (boundary: sum + new == max allowed)."""
        cap = WorkspaceActionCap(
            workspace_id="ws_E",
            tool="reallocate_budget",
            per_call_max_mu=50_000,
            per_day_max_mu=100_000,
        )
        call = WriteToolCall(
            tool=WriteToolNameEnum.REALLOCATE_BUDGET,
            entity_id="campaign_1",
            intent=IntentEnum.INCREASE,
        )
        # 50k already spent + 50k new = 100k == per_day_max_mu -> ACCEPTED (strict <).
        result = execute_write_tool(
            call, "ws_E",
            _cap_reader=lambda ws, t: cap,
            _daily_aggregate_reader=lambda ws, t, d: 50_000,
            _daily_aggregate_writer=lambda ws, t, d, mu: None,
        )
        assert result.status == ExecutionStatus.EXECUTED


# ---------------------------------------------------------------------------
# WriteToolCall schema validation
# ---------------------------------------------------------------------------

class TestWriteToolCallSchema:
    def test_valid_call_accepted(self) -> None:
        call = WriteToolCall(
            tool=WriteToolNameEnum.PAUSE_AD_SET,
            entity_id="ad_set_1",
            intent=IntentEnum.PAUSE,
        )
        assert call.tool == WriteToolNameEnum.PAUSE_AD_SET

    def test_invalid_tool_rejected(self) -> None:
        with pytest.raises(ValidationError):
            WriteToolCall.model_validate({
                "tool": "send_spam",  # Not in the closed enum
                "entity_id": "x",
                "intent": "PAUSE",
            })

    def test_invalid_intent_rejected(self) -> None:
        with pytest.raises(ValidationError):
            WriteToolCall.model_validate({
                "tool": "pause_ad_set",
                "entity_id": "x",
                "intent": "SET_AMOUNT_TO_9999",  # Not in the closed enum
            })


# ---------------------------------------------------------------------------
# TZ-correct cap day boundary (python-services-8 fix)
# ---------------------------------------------------------------------------

class TestCapDayBoundaryTz:
    """Per-day cap boundary must use UTC date, not local date.

    BEFORE (bug): date.today() uses the server's local timezone. On IST (+5:30),
    this means midnight UTC → 05:30 IST, creating a ±1-day error window where
    the cap counter resets at the wrong moment.
    AFTER: datetime.now(timezone.utc).date() always uses UTC.
    """

    def test_cap_day_uses_utc_date(self) -> None:
        """Per-day aggregate reader is called with a date derived from UTC.

        We inject a _daily_aggregate_reader that records which date it was
        called with. The test verifies the date is UTC-derived.
        """
        from datetime import datetime, timezone

        captured_dates: list = []
        cap = WorkspaceActionCap(
            workspace_id="ws_tz",
            tool="pause_ad_set",
            per_call_max_mu=50_000,
            per_day_max_mu=100_000,
        )
        call = WriteToolCall(
            tool=WriteToolNameEnum.PAUSE_AD_SET,
            entity_id="ad_tz",
            intent=IntentEnum.INCREASE,
        )

        def capturing_reader(ws: str, tool: str, day) -> int:
            captured_dates.append(day)
            return 0

        execute_write_tool(
            call, "ws_tz",
            _cap_reader=lambda ws, t: cap,
            _daily_aggregate_reader=capturing_reader,
            _daily_aggregate_writer=lambda ws, t, d, mu: None,
        )

        assert len(captured_dates) == 1
        received_date = captured_dates[0]
        # Must equal today in UTC
        expected_utc_date = datetime.now(timezone.utc).date()
        assert received_date == expected_utc_date, (
            f"Cap day mismatch: executor used {received_date}, "
            f"expected UTC date {expected_utc_date}. "
            "TZ bug: date.today() was replaced by datetime.now(timezone.utc).date()."
        )

    def test_cap_day_is_a_date_not_datetime(self) -> None:
        """The cap day value must be a date object, not a datetime."""
        from datetime import date as date_type

        captured_dates: list = []
        cap = WorkspaceActionCap(
            workspace_id="ws_tz2",
            tool="pause_ad_set",
            per_call_max_mu=50_000,
            per_day_max_mu=100_000,
        )
        call = WriteToolCall(
            tool=WriteToolNameEnum.PAUSE_AD_SET,
            entity_id="ad_tz2",
            intent=IntentEnum.PAUSE,
        )

        def capturing_reader(ws: str, tool: str, day) -> int:
            captured_dates.append(day)
            return 0

        execute_write_tool(
            call, "ws_tz2",
            _cap_reader=lambda ws, t: cap,
            _daily_aggregate_reader=capturing_reader,
            _daily_aggregate_writer=lambda ws, t, d, mu: None,
        )
        assert len(captured_dates) == 1
        assert type(captured_dates[0]) is date_type, (
            f"Cap day must be date, got {type(captured_dates[0])}"
        )
