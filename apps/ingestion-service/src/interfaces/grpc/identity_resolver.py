"""
Generic connector identity → workspace-id resolver — system-scoped lookup.

@paradigm: sql (no ML, no LLM, ₹0)

Paradigm justified: this is a composite-PK point-lookup on connector_identity_map
(vendor, external_identity).  Constant-time; no inference or probabilistic component.

CF contract:
  MAP-AFTER-VERIFY-1 (CRIT) — this function is called ONLY post-verify.
    The servicer guarantees that no call to this function occurs before
    the vendor's verify_fn returns True.  This is the second half of the
    two-part tenant-boundary guarantee.
  VENDOR-REGISTRY-DISPATCH-1 (CRIT) — vendor is passed as a parameter;
    there is NO hardcoded vendor-literal branch here.  The PK lookup is
    `WHERE vendor = $1 AND external_identity = $2` — generic.
  NO-HARDCODED-VENDOR-1 (HIGH) — zero vendor-literal branches in this module.
  NEVERLOG-1 (VETO Shreya) — only vendor + external_identity (post-verify) and
    outcome logged; no PII, no secret, no signature.

RLS asymmetry (§5 / §11 architecture plan):
  connector_identity_map is read system-scoped BEFORE a workspace session is
  established — it IS the thing that produces the workspace_id.  The
  subsequent PII write into raw_shopify_orders goes through the existing
  with_workspace (P1) path inside _upsert_event.  This asymmetry is
  intentional and documented for Shreya's review.
  The lookup reads at most ONE row (WHERE vendor = $1 AND external_identity = $2
  on the composite PK) and returns only the workspace_id UUID — no other row,
  no other column.

Schema (connector_identity_map):
  PRIMARY KEY (vendor, external_identity)
  Shopify row: ('shopify', 'sugandhlok.myshopify.com', <workspace_uuid>, now())
  Meta row:    ('meta', '<page_id>', <workspace_uuid>, now())   — when onboarded
"""

from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)


async def resolve_identity_workspace(
    vendor: str,
    external_identity: str,
    *,
    db_url: Optional[str] = None,
) -> Optional[str]:
    """
    Resolve a (vendor, external_identity) pair to a workspace_id.

    @paradigm: sql

    System-scoped composite-PK point-lookup on connector_identity_map.
    Returns the workspace_id UUID string if found, None if unmapped.

    MAP-AFTER-VERIFY-1 (CRIT): must ONLY be called post-verify.
    VENDOR-REGISTRY-DISPATCH-1: vendor is a parameter — no hardcoded literal branch.
    RLS asymmetry: reads without a workspace session — intentional (see module docstring).
    NEVERLOG-1: only vendor + external_identity (post-verify) and outcome logged.

    Args:
        vendor:             The vendor key (e.g. "shopify"). Parameter, not a branch.
        external_identity:  The vendor-specific identity value (e.g. "sugandhlok.myshopify.com").
                            Trusted POST-verify only (MAP-AFTER-VERIFY-1).
        db_url:             Optional override for DATABASE_URL (used in tests).

    Returns:
        The workspace_id UUID string if the identity is mapped, else None.
    """
    if not vendor:
        logger.warning(
            "identity_resolver: empty vendor — treating as unmapped. outcome=none"
        )
        return None

    if not external_identity:
        logger.warning(
            "identity_resolver: empty external_identity vendor=%s "
            "— treating as unmapped. outcome=none",
            vendor,
        )
        return None

    url = db_url or os.environ.get("DATABASE_URL", "")
    if not url:
        # No DB available (unit-test mode with no DATABASE_URL) — treat as unmapped.
        # Integration tests inject db_url directly.
        logger.debug(
            "identity_resolver: no DATABASE_URL — cannot resolve "
            "vendor=%s external_identity=%s. outcome=none",
            vendor,
            external_identity,
        )
        return None

    try:
        import psycopg
        # System-scoped read: no SET app.workspace_id, no SET ROLE.
        # Composite-PK point-lookup (MAP-AFTER-VERIFY-1 / RLS-asymmetry §5).
        # VENDOR-REGISTRY-DISPATCH-1: vendor is $1 parameter, not a literal branch.
        async with await psycopg.AsyncConnection.connect(url, autocommit=True) as conn:
            row = await conn.execute(
                "SELECT workspace_id FROM connector_identity_map "
                "WHERE vendor = %s AND external_identity = %s",
                (vendor, external_identity),
            )
            result = await row.fetchone()

        if result is None:
            logger.info(
                "identity_resolver: vendor=%s external_identity=%s outcome=unmapped",
                vendor,
                external_identity,
            )
            return None

        workspace_id = str(result[0])
        logger.debug(
            "identity_resolver: vendor=%s external_identity=%s outcome=mapped",
            vendor,
            external_identity,
        )
        return workspace_id

    except Exception as exc:
        # Treat any DB error as unmapped — do not expose internal error to caller.
        # The servicer returns PARKED on None, which is safe (no write, 200 response).
        logger.error(
            "identity_resolver: vendor=%s external_identity=%s outcome=error error=%s",
            vendor,
            external_identity,
            type(exc).__name__,
        )
        return None
