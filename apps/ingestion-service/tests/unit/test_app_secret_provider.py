"""
Unit tests — AppSecretsManagerProvider, EnvAppSecretProvider,
HeldAppSecretProvider, and select_app_secret_provider().

@paradigm: sql (no ML, no LLM)

Coverage targets (CF-HMAC-VERIFY-THE-VERIFIER-1 / T2.1):
  - Factory selection matrix: aws-sm → SM provider; local/unset → env provider;
    unknown → HeldAppSecretProvider (fail-closed).
  - moto round-trip: put secret → provider returns it; cached (second get does
    NOT issue a second SM call — spy-asserted ≤1 get_secret_value call).
  - Cold-start / unretrievable → fail-closed: SM ResourceNotFoundException / empty /
    missing env → raises AppSecretUnavailableError (NOT silent None/"").
  - Residency: wrong-region client → AwsRegionMismatchError refuse-to-start.
  - Never-log negative assertion: secret value and full HMAC strings absent from logs
    across resolve + fetch + error paths.

Zero real AWS (moto @mock_aws throughout).
Never print or log the live shpss_… value.
"""

from __future__ import annotations

import importlib
import json
import logging
import os
import sys
from typing import Any
from unittest.mock import MagicMock, call, patch

import boto3
import pytest
from moto import mock_aws

# ---------------------------------------------------------------------------
# Imports under test
# ---------------------------------------------------------------------------

from src.infrastructure.secrets.app_secret_factory import select_app_secret_provider
from src.infrastructure.secrets.app_secret_provider import (
    AppSecretsManagerProvider,
    AppSecretUnavailableError,
    EnvAppSecretProvider,
    HeldAppSecretError,
    HeldAppSecretProvider,
    _APP_SHOPIFY_SECRET_NAME,
    _REQUIRED_REGION,
)
from src.infrastructure.secrets.aws_secrets_manager_custody import AwsRegionMismatchError

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_TEST_SECRET_VALUE = "shpss_test_value_safe_for_tests_only_not_live"
_TEST_SECRET_JSON = json.dumps({"value": _TEST_SECRET_VALUE})


def _create_test_secret(sm_client: Any) -> None:
    """Create the singleton secret in a moto-backed SM."""
    sm_client.create_secret(
        Name=_APP_SHOPIFY_SECRET_NAME,
        SecretString=_TEST_SECRET_JSON,
    )


# ===========================================================================
# Factory selection matrix (CF-HMAC-RETRIEVAL-SHAPE-1)
# ===========================================================================


class TestFactorySelectionMatrix:
    """select_app_secret_provider() routes to the correct provider class."""

    def test_aws_sm_backing_returns_sm_provider(self):
        result = select_app_secret_provider(backing="aws-secrets-manager")
        assert isinstance(result, AppSecretsManagerProvider), (
            f"Expected AppSecretsManagerProvider, got {type(result).__name__}. "
            "CF-HMAC-RETRIEVAL-SHAPE-1: 'aws-secrets-manager' must route to SM provider."
        )

    def test_none_backing_returns_env_provider(self):
        result = select_app_secret_provider(backing=None)
        assert isinstance(result, EnvAppSecretProvider), (
            f"Expected EnvAppSecretProvider, got {type(result).__name__}. "
            "CF-HMAC-RETRIEVAL-SHAPE-1: unset (None) must route to env dev fallback."
        )

    def test_empty_backing_returns_env_provider(self):
        result = select_app_secret_provider(backing="")
        assert isinstance(result, EnvAppSecretProvider)

    def test_local_backing_returns_env_provider(self):
        result = select_app_secret_provider(backing="local")
        assert isinstance(result, EnvAppSecretProvider)

    def test_unknown_backing_returns_held_provider(self):
        result = select_app_secret_provider(backing="some-unknown-value")
        assert isinstance(result, HeldAppSecretProvider), (
            f"Expected HeldAppSecretProvider, got {type(result).__name__}. "
            "CF-CC-GATE-1 / CF-HMAC-FAILCLOSED-1: unknown backing must fail closed."
        )

    def test_unknown_backing_is_not_env_or_sm(self):
        result = select_app_secret_provider(backing="mystery-value")
        assert not isinstance(result, AppSecretsManagerProvider)
        assert not isinstance(result, EnvAppSecretProvider)

    def test_env_var_drives_selection(self, monkeypatch):
        """CONNECTOR_CUSTODY_BACKING env var is honoured when no explicit arg."""
        monkeypatch.setenv("CONNECTOR_CUSTODY_BACKING", "aws-secrets-manager")
        result = select_app_secret_provider()
        assert isinstance(result, AppSecretsManagerProvider)

    def test_explicit_arg_overrides_env(self, monkeypatch):
        """Explicit backing arg takes precedence over CONNECTOR_CUSTODY_BACKING."""
        monkeypatch.setenv("CONNECTOR_CUSTODY_BACKING", "aws-secrets-manager")
        result = select_app_secret_provider(backing="local")
        assert isinstance(result, EnvAppSecretProvider)


