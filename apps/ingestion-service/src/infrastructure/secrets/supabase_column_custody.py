"""
Supabase-column custody backing — Option B stub.

@paradigm: sql (no ML, no LLM)

CF-C3-SECRETS-INTERIM-1 / Option B:
  Sugandh-Lok-only interim: the legacy Supabase DB column IS the interim
  credential store, read over an RLS-session-scoped Postgres connection
  (with_workspace P1). Seal = encrypt the credential column.

  Activated ONLY when the Founder ratifies Option B in writing with:
    (i)  Supabase ap-south-1 AES-256 at-rest encryption confirmed active
    (ii) WS-1 activates BEFORE any second workspace's credentials are stored

HOLD-AT-CUTOVER: this backing is STUBBED this child.
  The real implementation is a Stage-8 artifact.

NEVER log or serialize Credential.content.
"""

from __future__ import annotations

import json
from typing import Any

from src.domain.framework.adapter import Credential
from src.infrastructure.db.session_context import with_workspace
from src.infrastructure.secrets.custody import CredentialCustody


class SupabaseColumnCustody:
    """
    Option B backing: Supabase DB column credential store (Sugandh-Lok-only interim).

    Table: workspace_connector_credentials (workspace_id, vendor, credential_enc, updated_at)
    Access: read over with_workspace() — the RLS policy scopes reads to the
            correct workspace. Seal = encrypt the credential_enc column in-place.

    STUBBED — raises NotImplementedError in all methods until Stage-8 activation.
    The Founder's selection of Option B + written ratification makes this live.
    """

    async def get(self, workspace_id: str, vendor: str) -> Credential:
        """
        [STUB — Option B, HOLD-AT-CUTOVER]
        Real implementation:
          async with with_workspace(workspace_id, ...) as conn:
              row = await conn.fetchone(
                  "SELECT credential_enc FROM workspace_connector_credentials
                   WHERE workspace_id = %s AND vendor = %s",
                  (workspace_id, vendor)
              )
              content = json.loads(row["credential_enc"])   # or decrypt if AES-enc
              return Credential(workspace_id=workspace_id, vendor=vendor, content=content)
        NEVER log content.
        """
        raise NotImplementedError(
            "[SupabaseColumnCustody.get] STUB — Option B not yet activated. "
            f"Would read credential for workspace_id={workspace_id!r} vendor={vendor!r}."
        )

    async def put(
        self,
        workspace_id: str,
        vendor: str,
        content: dict[str, Any],
    ) -> None:
        """
        [STUB — Option B, HOLD-AT-CUTOVER]
        Real implementation: UPSERT into workspace_connector_credentials.
        Called at STEP 1 of the Stage-8 ceremony.
        """
        raise NotImplementedError(
            "[SupabaseColumnCustody.put] STUB — Option B not yet activated. "
            f"Would write credential for workspace_id={workspace_id!r} vendor={vendor!r}."
        )

    async def seal(self, workspace_id: str, vendor: str) -> None:
        """
        [STUB — Option B, HOLD-AT-CUTOVER]
        Real implementation: encrypt the credential_enc column in-place
        (Supabase disk AES-256 + column-level hardening), then clear the
        plaintext column if dual-storage was used.
        Called at STEP 6 — LAST step, AFTER parity confirmed.
        """
        raise NotImplementedError(
            "[SupabaseColumnCustody.seal] STUB — Option B not yet activated. "
            f"Would seal credential for workspace_id={workspace_id!r} vendor={vendor!r}."
        )


# Runtime check: SupabaseColumnCustody satisfies the Protocol.
assert isinstance(SupabaseColumnCustody(), CredentialCustody)
