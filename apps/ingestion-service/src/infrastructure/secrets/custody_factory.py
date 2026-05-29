"""
Credential custody backing selector — Python mirror of custody-factory.ts.

@paradigm: sql (no ML, no LLM)

Mirrors core-service/src/infrastructure/secrets/custody-factory.ts:selectCustody().

CONNECTOR_CUSTODY_BACKING selects the at-rest custody backing:
  unset / '' / 'local' → HeldProductionCustody (fail-closed default).
  'aws-secrets-manager' → AwsSecretsManagerCustody (real boto3, ap-south-1).
  UNKNOWN value        → HeldProductionCustody (fail-closed, NEVER AWS).

CF-CC-GATE-1: unknown / unrecognised values ALWAYS fail closed to HeldProductionCustody.
  The AWS backing is reachable ONLY via the explicit string 'aws-secrets-manager'.
  This mirrors the TS default: branch catches everything unknown and returns Held.

CF-CC-LAZY-1: boto3 is NOT imported at module top-level. The AWS class is imported
  inside the 'aws-secrets-manager' branch only, and even there no boto3 client is
  constructed at import time (the client is lazy in AwsSecretsManagerCustody._client()).
  Importing this module (or constructing a HeldProductionCustody instance) makes
  ZERO AWS network calls.

NOTE on TS vs Python differences:
  - TS local default is 'local-aesgcm' (a real AES-256-GCM Python-local backing).
  - Python has NO LocalAesGcmCustody equivalent (TS-only). The Python ingest path
    in local-dev runs dry_run/seeded; no custody calls reach the factory.
  - Python default is therefore HeldProductionCustody (a clear error on use) — this
    is consistent with the fail-closed posture and avoids building a Python crypto
    backing out-of-scope for this child.
  - 'local' as an alias for 'unset' keeps local-dev explicit names working if ever used.
"""

from __future__ import annotations

import logging
import os

from src.infrastructure.secrets.custody import CredentialCustody
from src.infrastructure.secrets.held_custody import HeldProductionCustody

logger = logging.getLogger(__name__)


def select_custody(
    backing: str | None = None,
) -> CredentialCustody:
    """Return the configured credential custody backing.

    Args:
        backing: The backing selector string. Defaults to the
                 CONNECTOR_CUSTODY_BACKING environment variable value.
                 Pass explicitly in tests to avoid environment coupling.

    Returns:
        CredentialCustody implementation per the selector table.

    CF-CC-GATE-1: any unknown value returns HeldProductionCustody, never AWS.
    CF-CC-LAZY-1: no boto3 client is constructed until the first get/put/seal call.
    """
    # Resolve the backing value from the environment if not passed explicitly.
    # This mirrors the TS pattern: process.env['CONNECTOR_CUSTODY_BACKING']
    effective = backing if backing is not None else os.environ.get("CONNECTOR_CUSTODY_BACKING")

    match effective:
        case None | "" | "local":
            # Unset, empty, or the explicit 'local' alias → fail-closed held default.
            logger.debug(
                "custody_factory: backing=%r → HeldProductionCustody (fail-closed default)",
                effective,
            )
            return HeldProductionCustody()

        case "aws-secrets-manager":
            # Explicit opt-in to the real AWS backing.
            # The import is local to this branch (CF-CC-LAZY-1): importing the
            # module here does NOT construct a boto3 client — the client is built
            # lazily in AwsSecretsManagerCustody._client() on first AWS call.
            from src.infrastructure.secrets.aws_secrets_manager_custody import (
                AwsSecretsManagerCustody,
            )

            logger.debug(
                "custody_factory: backing=%r → AwsSecretsManagerCustody (ap-south-1)",
                effective,
            )
            return AwsSecretsManagerCustody()

        case _:
            # CF-CC-GATE-1: UNKNOWN value → fail-closed, NEVER AWS.
            # An unknown / misspelled value must NOT silently activate the AWS backing.
            # This is the critical safety property: any drift in the env var name
            # or a typo lands here, not in the AWS branch.
            logger.warning(
                "custody_factory: unknown backing=%r — failing closed to HeldProductionCustody. "
                "Valid values: unset/empty/local (held) or 'aws-secrets-manager' (AWS). "
                "CF-CC-GATE-1.",
                effective,
            )
            return HeldProductionCustody()
