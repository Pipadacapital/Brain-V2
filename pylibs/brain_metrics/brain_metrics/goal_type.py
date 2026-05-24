"""
goal_type.py — GoalType enum (resolves Child-0 A1 #8).

@paradigm: sql (pure enum, zero LLM)
Justified: GoalType is a discriminated union for metric goal values.
'money' goals carry BIGINT minor units; 'ratio' goals carry INT32 basis
points. This split resolves the Child-0 A1 #8 ambiguity and is the
binding type-contract decision for Child 4's metric engine.

Byte-identity pair with packages/lib-metrics/src/goal-type.ts.
"""

from __future__ import annotations

from enum import StrEnum


class GoalType(StrEnum):
    """Discriminated union for metric goal value types.

    MONEY: goal value is expressed in integer minor units (BIGINT/Int64).
           e.g. a GMV target of ₹100,000 = 10_000_000 paise.
    RATIO: goal value is expressed in basis points (INT32, FLOOR ×10,000).
           e.g. a 25% RTO rate goal = 2500 bp.

    Uses StrEnum (Python 3.11+) so str(GoalType.MONEY) == "money" and
    JSON serialization produces "money" / "ratio" (matching the TS GoalType
    literal union). CF-C2-PRIMITIVE-1 byte-identity pair.
    """

    MONEY = "money"
    RATIO = "ratio"
