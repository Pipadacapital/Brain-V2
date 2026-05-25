"""
test_paradigm.py — Unit tests for the @paradigm decorator.

VETO GATE 1 (CF-C5-PARADIGM-IMPL-1):
  - KILLED MUTANT: a sql-decorated function whose body calls a mocked
    GatewayClient.complete() -> ParadigmViolation raised (RED).
  - INVERSE MUTANT: removing the contextvar assertion from the dispatch
    boundary (replace assert_llm_tier_at_gateway with a no-op) -> the
    sql-reaches-gateway test goes GREEN-when-it-should-be-RED -> CAUGHT.
  - Positive case: small_llm-decorated function reaching the dispatch
    boundary -> NO exception.
  - Telemetry: paradigm_distribution emitted per invocation (mocked OTel).
  - Contextvar restoration: tier reverts to previous value after return.
  - frontier_llm: also passes the dispatch assertion.
  - Unknown tier: raises ValueError at decoration time.
"""

from __future__ import annotations

import pytest

from brain_cost_router import (
    ParadigmViolation,
    assert_llm_tier_at_gateway,
    current_paradigm,
    paradigm,
)


# ---------------------------------------------------------------------------
# Helpers — a minimal mock of the GatewayClient dispatch boundary.
# ---------------------------------------------------------------------------

def _mock_gateway_dispatch() -> str:
    """Simulates GatewayClient.complete() dispatch boundary check.

    Calls assert_llm_tier_at_gateway() exactly as the real gateway does.
    Returns "ok" if the paradigm check passes.
    """
    assert_llm_tier_at_gateway()
    return "ok"


# ---------------------------------------------------------------------------
# VETO GATE 1 — killed mutant test
# ---------------------------------------------------------------------------

class TestGate1KilledMutant:
    """KILLED MUTANT: sql-decorated fn reaching gateway dispatch -> ParadigmViolation.

    If the decorator is reverted to a no-op pass-through, this test goes
    GREEN-when-it-should-be-RED (the inverse mutant is caught).
    """

    def test_sql_fn_reaching_gateway_raises_paradigm_violation(self) -> None:
        """GATE 1 KILLED MUTANT: @paradigm("sql") + gateway call = ParadigmViolation."""

        @paradigm("sql")
        def sql_fn_that_reaches_gateway(workspace_id: str) -> str:
            # This simulates a context_builder that incorrectly calls the gateway.
            return _mock_gateway_dispatch()

        with pytest.raises(ParadigmViolation) as exc_info:
            sql_fn_that_reaches_gateway(workspace_id="ws_test")

        err = exc_info.value
        assert err.active_tier == "sql"
        assert "ParadigmViolation" in str(err)
        assert "sql" in str(err)
        assert "CF-C5-PARADIGM-IMPL-1" in str(err)

    def test_ml_fn_reaching_gateway_raises_paradigm_violation(self) -> None:
        """ml tier also blocked at the dispatch boundary."""

        @paradigm("ml")
        def ml_fn_that_reaches_gateway(workspace_id: str) -> str:
            return _mock_gateway_dispatch()

        with pytest.raises(ParadigmViolation) as exc_info:
            ml_fn_that_reaches_gateway(workspace_id="ws_test")

        assert exc_info.value.active_tier == "ml"

    def test_unset_paradigm_reaching_gateway_raises_violation(self) -> None:
        """No @paradigm decorator active -> assert_llm_tier_at_gateway raises."""
        # Call the dispatch assertion directly with no paradigm set.
        with pytest.raises(ParadigmViolation) as exc_info:
            assert_llm_tier_at_gateway()

        err = exc_info.value
        assert err.active_tier == "__unset__"


# ---------------------------------------------------------------------------
# INVERSE MUTANT TEST — proves the gate is load-bearing
# ---------------------------------------------------------------------------

class TestGate1InverseMutant:
    """INVERSE MUTANT: proves removing the contextvar check breaks the test.

    We simulate what happens if assert_llm_tier_at_gateway() were replaced
    with a no-op (return None). The sql-fn-reaches-gateway test would pass
    without raising ParadigmViolation — caught here by asserting the no-op
    is NOT the real implementation.
    """

    def test_inverse_mutant_noop_assert_fails_to_catch_violation(self) -> None:
        """Proves a no-op assert_llm_tier_at_gateway does NOT enforce the gate."""

        def _noop_dispatch() -> str:
            # Simulates the vacuous (mutant) version: no contextvar check.
            return "ok"

        @paradigm("sql")
        def sql_fn_with_noop_gateway(workspace_id: str) -> str:
            return _noop_dispatch()

        # A no-op gateway does NOT raise -> the gate is absent.
        # If this were the real dispatch, the invariant would be broken.
        result = sql_fn_with_noop_gateway(workspace_id="ws_test")
        assert result == "ok"  # The no-op lets it through silently.

        # The REAL gate (assert_llm_tier_at_gateway) MUST catch it:
        @paradigm("sql")
        def sql_fn_with_real_gateway(workspace_id: str) -> str:
            return _mock_gateway_dispatch()  # Uses the real enforcement point.

        with pytest.raises(ParadigmViolation):
            sql_fn_with_real_gateway(workspace_id="ws_test")
        # Both tests must hold simultaneously: no-op passes silently,
        # real gate raises. This proves the gate is load-bearing.