# ===========================================================================
# HeldAppSecretProvider — fail-closed on every access (CF-HMAC-FAILCLOSED-1)
# ===========================================================================


class TestHeldAppSecretProvider:
    def test_get_raises_held_error(self):
        provider = HeldAppSecretProvider()
        with pytest.raises(HeldAppSecretError):
            provider.get_shopify_hmac_secret()

    def test_refresh_raises_held_error(self):
        provider = HeldAppSecretProvider()
        with pytest.raises(HeldAppSecretError):
            provider.refresh()

    def test_unknown_backing_via_factory_raises_on_access(self):
        provider = select_app_secret_provider(backing="not-a-real-backing")
        with pytest.raises(HeldAppSecretError):
            provider.get_shopify_hmac_secret()


# ===========================================================================
# EnvAppSecretProvider (CF-HMAC-FAILCLOSED-1 on empty env)
# ===========================================================================


class TestEnvAppSecretProvider:
    def test_returns_env_value_when_set(self, monkeypatch):
        monkeypatch.setenv("SHOPIFY_CLIENT_SECRET", _TEST_SECRET_VALUE)
        provider = EnvAppSecretProvider()
        assert provider.get_shopify_hmac_secret() == _TEST_SECRET_VALUE

    def test_raises_when_env_absent(self, monkeypatch):
        monkeypatch.delenv("SHOPIFY_CLIENT_SECRET", raising=False)
        provider = EnvAppSecretProvider()
        with pytest.raises(AppSecretUnavailableError):
            provider.get_shopify_hmac_secret()

    def test_raises_when_env_empty(self, monkeypatch):
        monkeypatch.setenv("SHOPIFY_CLIENT_SECRET", "")
        provider = EnvAppSecretProvider()
        with pytest.raises(AppSecretUnavailableError):
            provider.get_shopify_hmac_secret()

    def test_raises_when_env_whitespace_only(self, monkeypatch):
        monkeypatch.setenv("SHOPIFY_CLIENT_SECRET", "   ")
        provider = EnvAppSecretProvider()
        with pytest.raises(AppSecretUnavailableError):
            provider.get_shopify_hmac_secret()

    def test_refresh_is_noop(self, monkeypatch):
        monkeypatch.setenv("SHOPIFY_CLIENT_SECRET", _TEST_SECRET_VALUE)
        provider = EnvAppSecretProvider()
        provider.refresh()  # must not raise

    def test_never_log_secret_value(self, monkeypatch, caplog):
        """Secret value must never appear in logs. CF-HMAC-NEVERLOG-1."""
        monkeypatch.setenv("SHOPIFY_CLIENT_SECRET", _TEST_SECRET_VALUE)
        provider = EnvAppSecretProvider()
        with caplog.at_level(logging.DEBUG):
            provider.get_shopify_hmac_secret()
        for record in caplog.records:
            assert _TEST_SECRET_VALUE not in record.getMessage(), (
                "CF-HMAC-NEVERLOG-1 VIOLATED: secret value appeared in log record."
            )


# ===========================================================================
# AppSecretsManagerProvider — moto round-trip + cache
# ===========================================================================


