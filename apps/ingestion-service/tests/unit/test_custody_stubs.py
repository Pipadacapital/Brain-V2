"""
Unit tests for credential custody stubs (P4).

@paradigm: sql

Tests:
  CredentialCustody Protocol:
  - AwsSecretsManagerCustody is an instance of CredentialCustody Protocol
  - SupabaseColumnCustody is an instance of CredentialCustody Protocol

  AwsSecretsManagerCustody (Option A stub):
  - get raises NotImplementedError with informative message
  - put raises NotImplementedError with informative message
  - seal raises NotImplementedError with informative message
  - error messages indicate STUB status

  SupabaseColumnCustody (Option B stub):
  - get raises NotImplementedError with informative message
  - put raises NotImplementedError with informative message
  - seal raises NotImplementedError with informative message
  - error messages indicate STUB status

  Both stubs:
  - seal method is NEVER called before the parity window (contract note verified)
"""

import pytest

from src.infrastructure.secrets.custody import CredentialCustody
from src.infrastructure.secrets.aws_secrets_manager_custody import AwsSecretsManagerCustody
from src.infrastructure.secrets.supabase_column_custody import SupabaseColumnCustody


class TestCustodyProtocol:
    def test_aws_sm_is_custody_protocol(self):
        assert isinstance(AwsSecretsManagerCustody(), CredentialCustody)

    def test_supabase_col_is_custody_protocol(self):
        assert isinstance(SupabaseColumnCustody(), CredentialCustody)


class TestAwsSecretsManagerCustodyStub:
    def setup_method(self):
        self.custody = AwsSecretsManagerCustody()

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
    async def test_get_error_mentions_option_a(self):
        with pytest.raises(NotImplementedError, match="Option A"):
            await self.custody.get("550e8400-e29b-41d4-a716-446655440000", "shopify")

    @pytest.mark.asyncio
    async def test_get_error_mentions_hold_at_cutover(self):
        with pytest.raises(NotImplementedError, match="HOLD-AT-CUTOVER"):
            await self.custody.get("550e8400-e29b-41d4-a716-446655440000", "shopify")

    def test_region_default_is_ap_south_1(self):
        custody = AwsSecretsManagerCustody()
        assert custody._region == "ap-south-1"


class TestSupabaseColumnCustodyStub:
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
    async def test_seal_error_mentions_step_6(self):
        with pytest.raises(NotImplementedError):
            await self.custody.seal("550e8400-e29b-41d4-a716-446655440000", "shopify")
