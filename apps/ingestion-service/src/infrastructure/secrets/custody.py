"""
Credential-custody interface (P4) — two stubbed backings.

@paradigm: sql (no ML, no LLM)

The Founder's Option A/B decision is a CONFIG/adapter swap, NOT a re-architecture.
This interface is built stubbed this child; the backing selection waits on the
Founder's decision (CF-C3-SECRETS-INTERIM-1, FIRED escalation).

Locked signature per §A0.5:
  class CredentialCustody(Protocol)
    async get(workspace_id, vendor) -> Credential
    async put(workspace_id, vendor, cred) -> None
    async seal(workspace_id, vendor) -> None   # delete/encrypt-in-place at cutover STEP 6

Both backings stubbed this child:
  aws_secrets_manager_custody.py  — Option A: IAM-scoped GetSecretValue, ap-south-1
  supabase_column_custody.py      — Option B: read over with_workspace RLS-session conn;
                                    seal = encrypt column

NEVER log or serialize Credential.content — it contains plaintext secrets.

App-level Shopify HMAC secret (SHOPIFY_CLIENT_SECRET) is a separate custody
line (config key shopify.app_hmac_secret) under whichever option.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from src.domain.framework.adapter import Credential


@runtime_checkable
class CredentialCustody(Protocol):
    """
    Interface for reading, writing, and sealing vendor credentials.

    The backing implementation is selected by Founder Option A or B
    (CF-C3-SECRETS-INTERIM-1). The ingest primitive (P2) holds a reference
    to whichever backing is configured — swapping the backing is a one-line
    config change, not a re-architecture.

    IMPORTANT: implementations MUST NOT log or serialize Credential.content.
    """

    async def get(self, workspace_id: str, vendor: str) -> Credential:
        """Retrieve the credential for (workspace_id, vendor).

        Raises KeyError if no credential is on record for this pair.
        """
        ...

    async def put(
        self,
        workspace_id: str,
        vendor: str,
        content: dict[str, Any],
    ) -> None:
        """Store / update the credential for (workspace_id, vendor).

        Called at STEP 1 of the Stage-8 HOLD-AT-CUTOVER ceremony.
        The content dict must never be logged.
        """
        ...

    async def seal(self, workspace_id: str, vendor: str) -> None:
        """
        Delete or encrypt-in-place the credential at cutover STEP 6.

        This is the LAST step of the ceremony (CF-C3-ROLLBACK-CRED-WINDOW-1 /
        CF-C3-DELETE-SEQUENCE-1). It is called ONLY AFTER:
          1. credential written to custody (STEP 1)
          2. live HTTP round-trip auth test passes (STEP 2)
          3. count-parity confirmed within window N (STEP 5)
        NEVER call seal() before the parity window closes.
        """
        ...
