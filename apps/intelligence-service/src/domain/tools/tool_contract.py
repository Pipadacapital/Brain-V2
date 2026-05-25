"""
tool_contract.py — WriteToolCall contract (VETO Gate 3, Iron-Law executor).

CF-C5-INJECTION-EXECUTOR-2 (CRITICAL): the LLM is ALLOWED to emit only:
  - tool: a typed enum of known write-tool names (closed set)
  - entity_id: a typed/known entity reference (not free text)
  - intent: a closed enum (PAUSE | INCREASE | DECREASE — never a number)

The schema MUST NOT accept a magnitude field. Any attempt to inject
{amount_mu: 9999999} in the LLM's tool-call JSON is silently DROPPED by
Pydantic (extra="ignore" policy). The executor reads magnitude server-side
from ai.workspace_action_cap — the LLM NEVER sets the magnitude.

This is the structural form of "untrusted text never chooses the magnitude".
A comparison-style gate (LLM proposes, server rejects if > cap) is explicitly
rejected (see §16 alternatives): a probe-able logic surface. The Iron-Law
approach is structurally un-bypassable.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict


class WriteToolNameEnum(str, Enum):
    """Closed set of write tools available in the Brain AI engine.

    5a vertical: no write tools are in scope (pnl agent is READ-ONLY).
    These are defined now so graduation never opens an undefended path.
    """

    PAUSE_AD_SET = "pause_ad_set"
    REALLOCATE_BUDGET = "reallocate_budget"
    SEND_REFUND = "send_refund"


class IntentEnum(str, Enum):
    """Closed intent enum — the ONLY magnitude-related information the LLM emits.

    PAUSE: stop the action (no amount involved).
    INCREASE: increase by server-defined magnitude from ai.workspace_action_cap.
    DECREASE: decrease by server-defined magnitude from ai.workspace_action_cap.

    The LLM NEVER emits a raw number. The magnitude is resolved server-side
    from the workspace cap record at execution time.
    """

    PAUSE = "PAUSE"
    INCREASE = "INCREASE"
    DECREASE = "DECREASE"


class WriteToolCall(BaseModel):
    """What the LLM is ALLOWED to emit in a write-tool call.

    NO magnitude field. The schema intentionally has no amount, price,
    budget, or any numeric magnitude field. Pydantic model_config extra="ignore"
    silently drops any extra fields (including injected amount_mu, budget_mu etc.).

    This is the Iron-Law: the LLM physically CANNOT set a magnitude.
    CF-C5-INJECTION-EXECUTOR-2: killed-mutant proof in test_executor.py.
    """

    model_config = ConfigDict(
        extra="ignore",  # SILENTLY DROP any extra field (injected amount_mu etc.)
        frozen=True,
    )

    tool: WriteToolNameEnum
    entity_id: str  # typed/known-set entity ref (ad set ID, campaign ID, etc.)
    intent: IntentEnum
    # NO magnitude field. CF-C5-INJECTION-EXECUTOR-2.
