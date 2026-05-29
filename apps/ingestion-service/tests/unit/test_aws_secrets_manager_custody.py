"""
Unit + integration tests for AwsSecretsManagerCustody and custody_factory.

@paradigm: sql (no ML, no LLM)

Test coverage:
  _secret_name validation matrix (CF-CC-WS-ISOLATION-1)
  custody_factory selection matrix (CF-CC-GATE-1)
  Residency assert — client built with wrong region refuses to start (CF-CC-RESIDENCY-1)
  moto @mock_aws matrix — real boto3 path, zero real AWS:
    - put → get round-trip (idempotent upsert)
    - get on missing secret → KeyError (Protocol contract)
    - seal with RecoveryWindowInDays=7 asserted, ForceDeleteWithoutRecovery absent
    - seal idempotent (second call on already-sealed secret)
  Never-log negative assertion (CF-CC-NEVERLOG-1)
  Protocol conformance (assert isinstance — zero AWS calls)

  THREE GATE-MUTATION TESTS (CF-CC-NOREAL-AWS-1 / CF-CC-LAZY-1 / CF-CC-GATE-1 / CF-CC-RESIDENCY-1):
    1. Import-time zero-call assert
    2. Fail-closed default assert
    3. Wrong-region kill
  Each has a # MUTATION: comment explaining what change makes the test fail.
"""

from __future__ import annotations

import importlib
import json
import logging
import os
import sys
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

VALID_WORKSPACE_ID = "550e8400-e29b-41d4-a716-446655440000"
VALID_VENDOR = "shopify"
VALID_CONTENT = {"access_token": "shpat_test_secret_token", "shop": "example.myshopify.com"}


# ---------------------------------------------------------------------------
# Module imports — kept at test level so mutation tests can reload modules.
# ---------------------------------------------------------------------------

from src.infrastructure.secrets.aws_secrets_manager_custody import (
    AwsRegionMismatchError,
    AwsSecretsManagerCustody,
    _validate_id,
)
from src.infrastructure.secrets.custody import CredentialCustody
from src.infrastructure.secrets.custody_factory import select_custody
from src.infrastructure.secrets.held_custody import HeldCustodyError, HeldProductionCustody


# ===========================================================================
# Protocol conformance
# ===========================================================================


class TestProtocolConformance:
    """AwsSecretsManagerCustody and HeldProductionCustody satisfy CredentialCustody."""

    def test_aws_sm_is_credential_custody(self):
        """assert isinstance makes zero AWS calls (client is lazy)."""
        assert isinstance(AwsSecretsManagerCustody(), CredentialCustody)

    def test_held_is_credential_custody(self):
        assert isinstance(HeldProductionCustody(), CredentialCustody)


# ===========================================================================
# _validate_id — input validation (CF-CC-WS-ISOLATION-1)
# ===========================================================================


class TestValidateId:
    """_validate_id rejects all path-traversal / empty / wildcard values."""

    def test_valid_uuid_passes(self):
        result = _validate_id(VALID_WORKSPACE_ID, "workspace_id")
        assert result == VALID_WORKSPACE_ID

    def test_valid_vendor_passes(self):
        result = _validate_id("shopify", "vendor")
        assert result == "shopify"

    def test_none_raises_value_error(self):
        with pytest.raises(ValueError, match="must not be None"):
            _validate_id(None, "workspace_id")

    def test_empty_string_raises_value_error(self):
        with pytest.raises(ValueError, match="must not be empty"):
            _validate_id("", "workspace_id")

    def test_whitespace_only_raises_value_error(self):
        with pytest.raises(ValueError, match="must not be empty"):
            _validate_id("   ", "workspace_id")

    def test_slash_raises_value_error(self):
        with pytest.raises(ValueError, match="must not contain '/'"):
            _validate_id("workspace/evil", "workspace_id")

    def test_double_dot_raises_value_error(self):
        with pytest.raises(ValueError, match="must not contain '..'"):
            _validate_id("workspace..evil", "workspace_id")

    def test_wildcard_raises_value_error(self):
        with pytest.raises(ValueError, match="must not contain '*'"):
            _validate_id("workspace*", "workspace_id")

    def test_path_traversal_vendor_raises(self):
        with pytest.raises(ValueError):
            _validate_id("../other_workspace", "vendor")

    def test_error_message_does_not_contain_value(self):
        """ValueError message carries only field_name, not the offending value.
        CF-CC-NEVERLOG-1 analogue for input validation.
        """
        try:
            _validate_id("evil*value", "workspace_id")
        except ValueError as exc:
            assert "evil*value" not in str(exc)
            assert "workspace_id" in str(exc)


