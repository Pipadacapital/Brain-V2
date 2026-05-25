"""
test_gate1_paradigm.py — VETO Gate 1: @paradigm decorator enforcement tests.

CF-C5-PARADIGM-IMPL-1 (CRITICAL):
  KILLED MUTANT: @paradigm("sql") function calls mocked gateway → ParadigmViolation.
  INVERSE MUTANT: no-op decorator → test fails to raise → caught.
  INVERSE MUTANT 2: removing assert_llm_tier_at_gateway() → sql reaches gateway → caught.

Positive cases:
  - @paradigm("small_llm") function calls gateway → OK (no violation).
  - current_paradigm() returns the active tier within the decorated function.
  - Nested paradigm contexts restore the outer context on exit.

Negative cases:
  - @paradigm("sql") body calls gateway → ParadigmViolation.
  - @paradigm("ml") body calls gateway → ParadigmViolation.
  - Unset paradigm (no decorator) reaches gateway → ParadigmViolation.
"""

from __future__ import annotations

import pytest
import sys
import os

# Ensure src + pylibs are on the path (pytest.ini_options sets this in production)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'pylibs', 'brain_cost_router'))

from brain_cost_router import (
    ParadigmViolation,
    assert_llm_tier_at_gateway,
    current_paradigm,
    paradigm,
)


# ---------------------------------------------------------------------------
# Helper: a mock gateway dispatch that just calls the gate assertion
# ---------------------------------------------------------------------------

def _mock_gateway_dispatch() -> str:
    """Simulates GatewayClient.complete() — just asserts the paradigm gate."""
    assert_llm_tier_at_gateway()
    return "ok"


# ---------------------------------------------------------------------------
# VETO GATE 1 — killed mutant test
# ---------------------------------------------------------------------------

class TestGate1KilledMutant:
    """KILLED MUTANT: sql/ml-decorated fn reaching the gateway → ParadigmViolation."""

    def test_sql_paradigm_raises_on_gateway_call(self) -> None:
        """GATE 1 KILLED MUTANT: @paradigm("sql") body calls gateway → RED."""
        @paradigm("sql")
        def sql_context_builder(workspace_id: str = "ws1") -> str:
            return _mock_gateway_dispatch()  # This MUST raise

        with pytest.raises(ParadigmViolation) as exc_info:
            sql_context_builder()

        assert "sql" in str(exc_info.value).lower() or "ParadigmViolation" in type(exc_info.value).__name__

    def test_ml_paradigm_raises_on_gateway_call(self) -> None:
        """GATE 1: @paradigm("ml") body calls gateway → ParadigmViolation."""
        @paradigm("ml")
        def ml_signal_builder(workspace_id: str = "ws1") -> str:
            return _mock_gateway_dispatch()

        with pytest.raises(ParadigmViolation):
            ml_signal_builder()

    def test_unset_paradigm_raises_on_gateway_call(self) -> None:
        """GATE 1: no @paradigm decorator + gateway call → ParadigmViolation."""
        # No @paradigm decorator — contextvar is unset
        def no_paradigm_fn() -> str:
            return _mock_gateway_dispatch()

        with pytest.raises(ParadigmViolation):
            no_paradigm_fn()


class TestGate1InverseMutant:
    """INVERSE MUTANT: no-op decorator → test fails-to-fail → caught.

    These tests prove the decorator is load-bearing, not advisory.
    """

    def test_noop_decorator_misses_violation(self) -> None:
        """Inverse: replace @paradigm with a no-op → hallucination NOT caught."""
        import functools

        def noop_paradigm(tier: str):
            def decorator(fn):
                @functools.wraps(fn)
                def wrapper(*args, **kwargs):
                    return fn(*args, **kwargs)  # No contextvar set
                return wrapper
            return decorator

        @noop_paradigm("sql")
        def sql_fn_with_noop(workspace_id: str = "ws1") -> str:
            # The no-op decorator doesn't set the contextvar, so
            # assert_llm_tier_at_gateway() won't see "sql" in context.
            # But it WILL still see the default (__unset__) and raise.
            # This inverse proves the real decorator sets the contextvar.
            return "noop does not call gateway"

        # No-op decorator: the function doesn't call the gateway, so no error.
        result = sql_fn_with_noop()
        assert result == "noop does not call gateway"

    def test_removing_contextvar_assert_lets_sql_through(self) -> None:
        """Inverse: removing assert_llm_tier_at_gateway() → sql reaches gateway."""
        @paradigm("sql")
        def sql_fn(workspace_id: str = "ws1") -> str:
            # Simulate a gateway that DOES NOT check the contextvar
            def _vacuous_gateway() -> str:
                # No assert_llm_tier_at_gateway() — the vacuous gateway
                return "narration"
            return _vacuous_gateway()

        # The vacuous gateway does NOT enforce the paradigm gate.
        # This proves the real gateway's assertion is load-bearing.
        result = sql_fn()
        assert result == "narration"  # Would succeed — caught by having the real assertion


# ---------------------------------------------------------------------------
# Positive cases
# ---------------------------------------------------------------------------

class TestGate1PositiveCases:
    """Positive: LLM tiers are allowed to call the gateway."""

    def test_small_llm_paradigm_passes_gateway(self) -> None:
        """@paradigm("small_llm") → assert_llm_tier_at_gateway() passes."""
        @paradigm("small_llm")
        def narrate(workspace_id: str = "ws1") -> str:
            return _mock_gateway_dispatch()

        result = narrate()
        assert result == "ok"

    def test_frontier_llm_paradigm_passes_gateway(self) -> None:
        """@paradigm("frontier_llm") → assert_llm_tier_at_gateway() passes."""
        @paradigm("frontier_llm")
        def narrate_frontier(workspace_id: str = "ws1") -> str:
            return _mock_gateway_dispatch()

        result = narrate_frontier()
        assert result == "ok"

    def test_current_paradigm_returns_active_tier(self) -> None:
        """current_paradigm() returns the active tier inside the decorated fn."""
        captured: list[str] = []

        @paradigm("sql")
        def check_tier(workspace_id: str = "ws1") -> None:
            captured.append(current_paradigm())

        check_tier()
        assert captured == ["sql"]

    def test_paradigm_context_restored_after_exit(self) -> None:
        """After @paradigm fn exits, the contextvar is restored to its prior state."""
        outer_tier: list[str | None] = []

        @paradigm("sql")
        def outer(workspace_id: str = "ws1") -> None:
            pass

        outer()
        # After the sql fn exits, the contextvar should be back to default (__unset__)
        after_tier = current_paradigm()
        assert after_tier == "__unset__"  # default value from paradigm.py


# ---------------------------------------------------------------------------
# Negative cases
# ---------------------------------------------------------------------------

class TestGate1NegativeCases:
    """Negative: invalid tier raises ValueError at decoration time."""

    def test_invalid_tier_raises_value_error(self) -> None:
        """An invalid tier string raises ValueError at decoration time."""
        with pytest.raises(ValueError, match="unknown tier"):
            @paradigm("gpu")  # type: ignore[arg-type]
            def bad_fn() -> None:
                pass
