"""
App-level secret provider selector — mirrors custody_factory.py for the singleton shape.

@paradigm: sql (no ML, no LLM)

Mirrors custody_factory.select_custody() but for the app-level (singleton, no workspace_id)
HMAC secret path.  Uses the SAME CONNECTOR_CUSTODY_BACKING environment flag.

SELECTOR TABLE (CF-HMAC-RETRIEVAL-SHAPE-1):
  unset / '' / 'local' → EnvAppSecretProvider (DEV ONLY — reads SHOPIFY_CLIENT_SECRET env var).
  'aws-secrets-manager' → AppSecretsManagerProvider (real boto3, ap-south-1, cached).
  UNKNOWN value        → HeldAppSecretProvider (fail-closed, NEVER env/AWS).

CF-CC-GATE-1 (inherited): any unknown / unrecognised value ALWAYS fails closed to
HeldAppSecretProvider.  The AWS backing is reachable ONLY via the explicit string
'aws-secrets-manager'.

CF-CC-LAZY-1 (inherited): boto3 is NOT imported at module top-level.  The AWS provider
class is imported inside the 'aws-secrets-manager' branch only.  Importing this module
makes ZERO AWS calls.

CF-HMAC-FAILCLOSED-1 (CRIT): the default path (unset/local) returns EnvAppSecretProvider,
which itself raises AppSecretUnavailableError if SHOPIFY_CLIENT_SECRET is absent — so
even the dev path is fail-closed against an empty secret.  The 'unknown' path returns
HeldAppSecretProvider which raises on every access.

LOGGING:
  mirrors custody_factory.py:67 — `app_secret_factory: backing=%r → <ProviderClass>`.
  Never the secret value.
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)


def select_app_secret_provider(
    backing: str | None = None,
):
    """Return the configured app-level HMAC secret provider.

    Args:
        backing: The backing selector string.  Defaults to the
                 CONNECTOR_CUSTODY_BACKING environment variable value.
                 Pass explicitly in tests to avoid environment coupling.

    Returns:
        One of: AppSecretsManagerProvider, EnvAppSecretProvider,
                or HeldAppSecretProvider.

    CF-HMAC-RETRIEVAL-SHAPE-1: factory matrix.
    CF-CC-GATE-1 (inherited): unknown values fail closed to HeldAppSecretProvider.
    CF-CC-LAZY-1 (inherited): no boto3 client constructed until first get_shopify_hmac_secret() call.
    """
    # Resolve the backing value from the environment if not passed explicitly.
    # Mirrors custody_factory.py:62.
    effective = backing if backing is not None else os.environ.get("CONNECTOR_CUSTODY_BACKING")

    match effective:
        case None | "" | "local":
            # Unset, empty, or the explicit 'local' alias → dev env-var fallback.
            # CF-HMAC-RETRIEVAL-SHAPE-1: dev path; EnvAppSecretProvider reads
            # SHOPIFY_CLIENT_SECRET from the environment (still fail-closed if absent).
            from src.infrastructure.secrets.app_secret_provider import EnvAppSecretProvider

            logger.debug(
                "app_secret_factory: backing=%r → EnvAppSecretProvider (dev env fallback)",
                effective,
            )
            return EnvAppSecretProvider()

        case "aws-secrets-manager":
            # Explicit opt-in to the real AWS singleton backing.
            # Local import — CF-CC-LAZY-1: boto3 client is NOT built here.
            from src.infrastructure.secrets.app_secret_provider import AppSecretsManagerProvider

            logger.debug(
                "app_secret_factory: backing=%r → AppSecretsManagerProvider (ap-south-1)",
                effective,
            )
            return AppSecretsManagerProvider()

        case _:
            # CF-CC-GATE-1 / CF-HMAC-FAILCLOSED-1: UNKNOWN value → fail-closed.
            # An unknown / misspelled value MUST NOT silently activate any live backing.
            # HeldAppSecretProvider raises on every access — the webhook verifier REJECTS.
            from src.infrastructure.secrets.app_secret_provider import HeldAppSecretProvider

            logger.warning(
                "app_secret_factory: unknown backing=%r — failing closed to HeldAppSecretProvider. "
                "Valid values: unset/empty/local (env dev) or 'aws-secrets-manager' (AWS). "
                "CF-CC-GATE-1 / CF-HMAC-FAILCLOSED-1.",
                effective,
            )
            return HeldAppSecretProvider()