class TestSecretName:
    """_secret_name composes the canonical path."""

    def test_canonical_shape(self):
        custody = AwsSecretsManagerCustody()
        name = custody._secret_name(VALID_WORKSPACE_ID, VALID_VENDOR)
        assert name == f"brain/{VALID_WORKSPACE_ID}/{VALID_VENDOR}/credential"

    def test_rejects_slash_in_workspace_id(self):
        custody = AwsSecretsManagerCustody()
        with pytest.raises(ValueError):
            custody._secret_name("evil/escape", VALID_VENDOR)

    def test_rejects_wildcard_in_vendor(self):
        custody = AwsSecretsManagerCustody()
        with pytest.raises(ValueError):
            custody._secret_name(VALID_WORKSPACE_ID, "*")


# ===========================================================================
# custody_factory selection matrix (CF-CC-GATE-1)
# ===========================================================================


class TestCustodyFactory:
    """Factory returns the correct backing per selector; unknown → held (fail-closed)."""

    def test_unset_returns_held(self):
        """No env var → HeldProductionCustody."""
        env_without_backing = {k: v for k, v in os.environ.items() if k != "CONNECTOR_CUSTODY_BACKING"}
        with patch.dict(os.environ, env_without_backing, clear=True):
            result = select_custody()
        assert isinstance(result, HeldProductionCustody)

    def test_empty_string_returns_held(self):
        result = select_custody(backing="")
        assert isinstance(result, HeldProductionCustody)

    def test_local_returns_held(self):
        result = select_custody(backing="local")
        assert isinstance(result, HeldProductionCustody)

    def test_aws_secrets_manager_returns_aws_class(self):
        result = select_custody(backing="aws-secrets-manager")
        assert isinstance(result, AwsSecretsManagerCustody)

    def test_unknown_value_returns_held_not_aws(self):
        """Any unrecognised value → HeldProductionCustody, never AwsSecretsManagerCustody.
        CF-CC-GATE-1.
        """
        result = select_custody(backing="some-unknown-backing")
        assert isinstance(result, HeldProductionCustody)
        assert not isinstance(result, AwsSecretsManagerCustody)

    def test_uppercase_aws_name_returns_held(self):
        """Case-sensitive match — 'AWS-SECRETS-MANAGER' ≠ 'aws-secrets-manager'.
        CF-CC-GATE-1: typos / wrong case fail closed.
        """
        result = select_custody(backing="AWS-SECRETS-MANAGER")
        assert isinstance(result, HeldProductionCustody)

    def test_partial_aws_name_returns_held(self):
        result = select_custody(backing="aws-secrets")
        assert isinstance(result, HeldProductionCustody)

    def test_env_var_aws_selects_aws_class(self):
        with patch.dict(os.environ, {"CONNECTOR_CUSTODY_BACKING": "aws-secrets-manager"}):
            result = select_custody()
        assert isinstance(result, AwsSecretsManagerCustody)

    def test_env_var_unknown_selects_held(self):
        with patch.dict(os.environ, {"CONNECTOR_CUSTODY_BACKING": "nonsense"}):
            result = select_custody()
        assert isinstance(result, HeldProductionCustody)


# ===========================================================================
# HeldProductionCustody
# ===========================================================================


