"""
test_subunits.py — Tests for subunit_multiplier lookup (CF-C2-SUBUNIT-1).
"""

import pytest
from brain_metrics.subunits import subunit_multiplier


class TestSubunitMultiplier:

    def test_inr_100(self):
        assert subunit_multiplier("INR") == 100

    def test_aed_100(self):
        assert subunit_multiplier("AED") == 100

    def test_sar_100(self):
        assert subunit_multiplier("SAR") == 100

    def test_usd_100(self):
        assert subunit_multiplier("USD") == 100

    def test_eur_100(self):
        assert subunit_multiplier("EUR") == 100

    def test_kwd_1000(self):
        assert subunit_multiplier("KWD") == 1000

    def test_bhd_1000(self):
        assert subunit_multiplier("BHD") == 1000

    def test_jpy_1(self):
        assert subunit_multiplier("JPY") == 1

    def test_unknown_defaults_100(self):
        # Unknown currency → default 100
        assert subunit_multiplier("XYZ") == 100

    def test_lowercase_normalized(self):
        # Input is normalized to uppercase
        assert subunit_multiplier("inr") == 100
        assert subunit_multiplier("kwd") == 1000
        assert subunit_multiplier("jpy") == 1

    def test_mixed_case(self):
        assert subunit_multiplier("Inr") == 100
