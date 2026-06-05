"""
Per-(workspace, vendor) circuit breaker for the transform-graduation worker.

@paradigm: sql
  Pure in-process state machine — no ML, no LLM, no I/O.

P1-B (data-warehouse-implementation-plan.md §B7 Task 5):
  R11 — noisy-neighbour isolation.  A flash-sale tenant or a broken mapper
  must not block every other tenant.

  Circuit state per (workspace_id, vendor):
    CLOSED   — normal; events are processed.
    OPEN     — K consecutive terminal failures; new events route to DLQ,
               cursor still advances, other tenants unaffected.
    HALF_OPEN — after RECOVERY_SECONDS, one probe attempt is allowed.

  Metrics (Amendment 3 / B7 Task 5):
    transform_circuit_open{workspace_id,vendor} — set to 1 on OPEN, 0 on CLOSE.
    Emitted to in-process counter dict (CloudWatch wiring at Stage-8 per
    TECH/00 — NOT Prometheus).

  Fail-closed on PG cursor-table unavailability (Amendment 3):
    The transform consumer checks cursor-table health before each tick.  If the
    cursor table is unreachable, the consumer STALLS and logs an ERROR — it does
    NOT silently advance or skip rows (no silent gap).

  Thread / coroutine safety:
    The breaker is designed for single-threaded asyncio — no locking needed.
    One breaker instance is shared across all workspaces in one consumer loop.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, Optional, Tuple

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration constants
# ---------------------------------------------------------------------------

#: Number of consecutive terminal failures before opening the circuit.
DEFAULT_FAILURE_THRESHOLD: int = 5

#: Seconds before a HALF_OPEN probe attempt is allowed.
DEFAULT_RECOVERY_SECONDS: float = 60.0

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------


class CircuitState(str, Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


@dataclass
class BreakerCell:
    """State for one (workspace_id, vendor) pair."""
    state: CircuitState = CircuitState.CLOSED
    consecutive_failures: int = 0
    opened_at: Optional[float] = None  # time.monotonic() when OPEN


# ---------------------------------------------------------------------------
# In-process metrics counters (CloudWatch wiring at Stage-8)
# ---------------------------------------------------------------------------

_CIRCUIT_COUNTERS: dict[str, int] = {}


def _circuit_metric(workspace_id: str, vendor: str, open_: bool) -> None:
    key = f"transform_circuit_open{{workspace_id={workspace_id!r},vendor={vendor!r}}}"
    _CIRCUIT_COUNTERS[key] = 1 if open_ else 0
    logger.info(
        "circuit_breaker: metric %s=%d", key, _CIRCUIT_COUNTERS[key]
    )


def get_circuit_counters() -> dict[str, int]:
    """Return a snapshot of circuit breaker metric counters (test / monitoring hook)."""
    return dict(_CIRCUIT_COUNTERS)


# ---------------------------------------------------------------------------
# CircuitBreaker
# ---------------------------------------------------------------------------


class CircuitBreaker:
    """
    Per-(workspace_id, vendor) circuit breaker.

    Usage:
        cb = CircuitBreaker()

        # Before processing:
        if cb.is_open(ws, vendor):
            # Route to DLQ; advance cursor; skip this event.
            return

        # After terminal failure:
        cb.record_failure(ws, vendor)

        # After success:
        cb.record_success(ws, vendor)
    """

    def __init__(
        self,
        failure_threshold: int = DEFAULT_FAILURE_THRESHOLD,
        recovery_seconds: float = DEFAULT_RECOVERY_SECONDS,
    ) -> None:
        self._threshold = failure_threshold
        self._recovery = recovery_seconds
        self._cells: dict[tuple[str, str], BreakerCell] = {}

    def _cell(self, workspace_id: str, vendor: str) -> BreakerCell:
        key = (workspace_id, vendor)
        if key not in self._cells:
            self._cells[key] = BreakerCell()
        return self._cells[key]

    def is_open(self, workspace_id: str, vendor: str) -> bool:
        """
        Return True if the circuit is OPEN (events should be DLQ-routed).

        Also transitions OPEN → HALF_OPEN after recovery_seconds, allowing
        one probe attempt.
        """
        cell = self._cell(workspace_id, vendor)
        if cell.state == CircuitState.CLOSED:
            return False
        if cell.state == CircuitState.HALF_OPEN:
            return False  # Allow one probe

        # OPEN — check if recovery period has elapsed
        assert cell.opened_at is not None
        if time.monotonic() - cell.opened_at >= self._recovery:
            cell.state = CircuitState.HALF_OPEN
            logger.info(
                "circuit_breaker: HALF_OPEN workspace_id=%r vendor=%r "
                "(recovery_seconds=%.0f elapsed)",
                workspace_id, vendor, self._recovery,
            )
            return False  # Allow one probe

        return True  # Still OPEN

    def record_failure(self, workspace_id: str, vendor: str) -> None:
        """Record a terminal failure for (workspace_id, vendor)."""
        cell = self._cell(workspace_id, vendor)

        if cell.state == CircuitState.HALF_OPEN:
            # Probe failed — re-open
            cell.state = CircuitState.OPEN
            cell.opened_at = time.monotonic()
            _circuit_metric(workspace_id, vendor, open_=True)
            logger.error(
                "circuit_breaker: OPEN (probe failed) workspace_id=%r vendor=%r",
                workspace_id, vendor,
            )
            return

        cell.consecutive_failures += 1
        if cell.consecutive_failures >= self._threshold:
            cell.state = CircuitState.OPEN
            cell.opened_at = time.monotonic()
            _circuit_metric(workspace_id, vendor, open_=True)
            logger.error(
                "circuit_breaker: OPEN after %d consecutive failures "
                "workspace_id=%r vendor=%r",
                cell.consecutive_failures, workspace_id, vendor,
            )

    def record_success(self, workspace_id: str, vendor: str) -> None:
        """Record a successful processing (closes an open circuit)."""
        cell = self._cell(workspace_id, vendor)
        if cell.state != CircuitState.CLOSED:
            logger.info(
                "circuit_breaker: CLOSED workspace_id=%r vendor=%r",
                workspace_id, vendor,
            )
            _circuit_metric(workspace_id, vendor, open_=False)
        cell.state = CircuitState.CLOSED
        cell.consecutive_failures = 0
        cell.opened_at = None

    def state_for(self, workspace_id: str, vendor: str) -> CircuitState:
        """Return the current CircuitState (for tests / introspection)."""
        return self._cell(workspace_id, vendor).state

    def failure_count(self, workspace_id: str, vendor: str) -> int:
        """Return consecutive failure count (for tests)."""
        return self._cell(workspace_id, vendor).consecutive_failures
