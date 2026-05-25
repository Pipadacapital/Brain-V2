"""
test_startup_assertions.py — CF-C4-RESIDENCY-1 + CF-C4-SINGLE-WRITER-GREP-2 startup asserts.

Tests:
  1. Residency assertion: ap-south-1 host passes; non-ap-south-1 raises.
  2. Missing host raises EnvironmentError.
  3. Read-only role: ANALYTICS_POSTGRES_ROLE_CHECK=skip bypasses (for CI/test).
  4. Killed mutant (CF-C4-VERIFY-THE-VERIFIER-1): wrong region raises.

@paradigm: sql
CF-C4-RESIDENCY-1
CF-C4-SINGLE-WRITER-GREP-2
CF-C4-VERIFY-THE-VERIFIER-1
"""

from __future__ import annotations

import os
import pytest

from src.bootstrap.analytics_service_startup import (
    ClickHouseRegionMismatchError,
    PostgresWriteRoleError,
    assert_clickhouse_residency,
    assert_postgres_read_only_role,
    run_startup_assertions,
)


class TestClickHouseResidencyAssertion:
    """CF-C4-RESIDENCY-1: refuse to start if not ap-south-1."""

    def test_ap_south_1_host_passes(self) -> None:
        """A host containing 'ap-south-1' passes the residency check."""
        assert_clickhouse_residency(
            host="abc123.ap-south-1.clickhouse.cloud"
        )  # must not raise

    def test_aps1_variant_passes(self) -> None:
        """A host containing 'aps1' passes the residency check."""
        assert_clickhouse_residency(host="brain-prod.aps1.clickhouse.cloud")

    def test_ap_south_1_uppercase_passes(self) -> None:
        """Case-insensitive match: AP-SOUTH-1 in host passes."""
        assert_clickhouse_residency(host="brain.AP-SOUTH-1.clickhouse.cloud")

    def test_us_east_1_raises(self) -> None:
        """A US-east-1 host must raise ClickHouseRegionMismatchError."""
        with pytest.raises(ClickHouseRegionMismatchError, match="ap-south-1"):
            assert_clickhouse_residency(host="brain.us-east-1.clickhouse.cloud")

    def test_eu_west_1_raises(self) -> None:
        """An EU-west-1 host must raise."""
        with pytest.raises(ClickHouseRegionMismatchError):
            assert_clickhouse_residency(host="brain.eu-west-1.clickhouse.cloud")

    def test_localhost_raises(self) -> None:
        """localhost raises (no region marker)."""
        with pytest.raises(ClickHouseRegionMismatchError):
            assert_clickhouse_residency(host="localhost")

    def test_empty_host_raises_environment_error(self) -> None:
        """Empty host string raises EnvironmentError."""
        with pytest.raises(EnvironmentError, match="CLICKHOUSE_HOST"):
            assert_clickhouse_residency(host="")

    def test_none_host_falls_back_to_env_var(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """When host=None, the function reads CLICKHOUSE_HOST from environment."""
        monkeypatch.setenv("CLICKHOUSE_HOST", "brain.ap-south-1.clickhouse.cloud")
        assert_clickhouse_residency(host=None)  # must not raise

    def test_none_host_wrong_region_env_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """When CLICKHOUSE_HOST env var points to wrong region, raises."""
        monkeypatch.setenv("CLICKHOUSE_HOST", "brain.us-east-1.clickhouse.cloud")
        with pytest.raises(ClickHouseRegionMismatchError):
            assert_clickhouse_residency(host=None)

    def test_error_message_contains_cf_constraint_id(self) -> None:
        """The error message contains the CF-C4-RESIDENCY-1 constraint ID."""
        with pytest.raises(ClickHouseRegionMismatchError, match="CF-C4-RESIDENCY-1"):
            assert_clickhouse_residency(host="brain.us-west-2.clickhouse.cloud")


class TestKilledMutantResidency:
    """CF-C4-VERIFY-THE-VERIFIER-1: wrong-region mutant must be detected."""

    def test_wrong_region_mutant_is_rejected(self) -> None:
        """Simulates the killed-mutant scenario: an ap-northeast-1 host (not ap-south-1)
        must raise. This proves the assertion is NOT vacuous (not just checking non-empty host).
        """
        wrong_region_host = "brain-olap.ap-northeast-1.clickhouse.cloud"
        with pytest.raises(ClickHouseRegionMismatchError):
            assert_clickhouse_residency(host=wrong_region_host)

    def test_partial_match_not_sufficient(self) -> None:
        """A host containing 'south' but not 'ap-south-1' must not pass."""
        # This would be a false-positive if the check is too loose.
        with pytest.raises(ClickHouseRegionMismatchError):
            assert_clickhouse_residency(host="brain.eu-south-1.clickhouse.cloud")

    def test_ap_south_2_not_accepted(self) -> None:
        """ap-south-2 is a different region and must not pass the ap-south-1 check."""
        with pytest.raises(ClickHouseRegionMismatchError):
            assert_clickhouse_residency(host="brain.ap-south-2.clickhouse.cloud")


class TestPostgresReadOnlyRoleAssertion:
    """CF-C4-SINGLE-WRITER-GREP-2: analytics Postgres role must be read-only."""

    def test_skip_mode_bypasses_check(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """ANALYTICS_POSTGRES_ROLE_CHECK=skip bypasses the check for CI/test env."""
        monkeypatch.setenv("ANALYTICS_POSTGRES_ROLE_CHECK", "skip")
        assert_postgres_read_only_role(dsn="postgresql://fake")  # must not raise

    def test_missing_dsn_raises_environment_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Missing DSN and no DATABASE_URL raises EnvironmentError."""
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.setenv("ANALYTICS_POSTGRES_ROLE_CHECK", "enforce")
        with pytest.raises(EnvironmentError, match="DATABASE_URL"):
            assert_postgres_read_only_role(dsn=None)


class TestRunStartupAssertionsOrchestrator:
    """Tests for run_startup_assertions() — the orchestrator that calls both assertions.

    Tanvi F1: analytics-service coverage 67% because run_startup_assertions() (lines 194-211)
    was uncovered. These tests exercise the orchestrator path without a real Postgres connection.

    CF-C4-RESIDENCY-1: run_startup_assertions delegates to assert_clickhouse_residency.
    CF-C4-SINGLE-WRITER-GREP-2: run_startup_assertions delegates to assert_postgres_read_only_role.
    """

    def test_both_pass_when_ap_south_1_and_role_skip(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """run_startup_assertions completes without sys.exit when both checks pass."""
        monkeypatch.setenv("ANALYTICS_POSTGRES_ROLE_CHECK", "skip")
        # Must not raise or exit — both assertions pass
        run_startup_assertions(
            clickhouse_host="brain.ap-south-1.clickhouse.cloud",
            postgres_dsn="postgresql://fake",
        )

    def test_wrong_region_causes_exit_1(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
    ) -> None:
        """run_startup_assertions calls sys.exit(1) on residency failure."""
        monkeypatch.setenv("ANALYTICS_POSTGRES_ROLE_CHECK", "skip")
        with pytest.raises(SystemExit) as exc_info:
            run_startup_assertions(
                clickhouse_host="brain.us-east-1.clickhouse.cloud",  # WRONG REGION
                postgres_dsn="postgresql://fake",
            )
        assert exc_info.value.code == 1

    def test_missing_clickhouse_host_causes_exit_1(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Empty ClickHouse host → sys.exit(1) via EnvironmentError."""
        monkeypatch.setenv("ANALYTICS_POSTGRES_ROLE_CHECK", "skip")
        with pytest.raises(SystemExit) as exc_info:
            run_startup_assertions(
                clickhouse_host="",  # empty → EnvironmentError
                postgres_dsn="postgresql://fake",
            )
        assert exc_info.value.code == 1

    def test_missing_pg_dsn_causes_exit_1(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Missing Postgres DSN (enforce mode) → sys.exit(1)."""
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.setenv("ANALYTICS_POSTGRES_ROLE_CHECK", "enforce")
        with pytest.raises(SystemExit) as exc_info:
            run_startup_assertions(
                clickhouse_host="brain.ap-south-1.clickhouse.cloud",
                postgres_dsn=None,  # no DSN, no env var → EnvironmentError
            )
        assert exc_info.value.code == 1

    def test_both_fail_collects_both_errors_and_exits_1(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """When both assertions fail, run_startup_assertions collects both errors then exits."""
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.setenv("ANALYTICS_POSTGRES_ROLE_CHECK", "enforce")
        with pytest.raises(SystemExit) as exc_info:
            run_startup_assertions(
                clickhouse_host="brain.eu-west-1.clickhouse.cloud",  # wrong region
                postgres_dsn=None,  # missing DSN
            )
        assert exc_info.value.code == 1