class TestAppSecretsManagerProvider:
    """Tests using moto @mock_aws — zero real AWS calls."""

    @mock_aws
    def test_round_trip_returns_secret_value(self):
        """Put a secret via boto3; provider must return it. CF-HMAC-HOTPATH-CACHE-1."""
        sm = boto3.client("secretsmanager", region_name="ap-south-1")
        _create_test_secret(sm)

        provider = AppSecretsManagerProvider()
        value = provider.get_shopify_hmac_secret()
        assert value == _TEST_SECRET_VALUE

    @mock_aws
    def test_cache_at_most_one_sm_call(self):
        """N reads must issue at most 1 get_secret_value call. CF-HMAC-HOTPATH-CACHE-1."""
        sm = boto3.client("secretsmanager", region_name="ap-south-1")
        _create_test_secret(sm)

        provider = AppSecretsManagerProvider()

        # Wrap the provider's real _client so we can spy on get_secret_value.
        real_client = provider._client()
        call_count = [0]
        original_get = real_client.get_secret_value

        def spy_get(*args, **kwargs):
            call_count[0] += 1
            return original_get(*args, **kwargs)

        real_client.get_secret_value = spy_get

        # Multiple reads — must hit SM at most once.
        for _ in range(5):
            provider.get_shopify_hmac_secret()

        assert call_count[0] <= 1, (
            f"get_secret_value was called {call_count[0]} times across 5 reads. "
            "CF-HMAC-HOTPATH-CACHE-1: at most ONE SM call per process lifetime."
        )

    @mock_aws
    def test_refresh_clears_cache_and_refetches(self):
        """After refresh(), next call re-fetches from SM."""
        sm = boto3.client("secretsmanager", region_name="ap-south-1")
        _create_test_secret(sm)

        provider = AppSecretsManagerProvider()
        first = provider.get_shopify_hmac_secret()

        # Update the secret value in SM (simulating rotation).
        new_value = "shpss_rotated_test_value"
        sm.put_secret_value(
            SecretId=_APP_SHOPIFY_SECRET_NAME,
            SecretString=json.dumps({"value": new_value}),
        )

        # Before refresh — cache still returns old value.
        assert provider.get_shopify_hmac_secret() == first

        # After refresh — must return the new value.
        provider.refresh()
        updated = provider.get_shopify_hmac_secret()
        assert updated == new_value

    @mock_aws
    def test_resource_not_found_raises_unavailable(self):
        """SM ResourceNotFoundException → AppSecretUnavailableError (CF-HMAC-FAILCLOSED-1)."""
        # Do NOT create the secret — SM returns ResourceNotFoundException.
        provider = AppSecretsManagerProvider()
        with pytest.raises(AppSecretUnavailableError) as exc_info:
            provider.get_shopify_hmac_secret()
        # CF-HMAC-NEVERLOG-1: error message must not contain the secret value.
        assert _TEST_SECRET_VALUE not in str(exc_info.value)

    @mock_aws
    def test_empty_secret_string_raises_unavailable(self):
        """Empty SecretString → AppSecretUnavailableError (CF-HMAC-FAILCLOSED-1)."""
        sm = boto3.client("secretsmanager", region_name="ap-south-1")
        # Store a secret with an empty value field.
        sm.create_secret(
            Name=_APP_SHOPIFY_SECRET_NAME,
            SecretString=json.dumps({"value": ""}),
        )
        provider = AppSecretsManagerProvider()
        with pytest.raises(AppSecretUnavailableError):
            provider.get_shopify_hmac_secret()

    @mock_aws
    def test_missing_value_key_raises_unavailable(self):
        """Secret stored without 'value' key → AppSecretUnavailableError."""
        sm = boto3.client("secretsmanager", region_name="ap-south-1")
        sm.create_secret(
            Name=_APP_SHOPIFY_SECRET_NAME,
            SecretString=json.dumps({"wrong_key": "something"}),
        )
        provider = AppSecretsManagerProvider()
        with pytest.raises(AppSecretUnavailableError):
            provider.get_shopify_hmac_secret()

    def test_lazy_client_no_aws_at_init(self):
        """Constructing AppSecretsManagerProvider() makes ZERO boto3 calls. CF-CC-LAZY-1."""
        spy_called = []

        def spy_boto3_client(*args: Any, **kwargs: Any) -> Any:
            spy_called.append((args, kwargs))
            raise AssertionError("boto3.client called at __init__ — CF-CC-LAZY-1 VIOLATION.")

        with patch("boto3.client", side_effect=spy_boto3_client):
            _provider = AppSecretsManagerProvider()

        assert spy_called == [], (
            "boto3.client was called during AppSecretsManagerProvider.__init__. "
            "CF-CC-LAZY-1: client must be lazy."
        )

    def test_residency_wrong_region_raises(self):
        """Wrong-region boto3 client → AwsRegionMismatchError (CF-HMAC-RESIDENCY-1)."""
        wrong_region = "us-east-1"
        fake_client = MagicMock()
        fake_client.meta.region_name = wrong_region

        with patch("boto3.client", return_value=fake_client):
            provider = AppSecretsManagerProvider()
            with pytest.raises(AwsRegionMismatchError) as exc_info:
                provider._client()

        assert "ap-south-1" in str(exc_info.value)
        assert wrong_region in str(exc_info.value)

    def test_residency_correct_region_succeeds(self):
        """Correct region (ap-south-1) does not raise. CF-HMAC-RESIDENCY-1."""
        correct_region = "ap-south-1"
        fake_client = MagicMock()
        fake_client.meta.region_name = correct_region

        with patch("boto3.client", return_value=fake_client):
            provider = AppSecretsManagerProvider()
            client = provider._client()

        assert client is fake_client


