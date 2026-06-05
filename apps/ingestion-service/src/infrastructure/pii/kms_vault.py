"""
KMS Vault — per-workspace PII salt store (P0-B DPDP GATE).

@paradigm: sql (no ML, no LLM; key-read only — I/O adapter, pure infra)

CF-C3-PII-TOKENIZER-1 / R1.3:
  Each workspace has a per-workspace salt stored as a KMS-wrapped secret in AWS
  Secrets Manager (reusing the CredentialCustodyStack envelope pattern from
  infra/cdk/bin/app.ts:15).  The salt is the HMAC key for pii_tokenizer.py.

  Secret naming convention:
    brain/{workspace_id}/pii_salt/{salt_version}

  The salt is APPEND-ONLY (never rotated in place).  On rotation a new version
  is created; the old version remains resolvable for replay stability (R1.4).

LOCAL DEVELOPMENT / CI:
  When BRAIN_PII_SALT_LOCAL_DEV is set, the vault returns a deterministic test
  salt WITHOUT any AWS call.  This allows unit tests + local dev to run without
  boto3 or real KMS.  NEVER set BRAIN_PII_SALT_LOCAL_DEV in production.

AUTHORED-NOT-DEPLOYED:
  Real AWS Secrets Manager / KMS provisioning is the Stage-8 console ceremony.
  This module reads an existing secret; it does NOT create the secret at runtime.
  The CDK construct (`infra/cdk/lib/bronze-storage-stack.ts`, P1-D) provisions
  the KMS key and secret namespace.  This vault is the read adapter.

NEVER-LOG:
  Only workspace_id, vendor (context), and salt_version are logged — never the
  salt bytes or any derivative.  CF-CC-NEVERLOG-1 applies.
"""

from __future__ import annotations

import hashlib
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_SECRET_PREFIX = "brain"
_SALT_VERSION_DEFAULT = "v1"
_REQUIRED_REGION = "ap-south-1"

# Local-dev sentinel env var.  When set (any non-empty value), the vault returns
# a deterministic per-workspace test salt derived purely from workspace_id.
# MUST NOT be set in production.
_LOCAL_DEV_ENV = "BRAIN_PII_SALT_LOCAL_DEV"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


class KmsVault:
    """
    Per-workspace PII salt vault (read adapter).

    Retrieves the HMAC salt for a given (workspace_id, salt_version) from AWS
    Secrets Manager.  The salt is used exclusively by pii_tokenizer.tokenize_event.

    Local dev / CI: set BRAIN_PII_SALT_LOCAL_DEV=true to skip AWS calls.
    """

    def __init__(self) -> None:
        # CF-CC-LAZY-1: boto3 client built on first real use.
        self._boto3_client: Any = None

    def _client(self) -> Any:
        """Lazily build and cache the boto3 secretsmanager client (ap-south-1)."""
        if self._boto3_client is None:
            import boto3  # noqa: PLC0415

            client = boto3.client("secretsmanager", region_name=_REQUIRED_REGION)
            effective = client.meta.region_name
            if effective != _REQUIRED_REGION:
                raise RuntimeError(
                    f"KmsVault: AWS client region is {effective!r}, "
                    f"expected {_REQUIRED_REGION!r}. DPDP residency requirement."
                )
            self._boto3_client = client
        return self._boto3_client

    def _secret_name(self, workspace_id: str, salt_version: str) -> str:
        """Return the Secrets Manager secret name for a (workspace_id, version) pair."""
        return f"{_SECRET_PREFIX}/{workspace_id}/pii_salt/{salt_version}"

    # ------------------------------------------------------------------
    # Main read method
    # ------------------------------------------------------------------

    async def get_salt(
        self,
        workspace_id: str,
        salt_version: str = _SALT_VERSION_DEFAULT,
    ) -> bytes:
        """
        Retrieve the per-workspace HMAC salt for the given salt_version.

        Local-dev / CI: when BRAIN_PII_SALT_LOCAL_DEV is set, returns a
        deterministic test salt (SHA-256 of workspace_id bytes).  NO AWS call.

        Production: reads from AWS Secrets Manager.  The secret value is the
        hex-encoded 32-byte salt.

        Args:
            workspace_id: The tenant workspace UUID string.
            salt_version: The salt version key (default "v1").

        Returns:
            32-byte HMAC salt as bytes.

        Raises:
            KeyError: if no salt is stored for this (workspace_id, salt_version).
            RuntimeError: on AWS errors (ids-only message; CF-CC-NEVERLOG-1).
        """
        if os.environ.get(_LOCAL_DEV_ENV, "").strip().lower() in ("1", "true", "yes"):
            # Local-dev deterministic salt — never log the value.
            salt = self._local_dev_salt(workspace_id, salt_version)
            logger.debug(
                "kms_vault.get_salt: LOCAL_DEV mode workspace_id=%r salt_version=%r",
                workspace_id,
                salt_version,
            )
            return salt

        return await self._fetch_from_secrets_manager(workspace_id, salt_version)

    async def _fetch_from_secrets_manager(
        self,
        workspace_id: str,
        salt_version: str,
    ) -> bytes:
        """Read the salt hex from AWS Secrets Manager and decode to bytes."""
        import botocore.exceptions  # noqa: PLC0415

        secret_name = self._secret_name(workspace_id, salt_version)
        logger.debug(
            "kms_vault.get_salt: op=get workspace_id=%r salt_version=%r secret_name=%r",
            workspace_id,
            salt_version,
            secret_name,
        )
        try:
            response = self._client().get_secret_value(
                SecretId=secret_name,
                VersionStage="AWSCURRENT",
            )
            # Secret value is the hex-encoded 32-byte salt string.
            # CF-CC-NEVERLOG-1: never log the SecretString value.
            salt_hex: str = response["SecretString"].strip()
            salt_bytes = bytes.fromhex(salt_hex)
            logger.info(
                "kms_vault.get_salt: op=get workspace_id=%r salt_version=%r outcome=ok",
                workspace_id,
                salt_version,
            )
            return salt_bytes
        except botocore.exceptions.ClientError as exc:
            error_code = exc.response["Error"]["Code"]
            if error_code == "ResourceNotFoundException":
                raise KeyError(
                    f"No PII salt found for workspace_id={workspace_id!r} "
                    f"salt_version={salt_version!r} (secret_name={secret_name!r}). "
                    "Provision via the Stage-8 ceremony or set BRAIN_PII_SALT_LOCAL_DEV."
                ) from None
            raise RuntimeError(
                f"kms_vault.get_salt failed for workspace_id={workspace_id!r} "
                f"salt_version={salt_version!r}: AWS error_code={error_code!r}. "
                "CF-CC-NEVERLOG-1."
            ) from None

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _local_dev_salt(workspace_id: str, salt_version: str) -> bytes:
        """
        Deterministic test salt for LOCAL DEV / CI only.

        Derived as SHA-256(workspace_id + ":" + salt_version) so:
          - Same workspace → same salt across test runs (stable tokens in tests).
          - Different workspace → different salt (cross-workspace isolation holds).
          - Different salt_version → different salt (rotation semantics preserved).
        NEVER use in production.
        """
        raw = f"{workspace_id}:{salt_version}".encode("utf-8")
        return hashlib.sha256(raw).digest()
