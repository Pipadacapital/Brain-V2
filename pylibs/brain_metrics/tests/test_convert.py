"""
test_convert.py — Tests for decimal_to_minor_units (CF-C2-STRING-API-1 CRITICAL).

Coverage target: ALL positive AND negative scenarios per §10 of the plan.
- The 6 banker's-rounding ties (positive)
- 6 negative variants (CF-C2-NEG-VECTORS-1)
- Sub-paise 4-decimal truncation (M-A5-Q2)
- Zero inputs
- BIGINT overflow boundary
- Multi-currency subunit
- Non-string rejection (CRITICAL runtime guard)
- The divergence-proving probe (CF-C2-FIXTURE-PROOF-1)
"""

import math
import pytest
from decimal import Decimal, ROUND_HALF_EVEN

from brain_metrics.convert import decimal_to_minor_units


# ---------------------------------------------------------------------------
# Helper: the legacy Number(str)*100 + Math.round path (ROUND_HALF_UP)
# Used exclusively in the divergence-probe test to prove the paths diverge.
# ---------------------------------------------------------------------------
def _number_path_math_round(s: str, mult: int) -> int:
    """Simulate the legacy float multiply + Math.round (ROUND_HALF_UP) path."""
    v = float(s) * mult
    return math.floor(v + 0.5)


# ---------------------------------------------------------------------------
# 1. The 6 canonical banker's-rounding ties (§10 unit test vectors)
# ---------------------------------------------------------------------------

class TestBankersRoundingTies:
    """6 canonical ROUND_HALF_EVEN tie cases. All must pass on the string path."""

    def test_tie_1_even_floor_stays(self):
        # "1234.565" × 100 = 123456.5 → floor=123456 (EVEN) → stay = 123456
        assert decimal_to_minor_units("1234.565", 100) == 123456

    def test_tie_2_odd_floor_rounds_up(self):
        # "1234.575" × 100 = 123457.5 → floor=123457 (ODD) → up = 123458
        assert decimal_to_minor_units("1234.575", 100) == 123458

    def test_tie_3_zero_even_stays(self):
        # "0.005" × 100 = 0.5 → floor=0 (EVEN) → stay = 0
        assert decimal_to_minor_units("0.005", 100) == 0

    def test_tie_4_one_odd_rounds_up(self):
        # "0.015" × 100 = 1.5 → floor=1 (ODD) → up = 2
        assert decimal_to_minor_units("0.015", 100) == 2

    def test_tie_5_large_odd_rounds_up(self):
        # "999.995" × 100 = 99999.5 → floor=99999 (ODD) → up = 100000
        assert decimal_to_minor_units("999.995", 100) == 100000

    def test_tie_6_two_even_stays(self):
        # "0.025" × 100 = 2.5 → floor=2 (EVEN) → stay = 2
        assert decimal_to_minor_units("0.025", 100) == 2


# ---------------------------------------------------------------------------
# 2. Negative variants (CF-C2-NEG-VECTORS-1)
#    shopify_refund_line_items.subtotal_amount is negative for refunds.
# ---------------------------------------------------------------------------

class TestNegativeVariants:
    """Negative variants of the 6 canonical ties. ROUND_HALF_EVEN is sign-symmetric."""

    def test_neg_tie_1(self):
        # -1234.565 × 100 → -123456
        assert decimal_to_minor_units("-1234.565", 100) == -123456

    def test_neg_tie_2(self):
        # -1234.575 × 100 → -123458
        assert decimal_to_minor_units("-1234.575", 100) == -123458

    def test_neg_tie_3_zero(self):
        # -0.005 × 100 = -0.5 → ROUND_HALF_EVEN: nearest even = 0 (even)
        # Negative zero is zero.
        assert decimal_to_minor_units("-0.005", 100) == 0

    def test_neg_tie_4(self):
        # -0.015 × 100 → -2
        assert decimal_to_minor_units("-0.015", 100) == -2

    def test_neg_tie_5(self):
        # -999.995 × 100 → -100000
        assert decimal_to_minor_units("-999.995", 100) == -100000

    def test_neg_tie_6(self):
        # -0.025 × 100 → -2
        assert decimal_to_minor_units("-0.025", 100) == -2

    def test_neg_sub_paise(self):
        # Negative sub-paise: -1234.5678 × 100 → -123457
        assert decimal_to_minor_units("-1234.5678", 100) == -123457

    def test_negative_large(self):
        # Large negative refund
        assert decimal_to_minor_units("-50000.00", 100) == -5000000


# ---------------------------------------------------------------------------
# 3. Sub-paise truncation / 4-decimal sources (M-A5-Q2)
#    meta_ads_daily_metrics.spend Decimal(12,4)
#    google_ads_daily_metrics.spend Decimal(12,4)
#    ShopifyProduct.coq Decimal(12,4)
# ---------------------------------------------------------------------------