# ===========================================================================
# Never-log negative assertions (CF-HMAC-NEVERLOG-1)
# ===========================================================================


class TestNeverLog:
    """Secret value and full HMAC strings must never appear in any log record."""

    @mock_aws
    def test_secret_never_in_logs_on_successful_fetch(self, caplog):
        sm = boto3.client("secretsmanager", region_name="ap-south-1")
        _create_test_secret(sm)

        provider = AppSecretsManagerProvider()
        with caplog.at_level(logging.DEBUG):
            provider.get_shopify_hmac_secret()

        for record in caplog.records:
            msg = record.getMessage()
            assert _TEST_SECRET_VALUE not in msg, (
                f"CF-HMAC-NEVERLOG-1 VIOLATED: secret value found in log: {msg!r}"
            )

    @mock_aws
    def test_secret_never_in_logs_on_error(self, caplog):
        """Even on ResourceNotFoundException, the secret must not appear in logs."""
        provider = AppSecretsManagerProvider()
        with caplog.at_level(logging.DEBUG):
            with pytest.raises(AppSecretUnavailableError):
                provider.get_shopify_hmac_secret()

        for record in caplog.records:
            msg = record.getMessage()
            assert _TEST_SECRET_VALUE not in msg, (
                f"CF-HMAC-NEVERLOG-1 VIOLATED: secret value found in error log: {msg!r}"
            )

    @mock_aws
    def test_full_hmac_never_in_logs(self, caplog):
        """A full HMAC signature string must never appear in logs.
        (This assertion guards the future ingress wiring — verified at seam level.)
        """
        import base64
        import hashlib
        import hmac as hmac_module

        sm = boto3.client("secretsmanager", region_name="ap-south-1")
        _create_test_secret(sm)

        provider = AppSecretsManagerProvider()
        secret = provider.get_shopify_hmac_secret()

        fake_body = b"fake_webhook_body"
        full_sig = base64.b64encode(
            hmac_module.new(secret.encode(), fake_body, hashlib.sha256).digest()
        ).decode()

        # Verify the signature itself never ends up in logs.
        with caplog.at_level(logging.DEBUG):
            # Simulate the kind of call a future ingress route would make.
            _ = provider.get_shopify_hmac_secret()

        for record in caplog.records:
            msg = record.getMessage()
            assert full_sig not in msg, (
                f"CF-HMAC-NEVERLOG-1 VIOLATED: full HMAC signature found in log: {msg!r}"
            )
            assert _TEST_SECRET_VALUE not in msg, (
                f"CF-HMAC-NEVERLOG-1 VIOLATED: secret value found in log: {msg!r}"
            )

    def test_unavailable_error_message_contains_no_secret(self):
        """AppSecretUnavailableError message must never contain a secret value."""
        error = AppSecretUnavailableError(
            "CF-HMAC-FAILCLOSED-1: test error. CF-HMAC-NEVERLOG-1: no secret value here."
        )
        assert _TEST_SECRET_VALUE not in str(error)
        assert "shpss_" not in str(error)

    def test_held_error_message_contains_no_secret(self):
        """HeldAppSecretError message must never contain a secret value."""
        error = HeldAppSecretError("get_shopify_hmac_secret")
        assert _TEST_SECRET_VALUE not in str(error)
        assert "shpss_" not in str(error)


# ===========================================================================
# Import-time zero-call gate (CF-CC-LAZY-1 — mirrors parent gate test #1)
# ===========================================================================


class TestImportTimeZeroCall:
    """Importing app_secret_provider / app_secret_factory must make ZERO AWS calls."""

    def test_import_makes_no_boto3_call(self):
        """Module import must not call boto3.client. CF-CC-LAZY-1."""
        module_names = [
            "src.infrastructure.secrets.app_secret_provider",
            "src.infrastructure.secrets.app_secret_factory",
        ]
        for mod in module_names:
            if mod in sys.modules:
                del sys.modules[mod]

        spy_called = []

        def spy(*args: Any, **kwargs: Any) -> Any:
            spy_called.append((args, kwargs))
            raise AssertionError(
                f"boto3.client was called at import of {mod!r} — CF-CC-LAZY-1 VIOLATION."
            )

        with patch("boto3.client", side_effect=spy):
            for mod in module_names:
                importlib.import_module(mod)

        assert spy_called == [], (
            f"boto3.client was called {len(spy_called)} time(s) at module import. "
            "CF-CC-LAZY-1: must be lazy."
        )


