"""
AWS Secrets Manager custody backing — Option A (real boto3 implementation).

@paradigm: sql (no ML, no LLM)

CF-C3-SECRETS-INTERIM-1 / Option A:
  Founder selected Option A (AWS Secrets Manager, ap-south-1) on 2026-05-29.
  This build satisfies CF-C7-CUSTODY-PROOF-1 (real get/put/seal, non-NotImplementedError).

WHAT IS LIVE VS HELD:
  LIVE this build: the boto3 code path (tested via moto), factory gate, lazy client,
    residency assert, input validation, ids-only logging. Zero real AWS calls.
  HELD (Stage-8 ceremony, Founder-gated, CF-CC-NO-LIVE-1 / CF-CC-C7-LEG-1):
    - Real AWS Secrets Manager provisioning in ap-south-1.
    - CDK stack deploy (infra/cdk/ — authored this build, not deployed).
    - IAM role creation and least-privilege policy attachment.
    - Live token rotation into Secrets Manager.
    - Legacy-plaintext DELETE point-of-no-return.
    - Vendor-200 count parity leg + parity GREEN.

SECRET NAME CONVENTION (CF-CC-WS-ISOLATION-1):
  brain/{workspace_id}/{vendor}/credential

  Examples:
    brain/550e8400-e29b-41d4-a716-446655440000/shopify/credential
    brain/550e8400-e29b-41d4-a716-446655440000/shiprocket/credential

  _secret_name() validates both workspace_id and vendor: empty, None, whitespace-only,
  path-traversal characters ('/', '..'), and wildcard ('*') are all rejected with
  ValueError carrying only the offending id — never credential content.

LAZY CLIENT (CF-CC-LAZY-1):
  The boto3 client is constructed on FIRST USE only, via _client().
  __init__ does NOT call boto3. Module-level import does NOT call boto3.
  The module-load `assert isinstance(...)` constructs the class without a client.
  A spy on boto3.client will NEVER fire at import time.

RESIDENCY (CF-CC-RESIDENCY-1):
  Client is built with region_name="ap-south-1" hard-coded.
  A construction-time assert refuses to start if the effective region != "ap-south-1".
  This mirrors the analytics-service assert_clickhouse_residency pattern
  (apps/analytics-service/src/bootstrap/analytics_service_startup.py:49).

NEVER-LOG (CF-CC-NEVERLOG-1, Shreya VETO):
  All log/exception paths carry ONLY (workspace_id, vendor, secret_name, op, outcome).
  SecretString / Credential.content / token text MUST NEVER appear in any log,
  exception message, or raised exception string.
  boto3 ClientError.str() can echo request params — caught and re-raised
  with ids-only messages to prevent inadvertent leakage.

SEAL RECOVERY (CF-CC-SEAL-RECOVERY-1):
  seal() calls delete_secret(SecretId=..., RecoveryWindowInDays=7).
  ForceDeleteWithoutRecovery is FORBIDDEN anywhere in this file.
  The 7-day window is mandatory: Shiprocket credentials have no replay; an
  irreversible delete would destroy the ability to recover from a failed ceremony.

SHOPIFY HMAC NOTE (CF-CC-SHOPIFY-HMAC-1):
  The app-level SHOPIFY_CLIENT_SECRET (config key shopify.app_hmac_secret) is a
  Partner-app secret with NO workspace_id. It is consumed by TS webhook verification
  BEFORE any webhook arrives and does NOT share this per-workspace custody primitive.
  Follow-up tracked as: chore-app-hmac-secret-custody (separate requirement stub).
  See also custody.py for the interface-level note.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from src.domain.framework.adapter import Credential
from src.infrastructure.secrets.custody import CredentialCustody

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Region constants
# ---------------------------------------------------------------------------

_REQUIRED_REGION = "ap-south-1"
_SECRET_PREFIX = "brain"

# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class AwsRegionMismatchError(RuntimeError):
    """Raised when the effective AWS region is not ap-south-1.

    CF-CC-RESIDENCY-1: the custody backing refuses to initialise outside ap-south-1.
    This is an India-compliance requirement (DPDP — connector credentials at-rest
    must remain in ap-south-1).
    """


# ---------------------------------------------------------------------------
# Input validation helper
# ---------------------------------------------------------------------------


def _validate_id(value: str | None, field_name: str) -> str:
    """Validate a workspace_id or vendor string for use in a secret path.

    Rejects: None, empty string, whitespace-only, strings containing '/'
    (path-traversal), strings containing '..' (directory traversal), and
    strings containing '*' (wildcard — would widen IAM resource scope).

    CF-CC-WS-ISOLATION-1: prevents a crafted id from escaping the
    brain/{workspace_id}/{vendor}/credential secret namespace.

    Args:
        value: The raw id string.
        field_name: 'workspace_id' or 'vendor' — used in the error message (never the value).

    Returns:
        The validated string, stripped of surrounding whitespace.

    Raises:
        ValueError: if the value fails validation. Error message contains only
                    field_name — never the value itself (CF-CC-NEVERLOG-1).
    """
    if value is None:
        raise ValueError(
            f"[AwsSecretsManagerCustody] {field_name} must not be None. "
            "CF-CC-WS-ISOLATION-1."
        )
    stripped = value.strip()
    if not stripped:
        raise ValueError(
            f"[AwsSecretsManagerCustody] {field_name} must not be empty or whitespace-only. "
            "CF-CC-WS-ISOLATION-1."
        )
    # Path-traversal characters: '/' would allow escaping the expected namespace;
    # '..' is a directory-traversal sequence.
    if "/" in stripped:
        raise ValueError(
            f"[AwsSecretsManagerCustody] {field_name} must not contain '/'. "
            "CF-CC-WS-ISOLATION-1."
        )
    if ".." in stripped:
        raise ValueError(
            f"[AwsSecretsManagerCustody] {field_name} must not contain '..'. "
            "CF-CC-WS-ISOLATION-1."
        )
    # Wildcard would widen the IAM resource match.
    if "*" in stripped:
        raise ValueError(
            f"[AwsSecretsManagerCustody] {field_name} must not contain '*'. "
            "CF-CC-WS-ISOLATION-1."
        )
    return stripped


# ---------------------------------------------------------------------------
# Main class
# ---------------------------------------------------------------------------


class AwsSecretsManagerCustody:
    """
    Option A backing: AWS Secrets Manager (ap-south-1).

    Real boto3 implementation — satisfies CF-C7-CUSTODY-PROOF-1.

    Activation: returned by custody_factory.select_custody() ONLY when
    CONNECTOR_CUSTODY_BACKING=aws-secrets-manager is set explicitly.
    The default factory path returns HeldProductionCustody (CF-CC-GATE-1).
    """

    def __init__(self) -> None:
        # CF-CC-LAZY-1: boto3 client is NOT constructed here.
        # _client() builds and caches it on first use.
        self._boto3_client: Any = None

    def _client(self) -> Any:
        """Lazily construct and cache the boto3 secretsmanager client.

        CF-CC-LAZY-1: constructed on FIRST USE, never in __init__ or at module scope.
        CF-CC-RESIDENCY-1: hard-codes region_name="ap-south-1" and asserts the
          effective region before returning the client.

        Raises:
            AwsRegionMismatchError: if the effective client region is not ap-south-1.
        """
        if self._boto3_client is None:
            import boto3  # noqa: PLC0415 — intentional lazy import (CF-CC-LAZY-1)

            client = boto3.client("secretsmanager", region_name=_REQUIRED_REGION)

            # CF-CC-RESIDENCY-1: refuse to start if the effective region != ap-south-1.
            # boto3 client exposes the resolved region via meta.region_name.
            effective_region = client.meta.region_name
            if effective_region != _REQUIRED_REGION:
                raise AwsRegionMismatchError(
                    f"CF-CC-RESIDENCY-1: AWS Secrets Manager client region is "
                    f"{effective_region!r}, expected {_REQUIRED_REGION!r}. "
                    "Refusing to start — credentials must remain in ap-south-1 "
                    "(DPDP compliance). Set AWS_DEFAULT_REGION=ap-south-1 or "
                    "ensure no region override is active."
                )

            self._boto3_client = client

        return self._boto3_client

    def _secret_name(self, workspace_id: str, vendor: str) -> str:
        """Return the canonical secret name for a (workspace_id, vendor) pair.

        CF-CC-WS-ISOLATION-1: inputs are validated before composing the path.
        Format: brain/{workspace_id}/{vendor}/credential

        Raises:
            ValueError: if workspace_id or vendor fail validation.
        """
        ws = _validate_id(workspace_id, "workspace_id")
        v = _validate_id(vendor, "vendor")
        return f"{_SECRET_PREFIX}/{ws}/{v}/credential"

    async def get(self, workspace_id: str, vendor: str) -> Credential:
        """Retrieve the credential for (workspace_id, vendor) from AWS Secrets Manager.

        Maps AWS ResourceNotFoundException → KeyError per the CredentialCustody Protocol
        contract (custody.py:47: "Raises KeyError if no credential is on record").

        CF-CC-NEVERLOG-1: only ids are logged/raised — never SecretString or content.

        Args:
            workspace_id: The tenant workspace UUID.
            vendor: The connector vendor name (e.g. "shopify").

        Returns:
            Credential with content parsed from the stored JSON SecretString.

        Raises:
            KeyError: if no credential is stored for this (workspace_id, vendor).
            ValueError: if workspace_id or vendor fail input validation.
            AwsRegionMismatchError: if the effective region is not ap-south-1.
        """
        import botocore.exceptions  # noqa: PLC0415

        secret_name = self._secret_name(workspace_id, vendor)
        logger.debug(
            "custody.get: op=get workspace_id=%r vendor=%r secret_name=%r",
            workspace_id,
            vendor,
            secret_name,
        )
        try:
            response = self._client().get_secret_value(
                SecretId=secret_name,
                VersionStage="AWSCURRENT",
            )
            # SecretString is the JSON-encoded credential content.
            content: dict[str, Any] = json.loads(response["SecretString"])
            logger.info(
                "custody.get: op=get workspace_id=%r vendor=%r secret_name=%r outcome=ok",
                workspace_id,
                vendor,
                secret_name,
            )
            return Credential(
                workspace_id=workspace_id,
                vendor=vendor,
                content=content,
            )
        except botocore.exceptions.ClientError as exc:
            error_code = exc.response["Error"]["Code"]
            if error_code == "ResourceNotFoundException":
                # Protocol contract: raise KeyError on not-found.
                # CF-CC-NEVERLOG-1: only ids in the message — not the AWS error body.
                logger.debug(
                    "custody.get: op=get workspace_id=%r vendor=%r secret_name=%r outcome=not_found",
                    workspace_id,
                    vendor,
                    secret_name,
                )
                raise KeyError(
                    f"No credential found for workspace_id={workspace_id!r} "
                    f"vendor={vendor!r} (secret_name={secret_name!r}). "
                    "CF-CC-WS-ISOLATION-1."
                ) from None
            # Any other AWS error: re-raise with ids only (CF-CC-NEVERLOG-1).
            # We deliberately do NOT include exc / str(exc) — boto3 ClientError
            # str() can echo request parameters, which may include sensitive context.
            logger.error(
                "custody.get: op=get workspace_id=%r vendor=%r secret_name=%r "
                "outcome=error error_code=%r",
                workspace_id,
                vendor,
                secret_name,
                error_code,
            )
            raise RuntimeError(
                f"custody.get failed for workspace_id={workspace_id!r} "
                f"vendor={vendor!r} (secret_name={secret_name!r}): "
                f"AWS error_code={error_code!r}. CF-CC-NEVERLOG-1."
            ) from None

    async def put(
        self,
        workspace_id: str,
        vendor: str,
        content: dict[str, Any],
    ) -> None:
        """Store / update the credential for (workspace_id, vendor) in AWS Secrets Manager.

        Upsert: attempts create_secret first; falls back to put_secret_value if the
        secret already exists (ResourceExistsException). Idempotent: calling put twice
        with the same content overwrites in-place.

        The KMS CMK ARN is resolved from the BRAIN_CUSTODY_KMS_KEY_ID environment
        variable at runtime (set during the Stage-8 ceremony). In CI/local (moto),
        the env var may be absent — moto accepts create_secret without a KmsKeyId
        and uses a test key. Production MUST set BRAIN_CUSTODY_KMS_KEY_ID.

        CF-CC-NEVERLOG-1: content is serialised directly into SecretString — never logged.
        CF-CC-WS-ISOLATION-1: secret_name is validated before use.

        Args:
            workspace_id: The tenant workspace UUID.
            vendor: The connector vendor name.
            content: The credential dict to store (e.g. {"access_token": "...", ...}).
                     NEVER logged or included in exception messages.

        Raises:
            ValueError: if workspace_id or vendor fail input validation.
            AwsRegionMismatchError: if the effective region is not ap-south-1.
        """
        import botocore.exceptions  # noqa: PLC0415
        import os as _os  # noqa: PLC0415

        secret_name = self._secret_name(workspace_id, vendor)
        secret_string = json.dumps(content)
        kms_key_id = _os.environ.get("BRAIN_CUSTODY_KMS_KEY_ID")

        logger.debug(
            "custody.put: op=put workspace_id=%r vendor=%r secret_name=%r",
            workspace_id,
            vendor,
            secret_name,
        )
        try:
            create_kwargs: dict[str, Any] = {
                "Name": secret_name,
                "SecretString": secret_string,
                "Tags": [
                    {"Key": "brain:workspace_id", "Value": workspace_id},
                    {"Key": "brain:vendor", "Value": vendor},
                ],
            }
            if kms_key_id:
                create_kwargs["KmsKeyId"] = kms_key_id

            self._client().create_secret(**create_kwargs)
            logger.info(
                "custody.put: op=put workspace_id=%r vendor=%r secret_name=%r outcome=created",
                workspace_id,
                vendor,
                secret_name,
            )
        except botocore.exceptions.ClientError as exc:
            error_code = exc.response["Error"]["Code"]
            if error_code == "ResourceExistsException":
                # Secret already exists — update in-place (upsert).
                try:
                    self._client().put_secret_value(
                        SecretId=secret_name,
                        SecretString=secret_string,
                    )
                    logger.info(
                        "custody.put: op=put workspace_id=%r vendor=%r secret_name=%r outcome=updated",
                        workspace_id,
                        vendor,
                        secret_name,
                    )
                except botocore.exceptions.ClientError as update_exc:
                    update_code = update_exc.response["Error"]["Code"]
                    logger.error(
                        "custody.put: op=put workspace_id=%r vendor=%r secret_name=%r "
                        "outcome=error error_code=%r",
                        workspace_id,
                        vendor,
                        secret_name,
                        update_code,
                    )
                    raise RuntimeError(
                        f"custody.put (update) failed for workspace_id={workspace_id!r} "
                        f"vendor={vendor!r} (secret_name={secret_name!r}): "
                        f"AWS error_code={update_code!r}. CF-CC-NEVERLOG-1."
                    ) from None
            else:
                # CF-CC-NEVERLOG-1: ids only in the error — no AWS error body.
                logger.error(
                    "custody.put: op=put workspace_id=%r vendor=%r secret_name=%r "
                    "outcome=error error_code=%r",
                    workspace_id,
                    vendor,
                    secret_name,
                    error_code,
                )
                raise RuntimeError(
                    f"custody.put failed for workspace_id={workspace_id!r} "
                    f"vendor={vendor!r} (secret_name={secret_name!r}): "
                    f"AWS error_code={error_code!r}. CF-CC-NEVERLOG-1."
                ) from None

    async def seal(self, workspace_id: str, vendor: str) -> None:
        """Schedule deletion of the credential for (workspace_id, vendor).

        CF-CC-SEAL-RECOVERY-1: uses RecoveryWindowInDays=7 — the 7-day recovery
          window keeps the secret recoverable for 7 days, providing a rollback
          window if the ceremony needs to be unwound. This is mandatory; Shiprocket
          credentials have no replay, so an irreversible delete is catastrophic.
          ForceDeleteWithoutRecovery is FORBIDDEN.

        Called at STEP 6 of the Stage-8 ceremony — the LAST step, only AFTER:
          1. credential written to custody (STEP 1).
          2. live HTTP round-trip auth test passes (STEP 2).
          3. count-parity confirmed within window N (STEP 5).
        NEVER call seal() before the parity window closes.

        Idempotent: a second seal() on an already-scheduled-for-deletion secret
          is a no-op / handled gracefully.

        CF-CC-NEVERLOG-1: only ids are logged — never content.

        Args:
            workspace_id: The tenant workspace UUID.
            vendor: The connector vendor name.

        Raises:
            ValueError: if workspace_id or vendor fail input validation.
            AwsRegionMismatchError: if the effective region is not ap-south-1.
        """
        import botocore.exceptions  # noqa: PLC0415

        secret_name = self._secret_name(workspace_id, vendor)
        logger.debug(
            "custody.seal: op=seal workspace_id=%r vendor=%r secret_name=%r",
            workspace_id,
            vendor,
            secret_name,
        )
        try:
            self._client().delete_secret(
                SecretId=secret_name,
                RecoveryWindowInDays=7,
                # ForceDeleteWithoutRecovery is INTENTIONALLY ABSENT.
                # CF-CC-SEAL-RECOVERY-1: this is a Shreya VETO surface.
                # If you are reading this and considering adding
                # ForceDeleteWithoutRecovery=True: DO NOT. See §15 risk table.
            )
            logger.info(
                "custody.seal: op=seal workspace_id=%r vendor=%r secret_name=%r "
                "outcome=scheduled_deletion recovery_window_days=7",
                workspace_id,
                vendor,
                secret_name,
            )
        except botocore.exceptions.ClientError as exc:
            error_code = exc.response["Error"]["Code"]
            if error_code in ("InvalidRequestException", "ResourceNotFoundException"):
                # Already scheduled for deletion or already gone — idempotent, log and return.
                logger.info(
                    "custody.seal: op=seal workspace_id=%r vendor=%r secret_name=%r "
                    "outcome=already_sealed_or_gone error_code=%r",
                    workspace_id,
                    vendor,
                    secret_name,
                    error_code,
                )
                return
            # CF-CC-NEVERLOG-1: ids + error_code only — no AWS error body.
            logger.error(
                "custody.seal: op=seal workspace_id=%r vendor=%r secret_name=%r "
                "outcome=error error_code=%r",
                workspace_id,
                vendor,
                secret_name,
                error_code,
            )
            raise RuntimeError(
                f"custody.seal failed for workspace_id={workspace_id!r} "
                f"vendor={vendor!r} (secret_name={secret_name!r}): "
                f"AWS error_code={error_code!r}. CF-CC-NEVERLOG-1."
            ) from None


# Runtime Protocol check.
# CF-CC-LAZY-1: constructing AwsSecretsManagerCustody() does NOT build a boto3 client.
# Importing this module makes ZERO AWS calls.
assert isinstance(AwsSecretsManagerCustody(), CredentialCustody)
