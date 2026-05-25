"""
Unit tests for startup_gates.py (CF-C3-RESIDENCY-ASSERT-1 + CF-C3-WORKSPACE-ALLOWLIST-1).

@paradigm: sql

Tests:
  Residency:
  - assert_ap_south_1_residency passes for valid ap-south-1 URLs
  - assert_ap_south_1_residency raises on missing DATABASE_URL
  - assert_ap_south_1_residency raises on missing DIRECT_URL
  - assert_ap_south_1_residency raises if DATABASE_URL targets wrong region
  - assert_ap_south_1_residency raises if DIRECT_URL targets wrong region
  - named error message contains the failing URL

  Allowlist:
  - load_allowed_workspace_ids parses single UUID correctly
  - load_allowed_workspace_ids parses multiple UUIDs
  - load_allowed_workspace_ids raises on empty env
  - load_allowed_workspace_ids raises on invalid UUID in list
  - assert_workspace_allowed passes for allowed workspace
  - assert_workspace_allowed raises for disallowed workspace
  - assert_workspace_allowed raises for empty workspace_id
  - assert_workspace_allowed is case-insensitive

  run_all_gates:
  - returns allowed set when all gates pass
  - short-circuits on residency failure before parsing allowlist
"""

import pytest

from src.bootstrap.startup_gates import (
    ResidencyAssertionError,
    WorkspaceNotAllowedError,
    assert_ap_south_1_residency,
    assert_workspace_allowed,
    load_allowed_workspace_ids,
    run_all_gates,
)

_VALID_AP_DB = "postgresql://user:pass@db.ap-south-1.supabase.co:6543/postgres"
_VALID_AP_DIR = "postgresql://user:pass@db.ap-south-1.supabase.co:5432/postgres"
_NON_AP_URL = "postgresql://user:pass@db.us-east-1.supabase.co:6543/postgres"
_VALID_WID = "550e8400-e29b-41d4-a716-446655440000"
_ANOTHER_WID = "660e8400-e29b-41d4-a716-446655440001"


class TestResidencyAssert:
    def test_passes_valid_ap_south_1_urls(self):
        # No exception
        assert_ap_south_1_residency(_VALID_AP_DB, _VALID_AP_DIR)

    def test_raises_on_missing_database_url(self):
        with pytest.raises(ResidencyAssertionError, match="DATABASE_URL"):
            assert_ap_south_1_residency("", _VALID_AP_DIR)

    def test_raises_on_missing_direct_url(self):
        with pytest.raises(ResidencyAssertionError, match="DIRECT_URL"):
            assert_ap_south_1_residency(_VALID_AP_DB, "")

    def test_raises_if_database_url_wrong_region(self):
        with pytest.raises(ResidencyAssertionError, match="DATABASE_URL"):
            assert_ap_south_1_residency(_NON_AP_URL, _VALID_AP_DIR)

    def test_raises_if_direct_url_wrong_region(self):
        with pytest.raises(ResidencyAssertionError, match="DIRECT_URL"):
            assert_ap_south_1_residency(_VALID_AP_DB, _NON_AP_URL)

    def test_error_message_contains_url(self):
        with pytest.raises(ResidencyAssertionError) as exc_info:
            assert_ap_south_1_residency(_NON_AP_URL, _VALID_AP_DIR)
        assert _NON_AP_URL in str(exc_info.value)

    def test_error_says_refusing_to_start(self):
        with pytest.raises(ResidencyAssertionError, match="REFUSING TO START"):
            assert_ap_south_1_residency(_NON_AP_URL, _VALID_AP_DIR)

    def test_accepts_underscore_variant(self):
        url_underscore = "postgresql://user:pass@db.ap_south_1.example.com:5432/db"
        assert_ap_south_1_residency(url_underscore, url_underscore)


class TestAllowlist:
    def test_parses_single_uuid(self):
        ids = load_allowed_workspace_ids(_VALID_WID)
        assert _VALID_WID in ids

    def test_parses_multiple_uuids(self):
        ids = load_allowed_workspace_ids(f"{_VALID_WID},{_ANOTHER_WID}")
        assert _VALID_WID in ids
        assert _ANOTHER_WID in ids

    def test_strips_whitespace(self):
        ids = load_allowed_workspace_ids(f"  {_VALID_WID}  , {_ANOTHER_WID}  ")
        assert _VALID_WID in ids
        assert _ANOTHER_WID in ids

    def test_raises_on_empty_env(self):
        with pytest.raises(ResidencyAssertionError, match="ALLOWED_WORKSPACE_IDS"):
            load_allowed_workspace_ids("")

    def test_raises_on_invalid_uuid_in_list(self):
        with pytest.raises(ResidencyAssertionError, match="invalid UUID"):
            load_allowed_workspace_ids(f"{_VALID_WID},not-a-uuid")

    def test_assert_passes_for_allowed(self):
        allowed = frozenset({_VALID_WID})
        assert_workspace_allowed(_VALID_WID, allowed)  # no exception

    def test_assert_raises_for_disallowed(self):
        allowed = frozenset({_VALID_WID})
        with pytest.raises(WorkspaceNotAllowedError, match="not in ALLOWED_WORKSPACE_IDS"):
            assert_workspace_allowed(_ANOTHER_WID, allowed)

    def test_assert_raises_for_empty(self):
        allowed = frozenset({_VALID_WID})
        with pytest.raises(WorkspaceNotAllowedError):
            assert_workspace_allowed("", allowed)

    def test_assert_is_case_insensitive(self):
        allowed = frozenset({_VALID_WID.lower()})
        assert_workspace_allowed(_VALID_WID.upper(), allowed)  # no exception


class TestRunAllGates:
    def test_returns_allowed_set_when_all_pass(self):
        result = run_all_gates(_VALID_AP_DB, _VALID_AP_DIR, _VALID_WID)
        assert _VALID_WID in result

    def test_raises_on_residency_failure_before_allowlist(self):
        # Should raise on residency, never reach allowlist parsing
        with pytest.raises(ResidencyAssertionError, match="DATABASE_URL"):
            run_all_gates("", _VALID_AP_DIR, _VALID_WID)

    def test_raises_if_allowlist_empty_after_residency_passes(self):
        with pytest.raises(ResidencyAssertionError, match="ALLOWED_WORKSPACE_IDS"):
            run_all_gates(_VALID_AP_DB, _VALID_AP_DIR, "")
