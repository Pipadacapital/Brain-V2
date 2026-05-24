"""
test_money.py — Tests for the Money value object (CF-C2-PRIMITIVE-1).
"""

import pytest
from brain_metrics.money import Money, make_money


class TestMoneyValueObject:

    def test_make_money_inr(self):
        m = make_money(123456, "INR")
        assert m.minor_units == 123456
        assert m.currency_code == "INR"
        assert m.subunit_multiplier == 100

    def test_make_money_kwd(self):
        m = make_money(1255, "KWD")
        assert m.minor_units == 1255
        assert m.currency_code == "KWD"
        assert m.subunit_multiplier == 1000

    def test_make_money_jpy(self):
        m = make_money(1235, "JPY")
        assert m.minor_units == 1235
        assert m.currency_code == "JPY"
        assert m.subunit_multiplier == 1

    def test_money_is_frozen(self):
        m = make_money(100, "INR")
        with pytest.raises(Exception):
            m.minor_units = 200  # type: ignore[misc]

    def test_money_equality(self):
        m1 = make_money(100, "INR")
        m2 = make_money(100, "INR")
        assert m1 == m2

    def test_money_inequality_different_units(self):
        m1 = make_money(100, "INR")
        m2 = make_money(200, "INR")
        assert m1 != m2

    def test_money_negative_minor_units(self):
        # Refunds → negative minor units
        m = make_money(-123456, "INR")
        assert m.minor_units == -123456

    def test_currency_code_uppercased(self):
        m = make_money(100, "inr")
        assert m.currency_code == "INR"

    def test_direct_dataclass_construction(self):
        m = Money(minor_units=500, currency_code="AED", subunit_multiplier=100)
        assert m.minor_units == 500
        assert m.subunit_multiplier == 100