class TestSubPaise:
    """4-decimal Decimal(12,4) sources — sub-paise discarded at the boundary."""

    def test_sub_paise_round_up(self):
        # 1234.5678 × 100: subunit part = "56", remainder "78" > "50" → round up
        assert decimal_to_minor_units("1234.5678", 100) == 123457

    def test_sub_paise_all_nines(self):
        # 999.9999 × 100: subunit part = "99", remainder "99" > "50" → round up
        assert decimal_to_minor_units("999.9999", 100) == 100000

    def test_sub_paise_round_down(self):
        # 1.0001 × 100: subunit part = "00", remainder "01" < "50" → stay = 100
        assert decimal_to_minor_units("1.0001", 100) == 100

    def test_sub_paise_tie_even(self):
        # 1234.5650 × 100 = 123456.50 → floor=123456 EVEN → stay
        assert decimal_to_minor_units("1234.5650", 100) == 123456

    def test_sub_paise_tie_odd(self):
        # 1234.5750 × 100 = 123457.50 → floor=123457 ODD → up
        assert decimal_to_minor_units("1234.5750", 100) == 123458


# ---------------------------------------------------------------------------
# 4. Zero inputs
# ---------------------------------------------------------------------------

class TestZero:
    def test_zero_two_dp(self):
        assert decimal_to_minor_units("0.00", 100) == 0

    def test_zero_three_dp(self):
        assert decimal_to_minor_units("0.000", 100) == 0

    def test_zero_no_dp(self):
        assert decimal_to_minor_units("0", 100) == 0

    def test_zero_jpy(self):
        assert decimal_to_minor_units("0.00", 1) == 0


# ---------------------------------------------------------------------------
# 5. BIGINT overflow boundary
# ---------------------------------------------------------------------------

class TestBigIntBoundary:
    """Assert no silent wrap at BIGINT/Int64 boundaries."""

    def test_large_gmv_no_overflow(self):
        # 92233720368547757.00 × 100 = 9223372036854775700 < INT64_MAX (9223372036854775807)
        result = decimal_to_minor_units("92233720368547757.00", 100)
        assert result == 9223372036854775700
        assert result < 9223372036854775807  # INT64_MAX

    def test_one_crore_exact(self):
        # ₹1,00,00,000 = 10,000,000 rupees = 1,000,000,000 paise
        assert decimal_to_minor_units("10000000.00", 100) == 1_000_000_000

    def test_zero_denominator_boundary(self):
        # Zero paise
        assert decimal_to_minor_units("0.00", 100) == 0


# ---------------------------------------------------------------------------
# 6. Multi-currency subunit (CF-C2-SUBUNIT-1)
# ---------------------------------------------------------------------------

class TestMultiCurrencySubunit:
    """Same input string → different minor units per subunit_multiplier."""

    def test_inr_100(self):
        # 1.255 × 100 = 125.5 → floor=125 ODD → up = 126
        assert decimal_to_minor_units("1.255", 100) == 126

    def test_kwd_1000(self):
        # 1.255 × 1000 = 1255.0 → exact, no rounding needed
        assert decimal_to_minor_units("1.255", 1000) == 1255

    def test_jpy_1(self):
        # 1234.565 × 1 = 1234.565 → remainder=565 > 500 → round up to 1235
        assert decimal_to_minor_units("1234.565", 1) == 1235

    def test_aed_100_same_as_inr(self):
        # AED subunit same as INR (both ×100)
        assert decimal_to_minor_units("5.005", 100) == 500

    def test_same_amount_different_multipliers_diverge(self):
        # Proves subunit_multiplier matters — same string, different result
        inr_result = decimal_to_minor_units("1.255", 100)
        kwd_result = decimal_to_minor_units("1.255", 1000)
        assert inr_result != kwd_result
        assert inr_result == 126
        assert kwd_result == 1255


# ---------------------------------------------------------------------------
# 7. Non-string rejection (CF-C2-STRING-API-1 runtime guard)
# ---------------------------------------------------------------------------

class TestNonStringRejection:
    """CF-C2-STRING-API-1: the runtime guard must throw TypeError for non-str input."""

    def test_rejects_float(self):
        with pytest.raises(TypeError, match="must be a str"):
            decimal_to_minor_units(1234.565, 100)  # type: ignore[arg-type]

    def test_rejects_int(self):
        with pytest.raises(TypeError, match="must be a str"):
            decimal_to_minor_units(1234, 100)  # type: ignore[arg-type]

    def test_rejects_none(self):
        with pytest.raises(TypeError, match="must be a str"):
            decimal_to_minor_units(None, 100)  # type: ignore[arg-type]

    def test_rejects_decimal_type(self):
        with pytest.raises(TypeError, match="must be a str"):
            decimal_to_minor_units(Decimal("1234.565"), 100)  # type: ignore[arg-type]

    def test_accepts_string(self):
        # Positive: string IS accepted
        result = decimal_to_minor_units("1234.56", 100)
        assert result == 123456

    def test_error_message_mentions_cf_api(self):
        """The error message must reference CF-C2-STRING-API-1 to guide the developer."""
        with pytest.raises(TypeError) as exc_info:
            decimal_to_minor_units(1234.565, 100)  # type: ignore[arg-type]
        assert "CF-C2-STRING-API-1" in str(exc_info.value)