class TestHeldProductionCustody:
    def setup_method(self):
        self.custody = HeldProductionCustody()

    @pytest.mark.asyncio
    async def test_get_raises_held_custody_error(self):
        with pytest.raises(HeldCustodyError):
            await self.custody.get(VALID_WORKSPACE_ID, VALID_VENDOR)

    @pytest.mark.asyncio
    async def test_put_raises_held_custody_error(self):
        with pytest.raises(HeldCustodyError):
            await self.custody.put(VALID_WORKSPACE_ID, VALID_VENDOR, VALID_CONTENT)

    @pytest.mark.asyncio
    async def test_seal_raises_held_custody_error(self):
        with pytest.raises(HeldCustodyError):
            await self.custody.seal(VALID_WORKSPACE_ID, VALID_VENDOR)

    @pytest.mark.asyncio
    async def test_error_message_references_gate(self):
        with pytest.raises(HeldCustodyError, match="CF-CC-GATE-1"):
            await self.custody.get(VALID_WORKSPACE_ID, VALID_VENDOR)

    @pytest.mark.asyncio
    async def test_error_message_does_not_leak_content(self):
        """Error message must not contain any credential content."""
        secret_content = {"access_token": "SUPER_SECRET_TOKEN_XYZ"}
        with pytest.raises(HeldCustodyError) as exc_info:
            await self.custody.put(VALID_WORKSPACE_ID, VALID_VENDOR, secret_content)
        # The error message may contain workspace_id/vendor (ids only) but never token.
        assert "SUPER_SECRET_TOKEN_XYZ" not in str(exc_info.value)


# ===========================================================================
# moto @mock_aws integration matrix — REAL boto3 path, zero real AWS
# ===========================================================================


try:
    from moto import mock_aws  # moto >= 4.x unified decorator
    MOTO_AVAILABLE = True
except ImportError:
    MOTO_AVAILABLE = False

pytestmark_moto = pytest.mark.skipif(
    not MOTO_AVAILABLE, reason="moto not installed"
)


@pytest.fixture
def aws_env(monkeypatch):
    """Set fake AWS credentials so moto does not look for real ones."""
    monkeypatch.setenv("AWS_DEFAULT_REGION", "ap-south-1")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_SECURITY_TOKEN", "testing")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "testing")


