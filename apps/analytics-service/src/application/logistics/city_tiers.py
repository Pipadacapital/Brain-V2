"""city_tiers.py — India city tier classification (Phase-2 slice-3).

@paradigm: sql (pure data + deterministic lookup; zero LLM/ML)

Ported verbatim from legacy lib/workspace-metrics/pincode-intelligence.ts:10-41.
T1 = metro; T2 = large non-metro; T3 = everything else (the default). Used by the
pincode reliability surface to bucket destinations. Lower-cased exact-set match.
"""

from __future__ import annotations

# Ported from pincode-intelligence.ts TIER_1_CITIES (legacy:10-12).
TIER_1_CITIES: frozenset[str] = frozenset(
    {
        "mumbai", "delhi", "bangalore", "bengaluru", "hyderabad", "chennai",
        "kolkata", "pune", "ahmedabad",
    }
)

# Ported from pincode-intelligence.ts TIER_2_CITIES (legacy:13-20).
TIER_2_CITIES: frozenset[str] = frozenset(
    {
        "jaipur", "lucknow", "surat", "kanpur", "nagpur", "indore", "bhopal",
        "patna", "vadodara", "ludhiana", "agra", "nashik", "faridabad", "meerut",
        "rajkot", "varanasi", "srinagar", "aurangabad", "dhanbad", "amritsar",
        "navi mumbai", "allahabad", "ranchi", "howrah", "coimbatore", "jabalpur",
        "gwalior", "vijayawada", "jodhpur", "madurai", "raipur", "kota", "guwahati",
        "chandigarh", "solapur", "hubballi", "tiruchirappalli", "bareilly", "mysuru",
        "mysore", "tiruppur", "gurgaon", "gurugram", "noida", "thane",
    }
)


def classify_tier(city: str) -> int | None:
    """Return 1 / 2 / 3 for a city, or None if unknown/empty.

    Mirrors legacy classifyTier (pincode-intelligence.ts:35-41): T1 set, T2 set, else T3.
    """
    c = (city or "").strip().lower()
    if not c or c == "—":
        return None
    if c in TIER_1_CITIES:
        return 1
    if c in TIER_2_CITIES:
        return 2
    return 3
