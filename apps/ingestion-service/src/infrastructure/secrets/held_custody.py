"""
HeldProductionCustody — fail-closed default backing for the Python custody factory.

@paradigm: sql (no ML, no LLM)

Mirrors core-service/src/infrastructure/secrets/production-custody.ts:HeldProductionCustody.

This is the DEFAULT backing returned by custody_factory.select_custody() when
CONNECTOR_CUSTODY_BACKING is unset, empty, 'local', or any UNKNOWN value.
Every method raises HeldCustodyError immediately — there is no live path through
this class. This is intentional: fail-closed is the correct default.

ACTIVATION GATE (CF-CC-GATE-1):
  The ONLY way to reach the real AWS backing is:
    1. Founder decision Option A on record (done: 2026-05-29).
    2. Set CONNECTOR_CUSTODY_BACKING=aws-secrets-manager explicitly.
    3. custody_factory.select_custody() returns AwsSecretsManagerCustody.
  Any other value — including an unknown/misspelled value — keeps this backing.

DPDP ERASURE PATH (CF-CC-ERASURE-PATH-1):
  Workspace off-boarding erasure for the real AWS backing is:
    - Call seal() for each of the workspace's known vendors:
        seal(workspace_id, "shopify"), seal(workspace_id, "shiprocket"), ...
    - seal() issues delete_secret(RecoveryWindowInDays=7) — the 7-day recovery
      window is the bounded retention tail.
    - "Sealed" does NOT mean irrecoverable for 7 days. This must be stated in
      the erasure runbook so it is not a compliance surprise.
    - No bulk "delete all secrets for workspace" API is built; the path is
      composable from the per-vendor seal().
  This note lives here (not in AwsSecretsManagerCustody) so it is visible
  even when the AWS backing is HELD.
"""

from __future__ import annotations

from typing import Any

from src.domain.framework.adapter import Credential
from src.infrastructure.secrets.custody import CredentialCustody


class HeldCustodyError(NotImplementedError):
    """Raised when the production custody backing is not yet activated.

    The real AWS Secrets Manager backing requires an explicit opt-in via
    CONNECTOR_CUSTODY_BACKING=aws-secrets-manager (CF-CC-GATE-1).
    The Python ingest path in local-dev runs dry_run/seeded — no custody
    calls are made without the explicit opt-in.
    """

    def __init__(self, method: str) -> None:
        super().__init__(
            f"[HeldProductionCustody.{method}] HELD — CF-CC-GATE-1 / CF-C7-CUSTODY-PROOF-1. "
            "The real AWS Secrets Manager backing is not yet activated. "
            "Set CONNECTOR_CUSTODY_BACKING=aws-secrets-manager to opt in "
            "(requires Founder Option-A decision + Stage-8 ceremony). "
            "The Python ingest path in local-dev runs dry_run/seeded — "
            "no custody calls should reach this backing in normal local-dev."
        )
        self.name = "HeldCustodyError"


class HeldProductionCustody:
    """
    Fail-closed default credential custody backing.

    Mirrors HeldProductionCustody in core-service/production-custody.ts.
    Every method raises HeldCustodyError — this class has no live path.
    It is the correct default: wrong-direction failures surface immediately
    rather than silently bypassing the gate.

    Protocol-conformant: assert isinstance(HeldProductionCustody(), CredentialCustody).
    """

    async def get(self, workspace_id: str, vendor: str) -> Credential:
        raise HeldCustodyError("get")

    async def put(
        self,
        workspace_id: str,
        vendor: str,
        content: dict[str, Any],
    ) -> None:
        raise HeldCustodyError("put")

    async def seal(self, workspace_id: str, vendor: str) -> None:
        raise HeldCustodyError("seal")


# Runtime Protocol check — makes zero AWS calls (this class has no boto3 dependency).
assert isinstance(HeldProductionCustody(), CredentialCustody)
