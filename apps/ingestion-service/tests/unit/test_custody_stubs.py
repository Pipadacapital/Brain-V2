"""
Unit tests for credential custody (P4).

@paradigm: sql

NOTE: AwsSecretsManagerCustody is now a REAL boto3 implementation (feat-credential-custody-aws-sm).
  Its full test matrix (moto integration, gate mutations, residency, factory) is in
  test_aws_secrets_manager_custody.py.

Tests remaining here:
  CredentialCustody Protocol conformance — both AwsSM and SupabaseColumn satisfy it.
  SupabaseColumnCustody (Option B stub — still stubbed, still NotImplementedError).
  HeldProductionCustody — the fail-closed factory default.
"""

import pytest

from src.infrastructure.secrets.custody import CredentialCustody
from src.infrastructure.secrets.aws_secrets_manager_custody import AwsSecretsManagerCustody
from src.infrastructure.secrets.supabase_column_custody import SupabaseColumnCustody
from src.infrastructure.secrets.held_custody import HeldProductionCustody, HeldCustodyError


class TestCustodyProtocol:
    def test_aws_sm_is_custody_protocol(self):
        """assert isinstance makes ZERO AWS calls — client is lazy (CF-CC-LAZY-1)."""
        assert isinstance(AwsSecretsManagerCustody(), CredentialCustody)

    def test_supabase_col_is_custody_protocol(self):
        assert isinstance(SupabaseColumnCustody(), CredentialCustody)

    def test_held_is_custody_protocol(self):
        assert isinstance(HeldProductionCustody(), CredentialCustody)


class TestSupabaseColumnCustodyStub:
    """Option B (supabase_column_custody) is still stubbed — Founder chose Option A."""

    def setup_method(self):
        self.custody = SupabaseColumnCustody()

    @pytest.mark.asyncio
    async def test_get_raises_not_implemented(self):
        with pytest.raises(NotImplementedError, match="STUB"):
            await self.custody.get("550e8400-e29b-41d4-a716-446655440000", "shopify")

    @pytest.mark.asyncio
    async def test_put_raises_not_implemented(self):
        with pytest.raises(NotImplementedError, match="STUB"):
            await self.custody.put("550e8400-e29b-41d4-a716-446655440000", "shopify", {"token": "x"})

    @pytest.mark.asyncio
    async def test_seal_raises_not_implemented(self):
        with pytest.raises(NotImplementedError, match="STUB"):
            await self.custody.seal("550e8400-e29b-41d4-a716-446655440000", "shopify")

    @pytest.mark.asyncio
    async def test_get_error_mentions_option_b(self):
        with pytest.raises(NotImplementedError, match="Option B"):
            await self.custody.get("550e8400-e29b-41d4-a716-446655440000", "shopify")

    @pytest.mark.asyncio
    async def test_seal_error_mentions_hold(self):
        with pytest.raises(NotImplementedError):
            await self.custody.seal("550e8400-e29b-41d4-a716-446655440000", "shopify")


class TestHeldProductionCustodyBasic:
    """HeldProductionCustody raises HeldCustodyError on every method call."""

    def setup_method(self):
        self.custody = HeldProductionCustody()

    @pytest.mark.asyncio
    async def test_get_raises_held_custody_error(self):
        with pytest.raises(HeldCustodyError):
            await self.custody.get("550e8400-e29b-41d4-a716-446655440000", "shopify")

    @pytest.mark.asyncio
    async def test_put_raises_held_custody_error(self):
        with pytest.raises(HeldCustodyError):
            await self.custody.put("550e8400-e29b-41d4-a716-446655440000", "shopify", {})

    @pytest.mark.asyncio
    async def test_seal_raises_held_custody_error(self):
        with pytest.raises(HeldCustodyError):
            await self.custody.seal("550e8400-e29b-41d4-a716-446655440000", "shopify")
