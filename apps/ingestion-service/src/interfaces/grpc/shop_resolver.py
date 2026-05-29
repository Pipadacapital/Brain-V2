"""
Shop-domain to workspace-id resolver — system-scoped single-row lookup.

@paradigm: sql (no ML, no LLM, ₹0)

Paradigm justified: this is a single-column point-lookup on the connector_shop_map
PRIMARY KEY (shop_domain).  Constant-time; no inference or probabilistic component.

CF contract:
  MAP-AFTER-VERIFY-1 (CRIT) — this function is called ONLY post-verify.
    The servicer guarantees that no call to this function occurs before
    verify_shopify_hmac returns True.  This is the second half of the
    two-part tenant-boundary guarantee.
  NEVERLOG-1 (VETO Shreya) — only shop_domain (post-verify) and outcome logged;
    no PII, no secret, no signature.

RLS asymmetry (§5 / §11 architecture plan):
  connector_shop_map is read system-scoped BEFORE a workspace session is
  established — it IS the thing that produces the workspace_id.  The
  subsequent PII write into raw_shopify_orders goes through the existing
  with_workspace (P1) path inside _upsert_event.  This asymmetry is
  intentional and documented for Shreya's review.
  The lookup reads at most ONE row (WHERE shop_domain = $1 on the PK) and
  returns only the workspace_id UUID — no other row, no other column.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)


async def resolve_shop_workspace(
    shop_domain: str,
    *,
    db_url: Optional[str] = None,
) -> Optional[str]:
    """
    Resolve a Shopify shop_domain to a workspace_id.

    @paradigm: sql

    System-scoped point-lookup on connector_shop_map.shop_domain (PK).
    Returns the workspace_id UUID string if found, None if unmapped.

    MAP-AFTER-VERIFY-1 (CRIT): must ONLY be called post-verify.
    RLS asymmetry: reads without a workspace session — intentional (see module docstring).
    NEVERLOG-1: only shop_domain (post-verify) and outcome logged; no secret or PII.

    Args:
        shop_domain: the X-Shopify-Shop-Domain header value (post-verify).
        db_url: optional override for the DATABASE_URL (used in tests).

    Returns:
        The workspace_id UUID string if the shop is mapped, else None.
    """
    if not shop_domain:
        logger.warning(
            "shop_resolver: empty shop_domain — treating as unmapped. "
            "outcome=none"
        )
        return None

    url = db_url or os.environ.get("DATABASE_URL", "")
    if not url:
        # No DB available (unit-test mode with no DATABASE_URL) — treat as unmapped.
        # Integration tests inject db_url directly.
        logger.debug(
            "shop_resolver: no DATABASE_URL — cannot resolve shop_domain=%s. "
            "outcome=none",
            shop_domain,
        )
        return None

    try:
        import psycopg
        # System-scoped read: no SET app.workspace_id, no SET ROLE.
        # Single-row point-lookup on the PK (MAP-AFTER-VERIFY-1 / RLS-asymmetry §5).
        async with await psycopg.AsyncConnection.connect(url, autocommit=True) as conn:
            row = await conn.execute(
                "SELECT workspace_id FROM connector_shop_map WHERE shop_domain = %s",
                (shop_domain,),
            )
            result = await row.fetchone()

        if result is None:
            logger.info(
                "shop_resolver: shop_domain=%s outcome=unmapped",
                shop_domain,
            )
            return None

        workspace_id = str(result[0])
        logger.debug(
            "shop_resolver: shop_domain=%s outcome=mapped",
            shop_domain,
        )
        return workspace_id

    except Exception as exc:
        # Treat any DB error as unmapped — do not expose internal error to caller.
        # The servicer returns PARKED on None, which is safe (no write, 200 response).
        logger.error(
            "shop_resolver: shop_domain=%s outcome=error error=%s",
            shop_domain,
            type(exc).__name__,
        )
        return None