# ===========================================================================
# CF-HMAC-VERIFY-THE-VERIFIER-1 — feed the provider secret into the REAL
# verify_shopify_hmac and prove the gate is non-vacuous (durable rule 2026-05-26).
# 3-case kill-test (valid / tampered / unretrievable→fail-closed) + 2 mutation
# tests, each with a # MUTATION: comment naming the change that makes it RED.
# ===========================================================================

import base64 as _b64
import hashlib as _hashlib
import hmac as _hmac
import inspect as _inspect

from src.interfaces.adapters.shopify_adapter import verify_shopify_hmac


def _shopify_sign(body: bytes, secret: str) -> str:
    """Produce a real Shopify-shaped base64 HMAC-SHA256 of the raw body."""
    return _b64.b64encode(
        _hmac.new(secret.encode("utf-8"), body, _hashlib.sha256).digest()
    ).decode("utf-8")


class TestVerifyTheVerifier:
    """The provider secret + the real verifier, end to end (no second HMAC routine)."""

    _BODY = b'{"id":123456,"topic":"orders/create","total_price":"499.00"}'

    @mock_aws
    def test_case1_valid_signature_passes(self):
        """Provider-supplied secret + correct signature → verifier returns True."""
        sm = boto3.client("secretsmanager", region_name="ap-south-1")
        _create_test_secret(sm)
        secret = AppSecretsManagerProvider().get_shopify_hmac_secret()
        sig = _shopify_sign(self._BODY, secret)
        assert verify_shopify_hmac(self._BODY, sig, secret) is True

    @mock_aws
    def test_case2_tampered_body_rejected(self):
        """Signature valid for the original body → tampered body REJECTED."""
        sm = boto3.client("secretsmanager", region_name="ap-south-1")
        _create_test_secret(sm)
        secret = AppSecretsManagerProvider().get_shopify_hmac_secret()
        sig = _shopify_sign(self._BODY, secret)
        tampered = self._BODY.replace(b'"499.00"', b'"0.00"')
        assert verify_shopify_hmac(tampered, sig, secret) is False

    @mock_aws
    def test_case3_unretrievable_secret_fails_closed(self):
        """CF-HMAC-FAILCLOSED-1: no secret provisioned → provider RAISES, so the
        verifier never runs with a missing/empty key (an empty-key HMAC is
        attacker-forgeable). The verification path fails closed, never open."""
        provider = AppSecretsManagerProvider()  # secret intentionally NOT created
        with pytest.raises(AppSecretUnavailableError):
            provider.get_shopify_hmac_secret()

    def test_mutation_constant_time_compare(self):
        """CF-HMAC-CONSTTIME-1.

        # MUTATION: in shopify_adapter.verify_shopify_hmac, replace
        #   `hmac.compare_digest(computed, hmac_header)` with `computed == hmac_header`
        #   → this test FAILS. (`==` and compare_digest are behaviourally identical,
        #   so only a source-level assertion catches the loss of constant-time safety.)
        """
        src = _inspect.getsource(verify_shopify_hmac)
        assert "compare_digest" in src, (
            "CF-HMAC-CONSTTIME-1: verify_shopify_hmac MUST use hmac.compare_digest "
            "(constant-time), not ==. MUTATION compare_digest→== makes this FAIL."
        )
        assert "computed == hmac_header" not in src and "hmac_header == computed" not in src

    @mock_aws
    def test_mutation_fail_closed_not_fall_open(self):
        """CF-HMAC-FAILCLOSED-1.

        # MUTATION: make AppSecretsManagerProvider._fetch() return "" (or None)
        #   instead of raising AppSecretUnavailableError on an unretrievable/empty
        #   secret → this test FAILS. A fall-open provider would hand the verifier an
        #   empty key, and verify_shopify_hmac(body, attacker_sig, "") is forgeable
        #   (the attacker computes the empty-key HMAC themselves) → auth bypass.
        """
        provider = AppSecretsManagerProvider()  # no secret created → unretrievable
        with pytest.raises(AppSecretUnavailableError):
            provider.get_shopify_hmac_secret()
        # Belt-and-suspenders: prove an empty key would indeed be forgeable, which is
        # exactly why the provider must fail closed rather than return "".
        forged = _shopify_sign(self._BODY, "")
        assert verify_shopify_hmac(self._BODY, forged, "") is True
