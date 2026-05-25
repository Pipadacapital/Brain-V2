"""
AWS Secrets Manager custody backing — Option A stub.

@paradigm: sql (no ML, no LLM)

CF-C3-SECRETS-INTERIM-1 / Option A:
  IAM-scoped GetSecretValue, ap-south-1 region.
  Activated when the Founder chooses Option A (provision AWS Secrets Manager
  in ap-south-1, rotate connector OAuth tokens/API keys into it, ingest-service
  reads via IAM-scoped GetSecretValue — no plaintext in DB columns post-rotation).

HOLD-AT-CUTOVER: this backing is STUBBED this child.
  The real implementation is a Stage-8 artifact, enabled after:
  (1) Founder selects Option A in writing
  (2) WS-1 (chore-security-governance-hardening-phase) is activated
  (3) AWS Secrets Manager is provisioned in ap-south-1
  (4) Connector credentials are rotated into it

NEVER log or serialize Credential.content.
"""

from __future__ import annotations

from typing import Any

from src.domain.framework.adapter import Credential
from src.infrastructure.secrets.custody import CredentialCustody


class AwsSecretsManagerCustody:
    """
    Option A backing: AWS Secrets Manager (ap-south-1).

    Secret path convention: brain/{workspace_id}/{vendor}/credential
    IAM policy: allow GetSecretValue on arn:aws:secretsmanager:ap-south-1:*:secret:brain/*

    STUBBED — raises NotImplementedError in all methods until Stage-8 activation.
    The Founder's selection of Option A makes this the live backing.
    """

    def __init__(self, region: str = "ap-south-1") -> None:
        self._region = region
        # boto3 client would be initialised here in the real implementation.
        # Not initialised in the stub to avoid an undeclared boto3 dependency.

    def _secret_name(self, workspace_id: str, vendor: str) -> str:
        return f"brain/{workspace_id}/{vendor}/credential"

    async def get(self, workspace_id: str, vendor: str) -> Credential:
        """
        [STUB — Option A, HOLD-AT-CUTOVER]
        Real implementation: boto3 get_secret_value(SecretId=..., VersionStage='AWSCURRENT')
        The response SecretString is JSON-decoded into content.
        NEVER log the content.
        """
        raise NotImplementedError(
            "[AwsSecretsManagerCustody.get] STUB — Option A not yet activated. "
            "HOLD-AT-CUTOVER: activate after Founder selects Option A and WS-1 is provisioned. "
            f"Secret would be at: {self._secret_name(workspace_id, vendor)!r}"
        )

    async def put(
        self,
        workspace_id: str,
        vendor: str,
        content: dict[str, Any],
    ) -> None:
        """
        [STUB — Option A, HOLD-AT-CUTOVER]
        Real implementation: boto3 create_secret / put_secret_value.
        Called at STEP 1 of the Stage-8 ceremony.
        """
        raise NotImplementedError(
            "[AwsSecretsManagerCustody.put] STUB — Option A not yet activated. "
            f"Would write to: {self._secret_name(workspace_id, vendor)!r}"
        )

    async def seal(self, workspace_id: str, vendor: str) -> None:
        """
        [STUB — Option A, HOLD-AT-CUTOVER]
        Real implementation: boto3 delete_secret (with recovery window=7 days).
        Called at STEP 6 — LAST step, AFTER parity confirmed.
        """
        raise NotImplementedError(
            "[AwsSecretsManagerCustody.seal] STUB — Option A not yet activated. "
            f"Would schedule deletion of: {self._secret_name(workspace_id, vendor)!r}"
        )


# Runtime check: AwsSecretsManagerCustody satisfies the Protocol.
assert isinstance(AwsSecretsManagerCustody(), CredentialCustody)
