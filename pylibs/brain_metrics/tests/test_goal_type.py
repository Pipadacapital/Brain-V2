"""
test_goal_type.py — Tests for GoalType enum (resolves Child-0 A1 #8).
"""

from brain_metrics.goal_type import GoalType


class TestGoalType:

    def test_money_value(self):
        assert GoalType.MONEY.value == "money"

    def test_ratio_value(self):
        assert GoalType.RATIO.value == "ratio"

    def test_str_mixin(self):
        # GoalType is StrEnum; str() produces "money" / "ratio"
        assert str(GoalType.MONEY) == "money"
        assert str(GoalType.RATIO) == "ratio"

    def test_from_string(self):
        assert GoalType("money") == GoalType.MONEY
        assert GoalType("ratio") == GoalType.RATIO

    def test_ts_parity_values(self):
        # Byte-identity pair: values must match TS GoalType = 'money' | 'ratio'
        assert GoalType.MONEY == "money"
        assert GoalType.RATIO == "ratio"