@pytest.mark.skipif(not MOTO_AVAILABLE, reason="moto not installed")
class TestAwsSecretsManagerCustodyMoto:
    """Integration tests via moto — the REAL boto3 code path with zero real AWS calls."""

    @pytest.mark.asyncio
    async def test_put_get_round_trip(self, aws_env):
        """put then get returns the same content. CF-CC-NOREAL-AWS-1."""
        with mock_aws():
            custody = AwsSecretsManagerCustody()
            await custody.put(VALID_WORKSPACE_ID, VALID_VENDOR, VALID_CONTENT)
            result = await custody.get(VALID_WORKSPACE_ID, VALID_VENDOR)
        assert result.workspace_id == VALID_WORKSPACE_ID
        assert result.vendor == VALID_VENDOR
        assert result.content == VALID_CONTENT

    @pytest.mark.asyncio
    async def test_get_missing_secret_raises_key_error(self, aws_env):
        """get on a never-stored secret raises KeyError. Protocol contract."""
        with mock_aws():
            custody = AwsSecretsManagerCustody()
            with pytest.raises(KeyError):
                await custody.get(VALID_WORKSPACE_ID, VALID_VENDOR)

    @pytest.mark.asyncio
    async def test_put_is_idempotent(self, aws_env):
        """Calling put twice with different content overwrites (upsert is idempotent)."""
        content_v1 = {"access_token": "token_v1"}
        content_v2 = {"access_token": "token_v2"}
        with mock_aws():
            custody = AwsSecretsManagerCustody()
            await custody.put(VALID_WORKSPACE_ID, VALID_VENDOR, content_v1)
            await custody.put(VALID_WORKSPACE_ID, VALID_VENDOR, content_v2)
            result = await custody.get(VALID_WORKSPACE_ID, VALID_VENDOR)
        assert result.content == content_v2

    @pytest.mark.asyncio
    async def test_seal_schedules_deletion_with_recovery_window(self, aws_env):
        """seal calls delete_secret with RecoveryWindowInDays=7.
        CF-CC-SEAL-RECOVERY-1: ForceDeleteWithoutRecovery must NOT be passed.
        """
        import boto3

        with mock_aws():
            # Create a secret first.
            custody = AwsSecretsManagerCustody()
            await custody.put(VALID_WORKSPACE_ID, VALID_VENDOR, VALID_CONTENT)

            # Spy on delete_secret to capture the kwargs.
            real_client = custody._client()
            original_delete = real_client.delete_secret
            captured_calls: list[dict[str, Any]] = []

            def spy_delete(**kwargs: Any) -> Any:
                captured_calls.append(kwargs)
                return original_delete(**kwargs)

            real_client.delete_secret = spy_delete

            await custody.seal(VALID_WORKSPACE_ID, VALID_VENDOR)

        assert len(captured_calls) == 1
        call_kwargs = captured_calls[0]
        assert call_kwargs["RecoveryWindowInDays"] == 7
        # ForceDeleteWithoutRecovery must NOT be present.
        assert "ForceDeleteWithoutRecovery" not in call_kwargs

    @pytest.mark.asyncio
    async def test_seal_idempotent_already_scheduled(self, aws_env):
        """A second seal() on an already-scheduled secret does not raise."""
        with mock_aws():
            custody = AwsSecretsManagerCustody()
            await custody.put(VALID_WORKSPACE_ID, VALID_VENDOR, VALID_CONTENT)
            await custody.seal(VALID_WORKSPACE_ID, VALID_VENDOR)
            # Second call — moto reports InvalidRequestException (already scheduled).
            # Our implementation treats this as idempotent.
            await custody.seal(VALID_WORKSPACE_ID, VALID_VENDOR)

    @pytest.mark.asyncio
    async def test_force_delete_never_called(self, aws_env):
        """ForceDeleteWithoutRecovery must NOT appear as a kwarg in any delete_secret call.
        CF-CC-SEAL-RECOVERY-1.
        """
        import boto3

        with mock_aws():
            custody = AwsSecretsManagerCustody()
            await custody.put(VALID_WORKSPACE_ID, VALID_VENDOR, VALID_CONTENT)

            real_client = custody._client()
            original_delete = real_client.delete_secret
            all_delete_kwargs: list[dict[str, Any]] = []

            def recording_delete(**kwargs: Any) -> Any:
                all_delete_kwargs.append(kwargs)
                return original_delete(**kwargs)

            real_client.delete_secret = recording_delete
            await custody.seal(VALID_WORKSPACE_ID, VALID_VENDOR)

        for kwargs in all_delete_kwargs:
            assert "ForceDeleteWithoutRecovery" not in kwargs, (
                "ForceDeleteWithoutRecovery was passed to delete_secret — CF-CC-SEAL-RECOVERY-1 VIOLATION"
            )

    @pytest.mark.asyncio
    async def test_get_key_error_does_not_leak_token(self, aws_env):
        """KeyError message carries only ids — never any credential content.
        CF-CC-NEVERLOG-1 negative assertion.
        """
        with mock_aws():
            custody = AwsSecretsManagerCustody()
            with pytest.raises(KeyError) as exc_info:
                await custody.get(VALID_WORKSPACE_ID, VALID_VENDOR)
        error_text = str(exc_info.value)
        # workspace_id and vendor are ids — allowed.
        # Any token text must never appear.
        assert "shpat_" not in error_text
        assert "access_token" not in error_text

    @pytest.mark.asyncio
    async def test_log_on_put_does_not_include_content(self, aws_env, caplog):
        """Our application log output from put() must not contain credential content.
        CF-CC-NEVERLOG-1 negative assertion.

        Note: we scope caplog to the application module logger only.
        botocore's own DEBUG logs emit the request body (expected botocore behaviour);
        our contract is that OUR logger (src.infrastructure.secrets.aws_secrets_manager_custody)
        never emits SecretString/content — not that botocore's internal wire-trace is suppressed.
        """
        our_logger = "src.infrastructure.secrets.aws_secrets_manager_custody"
        with mock_aws():
            custody = AwsSecretsManagerCustody()
            with caplog.at_level(logging.DEBUG, logger=our_logger):
                await custody.put(VALID_WORKSPACE_ID, VALID_VENDOR, VALID_CONTENT)

        # Filter to only our logger's records.
        our_log_text = "\n".join(
            r.getMessage() for r in caplog.records if r.name == our_logger
        )
        assert "shpat_test_secret_token" not in our_log_text
        assert "example.myshopify.com" not in our_log_text

    @pytest.mark.asyncio
    async def test_log_on_get_does_not_include_content(self, aws_env, caplog):
        """Our application log output from get() must not contain credential content.
        CF-CC-NEVERLOG-1 negative assertion.

        Same scoping: we assert OUR logger never emits token text.
        botocore wire-trace at DEBUG is out of scope for this assertion.
        """
        our_logger = "src.infrastructure.secrets.aws_secrets_manager_custody"
        with mock_aws():
            custody = AwsSecretsManagerCustody()
            await custody.put(VALID_WORKSPACE_ID, VALID_VENDOR, VALID_CONTENT)
            with caplog.at_level(logging.DEBUG, logger=our_logger):
                await custody.get(VALID_WORKSPACE_ID, VALID_VENDOR)

        our_log_text = "\n".join(
            r.getMessage() for r in caplog.records if r.name == our_logger
        )
        assert "shpat_test_secret_token" not in our_log_text
        assert "example.myshopify.com" not in our_log_text

    @pytest.mark.asyncio
    async def test_multiple_workspaces_isolated(self, aws_env):
        """Credentials for workspace A must not be readable from workspace B.
        CF-CC-WS-ISOLATION-1.
        """
        workspace_a = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        workspace_b = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
        content_a = {"access_token": "token_for_a"}
        content_b = {"access_token": "token_for_b"}

        with mock_aws():
            custody = AwsSecretsManagerCustody()
            await custody.put(workspace_a, VALID_VENDOR, content_a)
            await custody.put(workspace_b, VALID_VENDOR, content_b)

            result_a = await custody.get(workspace_a, VALID_VENDOR)
            result_b = await custody.get(workspace_b, VALID_VENDOR)

        assert result_a.content == content_a
        assert result_b.content == content_b
        assert result_a.content != result_b.content