# ---------------------------------------------------------------------------
# 8. Divergence-proving probe (CF-C2-FIXTURE-PROOF-1) — CRITICAL
#
# This is the most important test. It PROVES that the string path and the
# Number()*Math.round path DIVERGE for "1234.565" × 100.
#
# A green CI without this test does NOT discharge CF-C2-STRING-API-1.
# Tanvi's Stage-5 gate verifies this test exists and passes.
# ---------------------------------------------------------------------------

class TestDivergenceProbe:
    """CF-C2-FIXTURE-PROOF-1: string path correct, Number()*Math.round wrong.

    The test runs BOTH paths and asserts:
      - string path == 123456 (ROUND_HALF_EVEN: 56 is even → stay)
      - number path == 123457 (Math.round: 0.5 rounds up → wrong)
      - They DIFFER

    Bit-pattern argument:
      Decimal('1234.565') * 100 = Decimal('123456.5') exactly.
      float('1234.565') * 100 = 123456.5 in IEEE-754 double
        (1234565/10 = 123456.5 = 247213/2; has finite binary expansion).
      ROUND_HALF_EVEN(123456.5): floor=123456 is EVEN → stay at 123456.
      Math.round(123456.5) = 123457 (ties round to +infinity in JS / floor+0.5).
      Delta = 1 paise per occurrence of this value.
    """

    PROBE_AMOUNT = "1234.565"
    PROBE_MULT = 100
    EXPECTED_STRING_PATH = 123456
    EXPECTED_NUMBER_PATH = 123457  # WRONG — this is what Number()*Math.round gives

    def test_string_path_is_correct(self):
        """The string path gives the CORRECT result (banker's rounding)."""
        result = decimal_to_minor_units(self.PROBE_AMOUNT, self.PROBE_MULT)
        assert result == self.EXPECTED_STRING_PATH, (
            f"String path should give {self.EXPECTED_STRING_PATH} (ROUND_HALF_EVEN), "
            f"got {result}"
        )

    def test_number_path_gives_wrong_result(self):
        """The Number()*Math.round path gives a DIFFERENT (wrong) result."""
        number_result = _number_path_math_round(self.PROBE_AMOUNT, self.PROBE_MULT)
        assert number_result == self.EXPECTED_NUMBER_PATH, (
            f"Number()*Math.round should give {self.EXPECTED_NUMBER_PATH} (ROUND_HALF_UP), "
            f"got {number_result}"
        )

    def test_paths_diverge(self):
        """The two paths MUST disagree — this is the proof that the CRITICAL is caught."""
        string_result = decimal_to_minor_units(self.PROBE_AMOUNT, self.PROBE_MULT)
        number_result = _number_path_math_round(self.PROBE_AMOUNT, self.PROBE_MULT)
        assert string_result != number_result, (
            f"String path and Number path must DIVERGE for '{self.PROBE_AMOUNT}' × {self.PROBE_MULT}. "
            f"Both gave {string_result}. This means the bug is NOT caught! "
            f"CF-C2-FIXTURE-PROOF-1 FAILED."
        )

    def test_delta_is_exactly_one_paise(self):
        """The delta is exactly 1 paise — a silent 1-paise error per occurrence."""
        string_result = decimal_to_minor_units(self.PROBE_AMOUNT, self.PROBE_MULT)
        number_result = _number_path_math_round(self.PROBE_AMOUNT, self.PROBE_MULT)
        assert abs(number_result - string_result) == 1

    def test_second_divergence_probe(self):
        """Second probe: '0.025' × 100. String=2 (ROUND_HALF_EVEN: 2 even→stay), Number=3."""
        string_result = decimal_to_minor_units("0.025", 100)
        number_result = _number_path_math_round("0.025", 100)
        assert string_result == 2
        assert number_result == 3
        assert string_result != number_result

    def test_third_divergence_probe_4decimal(self):
        """Third probe from Decimal(12,4) ad-spend range: '5.0050' × 100.
        String=500 (ROUND_HALF_EVEN: 500 even→stay), Number=501 (Math.round up).
        """
        string_result = decimal_to_minor_units("5.0050", 100)
        number_result = _number_path_math_round("5.0050", 100)
        assert string_result == 500
        assert number_result == 501
        assert string_result != number_result


# ---------------------------------------------------------------------------
# 9. Integer inputs without decimal point
# ---------------------------------------------------------------------------

class TestIntegerInputs:
    def test_integer_string_no_decimal(self):
        assert decimal_to_minor_units("1234", 100) == 123400

    def test_integer_string_jpy(self):
        assert decimal_to_minor_units("1234", 1) == 1234
