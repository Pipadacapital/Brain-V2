"""
test_ratio.py — Tests for ratio_to_basis_points (M-A5-Q1).

Coverage: FLOOR rule, zero-denominator guard, INT32 range, negative ratios.
"""

import pytest

from brain_metrics.ratio import ratio_to_basis_points


class TestRatioToBasisPoints:

    def test_exact_2333_percent(self):
        # 2333/10000 = 23.33% → 2333 bp (exact)
        assert ratio_to_basis_points(2333, 10000) == 2333

    def test_one_third(self):
        # 1/3 → FLOOR(1 × 10000 / 3) = FLOOR(3333.33) = 3333
        assert ratio_to_basis_points(1, 3) == 3333

    def test_one_quarter_exact(self):
        # 1/4 = 2500 bp (exact)
        assert ratio_to_basis_points(1, 4) == 2500

    def test_floor_not_round(self):
        # 1/3 = 3333.33 → FLOOR = 3333, NOT 3334
        result = ratio_to_basis_points(1, 3)
        assert result == 3333
        # Confirm it's not rounded
        assert result != 3334

    def test_100_percent(self):
        # 100% → 10000 bp
        assert ratio_to_basis_points(1, 1) == 10000

    def test_zero_ratio(self):
        # 0/1 = 0
        assert ratio_to_basis_points(0, 1) == 0

    def test_zero_numerator(self):
        assert ratio_to_basis_points(0, 100) == 0


class TestRatioZeroDenominator:

    def test_zero_denominator_throws(self):
        with pytest.raises(ZeroDivisionError, match="denominator must be non-zero"):
            ratio_to_basis_points(1, 0)

    def test_zero_denominator_zero_numerator_still_throws(self):
        with pytest.raises(ZeroDivisionError):
            ratio_to_basis_points(0, 0)


class TestRatioNegative:

    def test_negative_numerator_floor(self):
        # -1/3 → FLOOR(-1 × 10000 / 3) = FLOOR(-3333.33) = -3334
        result = ratio_to_basis_points(-1, 3)
        assert result == -3334  # floor, not truncate

    def test_negative_ratio_symmetry(self):
        pos = ratio_to_basis_points(1, 4)
        neg = ratio_to_basis_points(-1, 4)
        assert pos == 2500
        assert neg == -2500  # exact, no floor issue

    def test_negative_exact(self):
        assert ratio_to_basis_points(-3, 4) == -7500


class TestRatioInt32Range:

    def test_large_numerator_throws_overflow(self):
        # Very large ratio → throws OverflowError (matches TS RangeError behavior).
        # F4 fix: both TS and Python throw on INT32 overflow (fail-loud, no silent clamp).
        with pytest.raises(OverflowError):
            ratio_to_basis_points(10_000_000, 1)

    def test_small_negative_throws_overflow(self):
        # Very large negative ratio → throws OverflowError.
        with pytest.raises(OverflowError):
            ratio_to_basis_points(-10_000_000, 1)

    def test_within_int32_max_passes(self):
        # INT32_MAX / 10000 = 214748 (rounded). Any ratio below that does not overflow.
        result = ratio_to_basis_points(2_147_483_647, 10_000)
        assert result <= 2_147_483_647

    def test_within_int32_min_passes(self):
        result = ratio_to_basis_points(-2_147_483_648, 10_000)
        assert result >= -2_147_483_648