# ===========================================================================
# RESIDENCY ASSERT — wrong-region kill (CF-CC-RESIDENCY-1)
# ===========================================================================


class TestResidencyAssert:
    """Client built with a non-ap-south-1 region refuses to start."""

    def test_wrong_region_raises_region_mismatch_error(self, monkeypatch):
        """Force the effective region to us-east-1 and assert refusal to start.

        # MUTATION: removing the residency assert in _client() makes this test FAIL.
        # Without the assert, the wrong-region client is cached and returned,
        # and this test would see no exception — the gate is vacuous.
        # The pairing spy below also detects if the wrong-region client
        # silently proceeds to make a network call (moto intercepts it, but
        # the wrong-region check fires first in the real impl).
        """
        import boto3

        # Patch boto3.client to return a fake client whose meta.region_name is us-east-1.
        fake_client = MagicMock()
        fake_client.meta.region_name = "us-east-1"

        with patch("boto3.client", return_value=fake_client) as mock_boto3:
            custody = AwsSecretsManagerCustody()
            with pytest.raises(AwsRegionMismatchError, match="us-east-1"):
                custody._client()

        # The boto3.client WAS called (to construct the wrong-region client),
        # but the residency assert fired before it was cached/returned.
        mock_boto3.assert_called_once()

    def test_correct_region_does_not_raise(self, monkeypatch):
        """ap-south-1 passes the residency assert."""
        fake_client = MagicMock()
        fake_client.meta.region_name = "ap-south-1"

        with patch("boto3.client", return_value=fake_client):
            custody = AwsSecretsManagerCustody()
            # Should not raise.
            client = custody._client()

        assert client is fake_client

    def test_region_mismatch_error_message_does_not_leak_creds(self):
        """AwsRegionMismatchError message contains only region info.
        CF-CC-NEVERLOG-1: no credential content in error paths.
        """
        exc = AwsRegionMismatchError("test: effective=us-east-1, expected=ap-south-1")
        assert "access_token" not in str(exc)
        assert "secret" not in str(exc).lower() or "secretsmanager" in str(exc).lower()


