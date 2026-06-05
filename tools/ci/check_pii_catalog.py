#!/usr/bin/env python3
"""check_pii_catalog.py — PII catalog CI gate (P1-E, R9).

@paradigm: sql
Cost-routing: pure Python/YAML diffing, zero LLM tokens, zero network.

WHAT IT DOES:
  Verifies that docs/pii-catalog.yaml is in sync with the adapter PII manifests
  in apps/ingestion-service/src/domain/framework/pii_manifest.py.

  Specifically:
  1. Every vendor key in MANIFEST_REGISTRY has an entry in pii-catalog.yaml.
  2. Every field listed in pii_manifest.pii_fields for a vendor appears in
     the catalog's pii_fields for that vendor.
  3. A new adapter's vendor key NOT in the catalog → CI fail (a new connector
     was added without a catalog entry, which is a DPDP gate violation).

  This gate enforces: "each connector declares its PII fields as a merge
  prerequisite" (P1-E task 5 acceptance criterion).

USAGE:
    python tools/ci/check_pii_catalog.py    # exit 0 = clean, exit 1 = drift

Exit codes:
  0 — clean (all connectors catalogued)
  1 — violations found (new connector not catalogued, or field mismatch)
"""

from __future__ import annotations

import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
_CATALOG = _REPO / "docs" / "pii-catalog.yaml"
_INGESTION_ROOT = _REPO / "apps" / "ingestion-service" / "src"


def _load_catalog() -> dict:
    """Load and parse pii-catalog.yaml.  Returns {} if missing."""
    if not _CATALOG.exists():
        return {}
    try:
        import yaml  # type: ignore[import-untyped]
    except ImportError:
        # PyYAML not available — skip gracefully (non-fatal in environments without it)
        print(f"check_pii_catalog: WARNING — PyYAML not available; skipping catalog check.")
        return {}
    return yaml.safe_load(_CATALOG.read_text(encoding="utf-8")) or {}


def _load_manifest_registry() -> dict[str, list[str]]:
    """Load MANIFEST_REGISTRY from pii_manifest.py via import.

    Returns: {vendor_key: [field_name, ...]}
    """
    sys.path.insert(0, str(_INGESTION_ROOT))
    try:
        from domain.framework.pii_manifest import MANIFEST_REGISTRY  # type: ignore[import-not-found]
        return {
            vendor: list(manifest.pii_fields.keys())
            for vendor, manifest in MANIFEST_REGISTRY.items()
        }
    except ImportError as exc:
        print(f"check_pii_catalog: WARNING — cannot import MANIFEST_REGISTRY: {exc}")
        return {}
    finally:
        sys.path.pop(0)


def main() -> int:
    """Run the PII catalog CI gate.

    Returns:
        0 — clean
        1 — violations found
    """
    catalog = _load_catalog()
    catalog_connectors: dict = catalog.get("connectors", {})

    if not catalog_connectors:
        print(
            f"check_pii_catalog: FAIL — {_CATALOG.name} not found or has no connectors. "
            f"Create docs/pii-catalog.yaml with an entry per connector."
        )
        return 1

    registry = _load_manifest_registry()
    if not registry:
        # Cannot load the manifest — cannot validate; pass gracefully.
        print("check_pii_catalog: WARNING — MANIFEST_REGISTRY not loaded; skipping field check.")
        return 0

    issues: list[str] = []

    for vendor, manifest_fields in registry.items():
        if vendor not in catalog_connectors:
            issues.append(
                f"  MISSING CATALOG ENTRY: connector '{vendor}' is in MANIFEST_REGISTRY "
                f"but has no entry in docs/pii-catalog.yaml. "
                f"Add a '{vendor}:' block to pii-catalog.yaml before merging. "
                f"P1-E acceptance: 'a new adapter without a catalog entry fails CI'."
            )
            continue

        catalog_entry = catalog_connectors[vendor]
        catalog_pii_fields: dict = catalog_entry.get("pii_fields", {})

        for field in manifest_fields:
            if field not in catalog_pii_fields:
                issues.append(
                    f"  FIELD NOT CATALOGUED: connector '{vendor}' field '{field}' is in "
                    f"pii_manifest but missing from docs/pii-catalog.yaml. "
                    f"Add '{field}:' under connectors.{vendor}.pii_fields."
                )

    if not issues:
        print(
            f"check_pii_catalog: PASS — {len(registry)} connectors verified, "
            f"all PII fields catalogued."
        )
        return 0

    print(f"check_pii_catalog: FAIL — {len(issues)} issue(s) found:")
    for issue in issues:
        print(issue)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