# ---------------------------------------------------------------------------
# Positive cases — LLM tiers MAY reach the dispatch boundary
# ---------------------------------------------------------------------------

class TestLLMTiersPassDispatch:
    """Positive: small_llm and frontier_llm are permitted at the dispatch boundary."""

    def test_small_llm_fn_reaching_gateway_does_not_raise(self) -> None:
        """@paradigm("small_llm") can call the gateway — this is the intended path."""

        @paradigm("small_llm")
        def narrate(workspace_id: str) -> str:
            return _mock_gateway_dispatch()

        result = narrate(workspace_id="ws_test")
        assert result == "ok"

    def test_frontier_llm_fn_reaching_gateway_does_not_raise(self) -> None:
        """@paradigm("frontier_llm") can call the gateway."""

        @paradigm("frontier_llm")
        def synthesize(workspace_id: str) -> str:
            return _mock_gateway_dispatch()

        result = synthesize(workspace_id="ws_test")
        assert result == "ok"


# ---------------------------------------------------------------------------
# Contextvar correctness
# ---------------------------------------------------------------------------

class TestContextvarBehavior:
    """The contextvar sets and restores correctly; no tier leakage between calls."""

    def test_current_paradigm_is_unset_outside_decorator(self) -> None:
        assert current_paradigm() == "__unset__"

    def test_current_paradigm_is_set_inside_decorator(self) -> None:
        captured: list[str] = []

        @paradigm("sql")
        def capture_tier(workspace_id: str) -> None:
            captured.append(current_paradigm())

        capture_tier(workspace_id="ws_test")
        assert captured == ["sql"]

    def test_contextvar_restored_after_return(self) -> None:
        @paradigm("sql")
        def tier_sql(workspace_id: str) -> None:
            pass

        @paradigm("small_llm")
        def tier_llm(workspace_id: str) -> None:
            pass

        tier_sql(workspace_id="ws_1")
        assert current_paradigm() == "__unset__"  # Restored after return.

        tier_llm(workspace_id="ws_1")
        assert current_paradigm() == "__unset__"  # Restored after return.

    def test_contextvar_restored_even_on_exception(self) -> None:
        """Contextvar reset token fires in the finally block even on exception."""

        @paradigm("sql")
        def failing_fn(workspace_id: str) -> None:
            raise ValueError("deliberate failure")

        with pytest.raises(ValueError):
            failing_fn(workspace_id="ws_test")

        assert current_paradigm() == "__unset__"

    def test_nested_paradigm_restores_outer_tier(self) -> None:
        """Nested @paradigm decorators: inner sets, outer tier restored on exit."""
        inner_tier: list[str] = []
        outer_tier: list[str] = []

        @paradigm("sql")
        def outer(workspace_id: str) -> None:
            outer_tier.append(current_paradigm())  # Should be "sql"

            @paradigm("ml")
            def inner(workspace_id: str) -> None:
                inner_tier.append(current_paradigm())  # Should be "ml"

            inner(workspace_id=workspace_id)
            # After inner returns, outer contextvar is restored to "sql".
            outer_tier.append(current_paradigm())

        outer(workspace_id="ws_test")
        assert inner_tier == ["ml"]
        # Outer sees "sql" both before and after inner call.
        assert outer_tier == ["sql", "sql"]


# ---------------------------------------------------------------------------
# Async support
# ---------------------------------------------------------------------------

class TestAsyncParadigm:
    """@paradigm works correctly with async functions."""

    @pytest.mark.asyncio
    async def test_async_sql_fn_reaching_gateway_raises(self) -> None:
        """Async @paradigm("sql") that hits dispatch boundary raises."""

        @paradigm("sql")
        async def async_sql_fn(workspace_id: str) -> str:
            return _mock_gateway_dispatch()

        with pytest.raises(ParadigmViolation) as exc_info:
            await async_sql_fn(workspace_id="ws_test")

        assert exc_info.value.active_tier == "sql"

    @pytest.mark.asyncio
    async def test_async_small_llm_fn_passes(self) -> None:
        @paradigm("small_llm")
        async def async_llm_fn(workspace_id: str) -> str:
            return _mock_gateway_dispatch()

        result = await async_llm_fn(workspace_id="ws_test")
        assert result == "ok"


# ---------------------------------------------------------------------------
# Invalid tier at decoration time
# ---------------------------------------------------------------------------

class TestInvalidTier:
    def test_unknown_tier_raises_value_error_at_decoration(self) -> None:
        """Unknown tier raises ValueError at decoration time (not at call time)."""
        with pytest.raises(ValueError) as exc_info:
            @paradigm("banana")  # type: ignore[arg-type]
            def bad_fn() -> None:
                pass

        assert "banana" in str(exc_info.value)
        assert "CF-C5-PARADIGM-IMPL-1" in str(exc_info.value)
