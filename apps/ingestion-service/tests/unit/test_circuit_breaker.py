"""
Unit tests for domain/transform/circuit_breaker.py (P1-B Task 5 / Amendment 3).

Covers:
  POSITIVE:
    - Fresh breaker is CLOSED for any (workspace, vendor).
    - record_success keeps breaker CLOSED.
    - record_failure below threshold keeps CLOSED + increments counter.
    - K consecutive failures → OPEN.
    - OPEN breaker is_open() returns True.
    - After recovery period, is_open() transitions to HALF_OPEN and returns False.
    - Successful probe from HALF_OPEN → CLOSED.

  NEGATIVE:
    - Failed probe from HALF_OPEN → re-OPEN.
    - record_success on OPEN breaker → CLOSED (immediate recovery on success).
    - is_open for (ws-A, v-A) does not affect (ws-B, v-B) (per-tenant isolation).
    - Metrics emitted on state transitions.
"""

from __future__ import annotations

import time
import pytest

from src.domain.transform.circuit_breaker import (
    CircuitBreaker,
    CircuitState,
    get_circuit_counters,
)


@pytest.fixture()
def breaker() -> CircuitBreaker:
    """Fresh circuit breaker with threshold=3 and recovery=1s for fast tests."""
    return CircuitBreaker(failure_threshold=3, recovery_seconds=1.0)


# ---------------------------------------------------------------------------
# POSITIVE
# ---------------------------------------------------------------------------

class TestCircuitBreakerPositive:
    def test_fresh_is_closed(self, breaker: CircuitBreaker) -> None:
        assert not breaker.is_open("ws-1", "SHOPIFY")
        assert breaker.state_for("ws-1", "SHOPIFY") == CircuitState.CLOSED

    def test_record_success_stays_closed(self, breaker: CircuitBreaker) -> None:
        breaker.record_success("ws-1", "SHOPIFY")
        assert breaker.state_for("ws-1", "SHOPIFY") == CircuitState.CLOSED

    def test_single_failure_below_threshold(self, breaker: CircuitBreaker) -> None:
        breaker.record_failure("ws-1", "SHOPIFY")
        assert breaker.state_for("ws-1", "SHOPIFY") == CircuitState.CLOSED
        assert breaker.failure_count("ws-1", "SHOPIFY") == 1
        assert not breaker.is_open("ws-1", "SHOPIFY")

    def test_k_failures_opens_circuit(self, breaker: CircuitBreaker) -> None:
        """K consecutive terminal failures → OPEN."""
        for _ in range(3):
            breaker.record_failure("ws-1", "SHOPIFY")
        assert breaker.state_for("ws-1", "SHOPIFY") == CircuitState.OPEN
        assert breaker.is_open("ws-1", "SHOPIFY")

    def test_open_returns_true_for_is_open(self, breaker: CircuitBreaker) -> None:
        for _ in range(3):
            breaker.record_failure("ws-1", "SHOPIFY")
        assert breaker.is_open("ws-1", "SHOPIFY") is True

    def test_recovery_transitions_to_half_open(self, breaker: CircuitBreaker) -> None:
        """After recovery_seconds, OPEN → HALF_OPEN → is_open returns False (probe allowed)."""
        for _ in range(3):
            breaker.record_failure("ws-1", "SHOPIFY")
        assert breaker.is_open("ws-1", "SHOPIFY") is True

        # Manually backdate opened_at
        cell = breaker._cell("ws-1", "SHOPIFY")
        cell.opened_at = time.monotonic() - 2.0  # 2s > recovery=1s

        assert breaker.is_open("ws-1", "SHOPIFY") is False  # HALF_OPEN → probe allowed
        assert breaker.state_for("ws-1", "SHOPIFY") == CircuitState.HALF_OPEN

    def test_successful_probe_closes_circuit(self, breaker: CircuitBreaker) -> None:
        """Success from HALF_OPEN → CLOSED."""
        for _ in range(3):
            breaker.record_failure("ws-1", "SHOPIFY")
        cell = breaker._cell("ws-1", "SHOPIFY")
        cell.opened_at = time.monotonic() - 2.0
        breaker.is_open("ws-1", "SHOPIFY")  # transition to HALF_OPEN
        breaker.record_success("ws-1", "SHOPIFY")
        assert breaker.state_for("ws-1", "SHOPIFY") == CircuitState.CLOSED
        assert breaker.failure_count("ws-1", "SHOPIFY") == 0

    def test_metrics_emitted_on_open(self, breaker: CircuitBreaker) -> None:
        """transform_circuit_open metric is set to 1 when circuit opens."""
        for _ in range(3):
            breaker.record_failure("ws-1", "SHOPIFY")
        counters = get_circuit_counters()
        # Find the metric for ws-1 / SHOPIFY
        metric_key = [k for k in counters if "ws-1" in k and "SHOPIFY" in k]
        assert metric_key, f"Expected circuit metric, got: {list(counters.keys())}"
        assert counters[metric_key[0]] == 1

    def test_metrics_emitted_on_close(self, breaker: CircuitBreaker) -> None:
        """transform_circuit_open metric is set to 0 when circuit closes."""
        for _ in range(3):
            breaker.record_failure("ws-1", "SHOPIFY")
        cell = breaker._cell("ws-1", "SHOPIFY")
        cell.opened_at = time.monotonic() - 2.0
        breaker.is_open("ws-1", "SHOPIFY")
        breaker.record_success("ws-1", "SHOPIFY")
        counters = get_circuit_counters()
        metric_key = [k for k in counters if "ws-1" in k and "SHOPIFY" in k]
        assert metric_key
        assert counters[metric_key[0]] == 0


