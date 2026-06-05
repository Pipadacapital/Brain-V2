"""
PII tokenizer — pure-domain, no I/O.

@paradigm: sql (deterministic HMAC-SHA256 hash; zero ML, zero LLM, zero I/O)

CF-C3-PII-TOKENIZER-1 (P0-B DPDP GATE):
  Replaces every field declared as PII in the adapter's PiiManifest with a
  deterministic HMAC-SHA256 token in the NormalizedEvent.columns dict BEFORE
  _produce_kafka emits the Kafka envelope.  The resulting token has the form:

    tok:<hex(HMAC-SHA256(workspace_salt, normalized_value))>

  So the Kafka envelope and the CH bronze table (connector_raw_events) are
  PII-light by construction — no plaintext email / phone / name ever reaches
  the wire.

Normalization rules (applied BEFORE hashing so cross-vendor match keys are
stable — this is also the G4 identity join key):
  - email:  lowercase, strip whitespace
  - phone:  E.164 normalization (strip spaces/dashes, ensure leading +, digit-only
            after +; if not parseable emit as-is after stripping)
  - other:  strip leading/trailing whitespace

Salt versioning:
  The salt is APPEND-ONLY (never rotated in place).  `salt_version` travels in
  the envelope alongside each tokenized event.  On replay of a historical event
  the worker reuses the salt of the event's recorded `salt_version` — so hash
  stability is guaranteed across replays and old↔new joins never silently break.
  See R1.4 of the architecture proposal for the detailed contract.

Feature flag:
  PII_TOKENIZER (default OFF — see B7 §P0-B).  When OFF, columns pass through
  unchanged (safe pre-go-live; NEVER leave OFF with live customer PII in scope).
  When ON, every field in adapter.pii_manifest is replaced with its HMAC token.
  The flag is read at call time so tests can override os.environ.

Acceptance contract (pass-1 REQUIRED, per B7 §P0-B task 1):
  - same phone from two vendors → identical token (determinism)
  - same value, different workspace → different token (per-workspace salt)
  - rotating salt_version → new token; old still derivable from the old salt
  - plaintext never in the emitted columns (snapshot-grep MUST find 0 matches)
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import unicodedata
from typing import Any

from .adapter import PiiManifest


# ---------------------------------------------------------------------------
# Feature flag
# ---------------------------------------------------------------------------

def _tokenizer_enabled() -> bool:
    """Return True when PII_TOKENIZER env-var is 'true' (case-insensitive)."""
    return os.environ.get("PII_TOKENIZER", "false").strip().lower() == "true"


# ---------------------------------------------------------------------------
# Normalization helpers
# ---------------------------------------------------------------------------

# E.164: starts with optional +, then digits only.  We strip spaces / dashes /
# dots before testing.  If the result doesn't look like a phone (no digits or
# too short) we return the stripped original rather than silently dropping it.
_NON_DIGIT_RE = re.compile(r"[^\d+]")


def _normalize_email(raw: str) -> str:
    """Lowercase + strip whitespace (RFC 5321 local-part is case-sensitive but
    Gmail/Shopify treat it as case-insensitive; safe to normalise)."""
    return raw.strip().lower()


def _normalize_phone(raw: str) -> str:
    """
    Best-effort E.164 normalization for hashing stability.

    Rules:
      1. Detect whether there is a leading '+' (country code prefix).
      2. Strip all non-digit characters to get the pure digit string.
      3. If there was a leading '+', return "+" + digits.
      4. If bare 10 digits, assume India (+91).
      5. If bare 11 digits starting with 0, strip the 0 and add +91.
      6. Otherwise return the stripped original (fallback).

    The goal is: +919876543210 and 09876543210 and 9876543210 and +91 9876543210
    all produce the same canonical form so they hash identically.
    """
    stripped_raw = raw.strip()
    # Determine if the caller expressed an explicit country code via '+'
    has_plus = stripped_raw.startswith("+")
    # Extract digit-only string (no spaces, dashes, parens, etc.)
    digits_only = re.sub(r"[^\d]", "", stripped_raw)

    if has_plus:
        # Already has country code; return "+<digits>"
        return "+" + digits_only

    if len(digits_only) == 10:
        # Assume India if 10-digit bare number
        return "+91" + digits_only

    if len(digits_only) == 11 and digits_only.startswith("0"):
        # Indian format with leading 0 (e.g. 09876543210)
        return "+91" + digits_only[1:]

    # Fallback: return digits only (at least strip spaces/punctuation)
    return digits_only if digits_only else stripped_raw


def _normalize_pii_value(field_name: str, raw_value: Any) -> str:
    """
    Normalize a PII field value before hashing.

    Returns a UTF-8-compatible string ready for HMAC.
    None / non-string values are stringified.
    """
    if raw_value is None:
        return ""

    value_str = str(raw_value)

    field_lower = field_name.lower()
    if "email" in field_lower:
        return _normalize_email(value_str)
    if any(k in field_lower for k in ("phone", "mobile")):
        return _normalize_phone(value_str)

    # Default: strip whitespace + NFC-normalize (handles Unicode name variants)
    return unicodedata.normalize("NFC", value_str.strip())


# ---------------------------------------------------------------------------
# HMAC-SHA256 token
# ---------------------------------------------------------------------------

_TOKEN_PREFIX = "tok:"


def _hmac_token(workspace_salt: bytes, normalized_value: str) -> str:
    """
    Compute HMAC-SHA256(workspace_salt, normalized_value) and return as a
    hex-encoded token with the 'tok:' prefix.

    Empty normalized_value → token over the empty string (stable, deterministic).
    The caller should treat an empty-value token as a tombstone signal if needed.
    """
    mac = hmac.new(workspace_salt, normalized_value.encode("utf-8"), hashlib.sha256)
    return _TOKEN_PREFIX + mac.hexdigest()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

class PiiTokenizerResult:
    """Result of tokenize_event — contains the mutated columns + metadata."""

    __slots__ = ("columns", "salt_version", "fields_tokenized")

    def __init__(
        self,
        columns: dict[str, Any],
        salt_version: str,
        fields_tokenized: list[str],
    ) -> None:
        self.columns = columns
        self.salt_version = salt_version
        self.fields_tokenized = fields_tokenized


def tokenize_event(
    columns: dict[str, Any],
    manifest: PiiManifest,
    workspace_salt: bytes,
    salt_version: str,
) -> PiiTokenizerResult:
    """
    Replace every PII-declared field in `columns` with its HMAC-SHA256 token.

    This is the SINGLE ingest chokepoint (CF-C3-PII-TOKENIZER-1).  It is
    called on NormalizedEvent.columns BEFORE _produce_kafka emits the envelope,
    so the envelope is always PII-light.

    Args:
        columns:        The NormalizedEvent.columns dict (mutated in-place copy).
        manifest:       The adapter's PiiManifest (declares which fields are PII).
        workspace_salt: Per-workspace HMAC key (bytes, from KmsVault).
        salt_version:   Opaque version string (e.g. "v1") for replay stability.

    Returns:
        PiiTokenizerResult with the mutated columns dict + metadata.

    Raises:
        ValueError: if workspace_salt is empty (caller bug — must provide a salt).
    """
    if not workspace_salt:
        raise ValueError(
            "tokenize_event: workspace_salt must not be empty. "
            "Pass a per-workspace KMS-backed salt (P0-B / CF-C3-PII-TOKENIZER-1)."
        )

    # Shallow copy so we don't mutate the caller's dict
    mutated: dict[str, Any] = dict(columns)
    fields_tokenized: list[str] = []

    for field_name in list(mutated.keys()):
        if manifest.is_pii(field_name):
            raw_value = mutated[field_name]
            normalized = _normalize_pii_value(field_name, raw_value)
            mutated[field_name] = _hmac_token(workspace_salt, normalized)
            fields_tokenized.append(field_name)

    return PiiTokenizerResult(
        columns=mutated,
        salt_version=salt_version,
        fields_tokenized=fields_tokenized,
    )


def tokenize_event_if_enabled(
    columns: dict[str, Any],
    manifest: PiiManifest,
    workspace_salt: bytes,
    salt_version: str,
) -> PiiTokenizerResult:
    """
    Gate-checked variant: only tokenizes when PII_TOKENIZER env-var is 'true'.

    When the flag is OFF the original columns pass through unchanged (safe
    pre-go-live; NEVER leave OFF with live customer PII).  The salt_version is
    still included in the result for envelope embedding consistency.
    """
    if not _tokenizer_enabled():
        return PiiTokenizerResult(
            columns=dict(columns),
            salt_version=salt_version,
            fields_tokenized=[],
        )
    return tokenize_event(columns, manifest, workspace_salt, salt_version)