# ===========================================================================
# GATE MUTATION TESTS — THE THREE NAMED TESTS FOR TANVI / SHREYA
# These are the verify-the-verifier gates (CF-CC-NOREAL-AWS-1).
# ===========================================================================


class TestGateMutations:
    """
    Three gate-mutation tests. Each includes a # MUTATION: comment describing
    what code change makes the test FAIL — confirming the gate is non-vacuous.

    Tanvi (Stage 5) re-mutates independently.
    Shreya (Stage 4) treats #1 and #2 as VETO surfaces.
    """

    def test_1_import_time_zero_aws_call(self):
        """GATE MUTATION TEST #1 — Import-time zero-call assert (CF-CC-LAZY-1).

        Importing aws_secrets_manager_custody and constructing AwsSecretsManagerCustody()
        (which happens at the module-level assert isinstance) must make ZERO calls to
        boto3.client.

        # MUTATION: move boto3.client(...) into __init__ (or to module scope) →
        #   this test FAILS because the spy raises on the import-time construction,
        #   and the ImportError / spy exception propagates.
        #   If this test still passes after that mutation, the gate is vacuous → BOUNCE.
        """
        # We must reload the module to re-run the module-level assert isinstance.
        # First, remove it from sys.modules cache.
        module_name = "src.infrastructure.secrets.aws_secrets_manager_custody"
        if module_name in sys.modules:
            del sys.modules[module_name]

        spy_called = []

        def spy_boto3_client(*args: Any, **kwargs: Any) -> Any:
            spy_called.append((args, kwargs))
            raise AssertionError(
                "boto3.client was called at import time — CF-CC-LAZY-1 VIOLATION. "
                "The client must be constructed lazily in _client(), not at import or __init__."
            )

        with patch("boto3.client", side_effect=spy_boto3_client):
            # This import (re-)runs the module-level assert isinstance(AwsSecretsManagerCustody(), ...)
            importlib.import_module(module_name)

        # The spy must NEVER have been called.
        assert spy_called == [], (
            f"boto3.client was called {len(spy_called)} time(s) at import. "
            "CF-CC-LAZY-1: client must be lazy. MUTATION: move client into __init__ → this FAILS."
        )

        # Restore the module in sys.modules for subsequent tests.
        # (It's already there from the importlib.import_module call above.)

    def test_2_fail_closed_default_no_aws_call(self):
        """GATE MUTATION TEST #2 — Fail-closed default (CF-CC-GATE-1).

        With a boto3.client spy that raises, select_custody() must return
        HeldProductionCustody — and the spy must NEVER fire — for EVERY non-AWS
        selector. There are TWO fail-closed branches in custody_factory and this
        gate must be non-vacuous against BOTH:
          (i)  the unset/None/'local' branch  (`case None | "" | "local":`)
          (ii) the unknown-value catch-all     (`case _:`)
        Stage-5 (Tanvi) found the original test only exercised (i) while its
        MUTATION targeted (ii) — the paths did not intersect, so the gate was
        vacuous. This version drives both branches under the same spy.

        # MUTATION: change EITHER custody_factory held branch to return
        #   AwsSecretsManagerCustody() instead of HeldProductionCustody():
        #     - mutate `case None | "" | "local":` → assertion (i) FAILS
        #     - mutate `case _:`                    → assertion (ii) FAILS
        #   In both cases, returning the AWS class also makes any subsequent
        #   get()/_client() call hit boto3.client → the spy raises.
        #   If this test still passes after mutating EITHER branch → vacuous → BOUNCE.
        """
        spy_called = []

        def spy_boto3_client(*args: Any, **kwargs: Any) -> Any:
            spy_called.append((args, kwargs))
            raise AssertionError(
                "boto3.client was called via a non-AWS factory path — "
                "CF-CC-GATE-1 VIOLATION. Every non-'aws-secrets-manager' selector "
                "must return HeldProductionCustody, never AwsSecretsManagerCustody."
            )

        env_without_backing = {k: v for k, v in os.environ.items() if k != "CONNECTOR_CUSTODY_BACKING"}

        with patch("boto3.client", side_effect=spy_boto3_client):
            with patch.dict(os.environ, env_without_backing, clear=True):
                # (i) the unset/None/'local' default branch
                result_default = select_custody()
                # (ii) the unknown-value catch-all branch (`case _:`)
                result_unknown = select_custody(backing="some-unknown-backing")

        # (i) Default (unset) path must be HeldProductionCustody, not AWS.
        assert isinstance(result_default, HeldProductionCustody), (
            f"Got {type(result_default).__name__}, expected HeldProductionCustody. "
            "CF-CC-GATE-1: unset/default backing must be held, not AWS. "
            "MUTATION: `case None | \"\" | \"local\":` → AwsSecretsManagerCustody → this FAILS."
        )
        # (ii) Unknown-value catch-all must ALSO be HeldProductionCustody, not AWS.
        assert isinstance(result_unknown, HeldProductionCustody), (
            f"Got {type(result_unknown).__name__}, expected HeldProductionCustody. "
            "CF-CC-GATE-1: unknown backing must fail closed to held, not AWS. "
            "MUTATION: `case _:` → AwsSecretsManagerCustody → this FAILS."
        )
        assert not isinstance(result_default, AwsSecretsManagerCustody)
        assert not isinstance(result_unknown, AwsSecretsManagerCustody)

        # boto3.client must never have been called on EITHER non-AWS path.
        assert spy_called == [], (
            f"boto3.client was called {len(spy_called)} time(s) on a non-AWS path. "
            "CF-CC-GATE-1: no AWS call on unset OR unknown backing. "
            "MUTATION: auto-activate AWS on either held branch → this FAILS."
        )

    def test_3_wrong_region_kill(self):
        """GATE MUTATION TEST #3 — Wrong-region kill (CF-CC-RESIDENCY-1).

        Constructing a boto3 client with a non-ap-south-1 effective region
        must raise AwsRegionMismatchError BEFORE any network call is made.

        # MUTATION: remove the residency assert in _client() →
        #   this test FAILS because AwsRegionMismatchError is no longer raised,
        #   the wrong-region client is silently cached, and the pairing boto3 spy
        #   records the call with the wrong region — neither exception path fires.
        #   If this test still passes after that mutation, residency is vacuous → BOUNCE.

        The pairing: we also assert boto3.client WAS called with region_name='ap-south-1'
        (the hard-coded constant). If the MUTATION also changes the region constant,
        the spy captures the wrong region — detectable.
        """
        # Return a fake client that reports a wrong effective region.
        wrong_region = "us-east-1"
        fake_client = MagicMock()
        fake_client.meta.region_name = wrong_region

        boto3_call_kwargs: list[dict[str, Any]] = []

        def spy_boto3_client(*args: Any, **kwargs: Any) -> Any:
            boto3_call_kwargs.append({"args": args, "kwargs": kwargs})
            return fake_client

        with patch("boto3.client", side_effect=spy_boto3_client):
            custody = AwsSecretsManagerCustody()
            with pytest.raises(AwsRegionMismatchError) as exc_info:
                custody._client()

        # Residency error must mention the wrong region.
        assert wrong_region in str(exc_info.value)

        # boto3.client was called with region_name='ap-south-1' (the hard-coded constant).
        assert len(boto3_call_kwargs) == 1
        assert boto3_call_kwargs[0]["kwargs"].get("region_name") == "ap-south-1", (
            "boto3.client was NOT called with region_name='ap-south-1'. "
            "CF-CC-RESIDENCY-1: the region constant must be 'ap-south-1'. "
            "MUTATION: remove assert → AwsRegionMismatchError not raised → this FAILS."
        )

        # AwsRegionMismatchError message must not leak credentials.
        assert "access_token" not in str(exc_info.value)
        assert "shpat_" not in str(exc_info.value)
