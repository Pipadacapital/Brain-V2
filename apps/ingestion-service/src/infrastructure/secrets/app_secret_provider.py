"""
App-level secret provider — singleton HMAC secret for the Shopify Partner-app.

@paradigm: sql (no ML, no LLM)

CF-HMAC-HOTPATH-CACHE-1: boot/first-use fetch + in-process cache.
  The secret is fetched at most ONCE per process lifetime (or after manual refresh()).
  A per-webhook SM call is EXPLICITLY FORBIDDEN — it would add latency, cost, and a
  new failure mode for each inbound request.

CF-HMAC-FAILCLOSED-1 (CRIT):
  If the secret is unretrievable, missing, or empty, the provider raises
  AppSecretUnavailableError.  The CALLER must reject (not process) the webhook.
  There is no fall-open path.  This is Shreya's VETO surface.

CF-HMAC-NEVERLOG-1 (VETO):
  The secret value and any full HMAC signature MUST NEVER appear in any log,
  exception message, repr, or debug output.  Only ids/outcome are logged.

CF-HMAC-RESIDENCY-1:
  The boto3 client is constructed with region_name="ap-south-1" and a
  construction-time assert refuses to start if the effective region differs.
  Mirrors AwsSecretsManagerCustody._client() (aws_secrets_manager_custody.py:176–205).

CF-HMAC-ROTATION-MANUAL-1:
  Auto-rotation on this secret is FORBIDDEN (SM auto-rotation cannot update
  Shopify Partner dashboard simultaneously, which would break every signature).
  The manual two-place rotation ceremony is documented in the runbook below.

SECRET NAME (singleton, no workspace_id):
  brain/_app/shopify/hmac_secret
  The `_app/` prefix is the explicit app-level namespace — deliberately distinct
  from the per-workspace `brain/{workspace_id}/{vendor}/credential` shape used by
  AwsSecretsManagerCustody.  The two namespaces MUST NOT be merged
  (see aws_secrets_manager_custody.py:26–31 for the parent's prohibition).

SEAM CONTRACT (CF-HMAC-FAILCLOSED-1):
  # SEAM: the FUTURE inbound-webhook ingress route (connector-webhook-intake feature)
  # obtains the secret via:
  #
  #   provider = select_app_secret_provider()
  #   try:
  #       secret = provider.get_shopify_hmac_secret()
  #   except AppSecretUnavailableError:
  #       return REJECT  # 401 / drop — never 200 / fall-open
  #   return verify_shopify_hmac(raw_body, hmac_header, client_secret=secret)
  #
  # The ingress route is a SEPARATE, HELD feature (connector-webhook-intake).
  # This module leaves only the retrieval seam.

ROTATION RUNBOOK (CF-HMAC-ROTATION-MANUAL-1, T4.1):
  Manual two-place ceremony (HELD — performed at Stage-8 console):
    STEP 1 — Generate a new secret string in the Shopify Partner dashboard
              (App → App setup → Client secret → Rotate secret).
    STEP 2 — Put the new value into Secrets Manager (ids/CLI only — never paste
              into logs or shell history without clearing history afterwards):
                aws secretsmanager put-secret-value \
                  --secret-id brain/_app/shopify/hmac_secret \
                  --secret-string '{"value": "<new_shpss_...>"}' \
                  --region ap-south-1
    STEP 3 — Call provider.refresh() on the running process (or restart the
              ingestion-service pod/worker) so the in-process cache clears.
    STEP 4 — Verify a test webhook round-trip (Shopify sends a test event;
              confirm it is accepted, not rejected).
    STEP 5 — The old secret is already invalid from Shopify's side — no SM
              delete needed (SM keeps the old version; it is never read).

  AUTO-ROTATION FORBIDDEN: SM's automatic rotation mechanism cannot simultaneously
  update the Shopify Partner dashboard.  Enabling auto-rotation would silently
  break every inbound webhook signature.  This is enforced structurally:
  the CDK construct for this secret carries RemovalPolicy.RETAIN and NO
  rotation schedule (infra/cdk/lib/credential-custody-stack.ts).

  EXPOSED .env VALUE (CF-HMAC-EXPOSED-VALUE-ROTATE-1):
  The shpss_… value at apps/api-gateway/.env:27 is COMPROMISED BY EXPOSURE
  (committed plaintext, visible in git history).  It MUST be rotated at the
  Stage-8 ceremony as STEP 1 above.  Until then, the dev env fallback
  (EnvAppSecretProvider) reads SHOPIFY_CLIENT_SECRET from the local environment
  — do NOT re-commit the live value.

LAZY CLIENT (CF-CC-LAZY-1 — inherited discipline):
  The boto3 client is NOT constructed at __init__ or module-import time.
  Importing this module makes ZERO AWS calls.
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Region constant (mirrored from aws_secrets_manager_custody._REQUIRED_REGION)
# ---------------------------------------------------------------------------

_REQUIRED_REGION = "ap-south-1"

# ---------------------------------------------------------------------------
# Singleton secret name (fixed, no workspace_id component)
# ---------------------------------------------------------------------------

_APP_SHOPIFY_SECRET_NAME = "brain/_app/shopify/hmac_secret"

# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class AppSecretUnavailableError(RuntimeError):
    """Raised when the app-level HMAC secret cannot be retrieved or is empty.

    CF-HMAC-FAILCLOSED-1 (CRIT): the verifier MUST reject the webhook when
    this error is raised.  The caller MUST NOT fall open or process the request.

    This error carries ONLY outcome/context strings — never the secret value.
    """


# ---------------------------------------------------------------------------
# Provider: AWS Secrets Manager singleton reader
# ---------------------------------------------------------------------------


class AppSecretsManagerProvider:
    """Read the Shopify Partner-app HMAC secret from AWS Secrets Manager.

    @paradigm: sql (no ML, no LLM)

    Reuses the parent's lazy-boto3 + ap-south-1 residency-assert + never-log
    discipline (cf. AwsSecretsManagerCustody:176–205) but reads a FIXED
    singleton path — no workspace_id / vendor path component.

    CF-HMAC-HOTPATH-CACHE-1: get_shopify_hmac_secret() fetches at most once
    and caches the value in-process.  Call refresh() to invalidate the cache
    (e.g. after a rotation ceremony).
    """

    def __init__(self) -> None:
        # CF-CC-LAZY-1 (inherited): boto3 client is NOT constructed here.
        self._boto3_client: Any = None
        # In-process cache — None means "not yet fetched".
        self._cached_secret: str | None = None

    def _client(self) -> Any:
        """Lazily construct and cache the boto3 secretsmanager client.

        CF-CC-LAZY-1 (inherited): constructed on FIRST USE, never in __init__
        or at module scope.
        CF-HMAC-RESIDENCY-1: hard-codes region_name="ap-south-1" and asserts
        the effective region before returning the client.

        Raises:
            AwsRegionMismatchError: if the effective client region is not ap-south-1.
        """
        if self._boto3_client is None:
            import boto3  # noqa: PLC0415 — intentional lazy import (CF-CC-LAZY-1)
            from src.infrastructure.secrets.aws_secrets_manager_custody import (
                AwsRegionMismatchError,
            )

            client = boto3.client("secretsmanager", region_name=_REQUIRED_REGION)

            # CF-HMAC-RESIDENCY-1: refuse to start if effective region != ap-south-1.
            effective_region = client.meta.region_name
            if effective_region != _REQUIRED_REGION:
                raise AwsRegionMismatchError(
                    f"CF-HMAC-RESIDENCY-1: AWS Secrets Manager client region is "
                    f"{effective_region!r}, expected {_REQUIRED_REGION!r}. "
                    "Refusing to start — the app HMAC secret must remain in ap-south-1 "
                    "(DPDP compliance). Set AWS_DEFAULT_REGION=ap-south-1 or "
                    "ensure no region override is active."
                )

            self._boto3_client = client

        return self._boto3_client

    def get_shopify_hmac_secret(self) -> str:
        """Return the Shopify Partner-app HMAC secret string.

        Fetches from Secrets Manager on first call; subsequent calls return the
        in-process cache (CF-HMAC-HOTPATH-CACHE-1: at most ONE SM call).

        CF-HMAC-NEVERLOG-1: the return value is NEVER logged or included in
        any exception message.

        CF-HMAC-FAILCLOSED-1: raises AppSecretUnavailableError if the secret
        is missing, empty, or any AWS error occurs.  The caller MUST reject.

        Returns:
            The raw HMAC secret string (e.g. "shpss_...") — handle with care,
            never log.

        Raises:
            AppSecretUnavailableError: if the secret cannot be retrieved or is empty.
            AwsRegionMismatchError: if the effective region is not ap-south-1.
        """
        if self._cached_secret is not None:
            return self._cached_secret

        # First use — fetch from SM.
        self._cached_secret = self._fetch()
        return self._cached_secret

    def _fetch(self) -> str:
        """Fetch the secret from AWS Secrets Manager.

        Internal — called at most once per process lifetime (or after refresh()).
        CF-HMAC-NEVERLOG-1: only ids/outcome logged, never the value.
        CF-HMAC-FAILCLOSED-1: raises AppSecretUnavailableError on any failure.
        """
        import botocore.exceptions  # noqa: PLC0415

        logger.debug(
            "app_secret.fetch: source=secrets-manager secret_name=%r",
            _APP_SHOPIFY_SECRET_NAME,
        )
        # CF-HMAC-NEVERLOG-1 (defense-in-depth): botocore logs the raw GetSecretValue
        # response body — which contains the secret value — on its own DEBUG logger,
        # independent of our ids-only logging. Suppress botocore's logging for just
        # the fetch call so the value cannot leak via botocore even if the service is
        # running at DEBUG. The botocore/urllib3-DEBUG-OFF operational posture remains
        # a Stage-8 precondition; this is belt-and-suspenders, scoped + restored.
        _botocore_logger = logging.getLogger("botocore")
        _prev_botocore_level = _botocore_logger.level
        _botocore_logger.setLevel(logging.WARNING)
        try:
            response = self._client().get_secret_value(
                SecretId=_APP_SHOPIFY_SECRET_NAME,
                VersionStage="AWSCURRENT",
            )
        except botocore.exceptions.ClientError as exc:
            error_code = exc.response["Error"]["Code"]
            # CF-HMAC-NEVERLOG-1: ids + error_code only — no AWS error body.
            if error_code == "ResourceNotFoundException":
                logger.error(
                    "app_secret.fetch: source=secrets-manager secret_name=%r outcome=not_found",
                    _APP_SHOPIFY_SECRET_NAME,
                )
                raise AppSecretUnavailableError(
                    f"CF-HMAC-FAILCLOSED-1: app HMAC secret not found in Secrets Manager "
                    f"(secret_name={_APP_SHOPIFY_SECRET_NAME!r}). "
                    "Provision the secret at the Stage-8 ceremony before receiving webhooks. "
                    "CF-HMAC-NEVERLOG-1: no secret value in this message."
                ) from None
            logger.error(
                "app_secret.fetch: source=secrets-manager secret_name=%r outcome=error error_code=%r",
                _APP_SHOPIFY_SECRET_NAME,
                error_code,
            )
            raise AppSecretUnavailableError(
                f"CF-HMAC-FAILCLOSED-1: could not retrieve app HMAC secret from Secrets Manager "
                f"(secret_name={_APP_SHOPIFY_SECRET_NAME!r}, error_code={error_code!r}). "
                "CF-HMAC-NEVERLOG-1: no secret value in this message."
            ) from None
        finally:
            # Restore botocore's prior log level — suppression was scoped to the fetch.
            _botocore_logger.setLevel(_prev_botocore_level)

        # Extract the value.  The secret is stored as a JSON object: {"value": "shpss_..."}.
        import json  # noqa: PLC0415

        raw = response.get("SecretString", "")
        try:
            parsed = json.loads(raw)
            value = parsed.get("value", "") if isinstance(parsed, dict) else ""
        except (json.JSONDecodeError, TypeError):
            # Fallback: treat the raw string itself as the secret value.
            value = raw

        if not value or not value.strip():
            # CF-HMAC-FAILCLOSED-1: empty secret → raise, never fall open.
            logger.error(
                "app_secret.fetch: source=secrets-manager secret_name=%r outcome=empty",
                _APP_SHOPIFY_SECRET_NAME,
            )
            raise AppSecretUnavailableError(
                f"CF-HMAC-FAILCLOSED-1: app HMAC secret is empty or missing the 'value' key "
                f"(secret_name={_APP_SHOPIFY_SECRET_NAME!r}). "
                "CF-HMAC-NEVERLOG-1: no secret value in this message."
            )

        logger.info(
            "app_secret.fetch: source=secrets-manager secret_name=%r outcome=ok",
            _APP_SHOPIFY_SECRET_NAME,
        )
        return value  # CF-HMAC-NEVERLOG-1: value returned, NEVER logged

    def refresh(self) -> None:
        """Invalidate the in-process cache so the next call re-fetches from SM.

        Call after a rotation ceremony (STEP 3 of the rotation runbook above).
        Thread-safety: this is a best-effort single-threaded cache; in a
        multi-worker deployment, restart the worker process instead.
        """
        self._cached_secret = None
        logger.info(
            "app_secret.refresh: source=secrets-manager secret_name=%r cache_cleared=true",
            _APP_SHOPIFY_SECRET_NAME,
        )


# ---------------------------------------------------------------------------
# Provider: env-var dev fallback (DEV ONLY — NOT FOR PRODUCTION)
# ---------------------------------------------------------------------------


class EnvAppSecretProvider:
    """DEV-ONLY fallback: read SHOPIFY_CLIENT_SECRET from the environment.

    @paradigm: sql (no ML, no LLM)

    This provider is active ONLY when CONNECTOR_CUSTODY_BACKING is unset, empty,
    or 'local' (the dev path).  It MUST NEVER be the default in production.

    CF-HMAC-FAILCLOSED-1: raises AppSecretUnavailableError if the env var is
    absent or empty — no fall-open, no silent None.
    CF-HMAC-NEVERLOG-1: the env-var value is never logged.
    """

    _ENV_VAR = "SHOPIFY_CLIENT_SECRET"

    def get_shopify_hmac_secret(self) -> str:
        """Read the secret from the environment variable.

        Returns:
            The raw HMAC secret string.

        Raises:
            AppSecretUnavailableError: if the env var is absent or empty.
        """
        value = os.environ.get(self._ENV_VAR, "")
        if not value or not value.strip():
            raise AppSecretUnavailableError(
                f"CF-HMAC-FAILCLOSED-1: env var {self._ENV_VAR!r} is absent or empty. "
                "In local-dev set SHOPIFY_CLIENT_SECRET=<dev-secret>. "
                "In production CONNECTOR_CUSTODY_BACKING=aws-secrets-manager must be set. "
                "CF-HMAC-NEVERLOG-1: no secret value in this message."
            )
        logger.debug(
            "app_secret.fetch: source=env secret_name=%r outcome=ok",
            self._ENV_VAR,
        )
        return value  # CF-HMAC-NEVERLOG-1: value returned, NEVER logged

    def refresh(self) -> None:
        """No-op — env var is re-read on each call; no cache to clear."""
        logger.debug("app_secret.refresh: source=env no_cache=true")


# ---------------------------------------------------------------------------
# Provider: held / fail-closed default (mirrors HeldProductionCustody)
# ---------------------------------------------------------------------------


class HeldAppSecretProvider:
    """Fail-closed default when CONNECTOR_CUSTODY_BACKING is an UNKNOWN value.

    @paradigm: sql (no ML, no LLM)

    Mirrors HeldProductionCustody (held_custody.py:63–88).
    Every call to get_shopify_hmac_secret() raises HeldAppSecretError.

    CF-HMAC-FAILCLOSED-1 (CRIT): an unretrievable secret MUST cause the
    verifier to REJECT — this provider ensures that path is taken for any
    unknown/misconfigured backing value.

    CF-CC-GATE-1 (inherited): unknown CONNECTOR_CUSTODY_BACKING values must
    NEVER silently activate the AWS backing.
    """

    def get_shopify_hmac_secret(self) -> str:
        raise HeldAppSecretError("get_shopify_hmac_secret")

    def refresh(self) -> None:
        raise HeldAppSecretError("refresh")


class HeldAppSecretError(RuntimeError):
    """Raised by HeldAppSecretProvider on any access attempt.

    CF-HMAC-FAILCLOSED-1: this error propagates to the webhook verifier,
    which MUST reject (never accept) when the provider raises.
    """

    def __init__(self, method: str) -> None:
        super().__init__(
            f"[HeldAppSecretProvider.{method}] HELD — CF-HMAC-FAILCLOSED-1 / CF-CC-GATE-1. "
            "The app-level HMAC secret backing is not configured or uses an unknown value. "
            "In production: set CONNECTOR_CUSTODY_BACKING=aws-secrets-manager. "
            "In local-dev: set CONNECTOR_CUSTODY_BACKING=local (env-var fallback). "
            "An UNKNOWN value fails closed — the webhook verifier will REJECT. "
            "CF-HMAC-NEVERLOG-1: no secret value in this message."
        )
        self.name = "HeldAppSecretError"