# ---------------------------------------------------------------------------
# NEGATIVE
# ---------------------------------------------------------------------------

class TestCircuitBreakerNegative:
    def test_failed_probe_reopens_circuit(self, breaker: CircuitBreaker) -> None:
        """Failure from HALF_OPEN → re-OPEN."""
        for _ in range(3):
            breaker.record_failure("ws-1", "SHOPIFY")
        cell = breaker._cell("ws-1", "SHOPIFY")
        cell.opened_at = time.monotonic() - 2.0
        breaker.is_open("ws-1", "SHOPIFY")  # → HALF_OPEN
        breaker.record_failure("ws-1", "SHOPIFY")  # probe fails
        assert breaker.state_for("ws-1", "SHOPIFY") == CircuitState.OPEN

    def test_open_on_ws_a_does_not_affect_ws_b(self, breaker: CircuitBreaker) -> None:
        """Per-tenant isolation: circuit for ws-A does not block ws-B."""
        for _ in range(3):
            breaker.record_failure("ws-A", "SHOPIFY")
        assert breaker.is_open("ws-A", "SHOPIFY") is True
        assert breaker.is_open("ws-B", "SHOPIFY") is False
        assert breaker.state_for("ws-B", "SHOPIFY") == CircuitState.CLOSED

    def test_open_on_vendor_a_does_not_affect_vendor_b(self, breaker: CircuitBreaker) -> None:
        """Per-vendor isolation: SHOPIFY circuit open doesn't block META."""
        for _ in range(3):
            breaker.record_failure("ws-1", "SHOPIFY")
        assert breaker.is_open("ws-1", "SHOPIFY") is True
        assert breaker.is_open("ws-1", "META") is False

    def test_success_on_open_closes_immediately(self, breaker: CircuitBreaker) -> None:
        """record_success on an OPEN circuit closes it immediately."""
        for _ in range(3):
            breaker.record_failure("ws-1", "SHOPIFY")
        assert breaker.state_for("ws-1", "SHOPIFY") == CircuitState.OPEN
        breaker.record_success("ws-1", "SHOPIFY")
        assert breaker.state_for("ws-1", "SHOPIFY") == CircuitState.CLOSED

    def test_two_failures_below_threshold_stays_closed(self, breaker: CircuitBreaker) -> None:
        """threshold=3: 2 failures must not open the circuit."""
        breaker.record_failure("ws-1", "META")
        breaker.record_failure("ws-1", "META")
        assert breaker.state_for("ws-1", "META") == CircuitState.CLOSED
        assert breaker.failure_count("ws-1", "META") == 2
        assert not breaker.is_open("ws-1", "META")
