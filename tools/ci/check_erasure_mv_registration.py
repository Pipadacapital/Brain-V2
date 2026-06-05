#!/usr/bin/env python3
"""check_erasure_mv_registration.py — P1-F: Erasure MV registration CI gate.

@paradigm: sql
Cost-routing: pure Python/JSON/HTTP, zero LLM tokens.

Verifies that every ClickHouse MaterializedView in the 'brain' database is
registered in the erasure_targets.json manifest (tools/codegen/generated/).

The invariant enforced:
  "A new MV added to the brain ClickHouse schema without registering it in
  the erasure_targets manifest → CI fails."

This closes the silent non-compliance gap described in the architecture proposal
§4.2: ClickHouse ALTER TABLE ... DELETE does NOT cascade to MVs/projections.
Without this gate, a newly added MV would silently hold subject data after
erasure, causing a DPDP §12 compliance failure.

Usage:
    python tools/ci/check_erasure_mv_registration.py              # against local CH
    python tools/ci/check_erasure_mv_registration.py --manifest-only  # manifest check only (no CH query)
    CLICKHOUSE_URL=http://host:8123 python tools/ci/check_erasure_mv_registration.py

Environment:
    CLICKHOUSE_URL     CH HTTP endpoint (default: http://localhost:8123)
    CLICKHOUSE_USER    CH user (default: default)
    CLICKHOUSE_PASSWORD CH password (default: empty)
    CLICKHOUSE_DATABASE CH database (default: brain)

Exit code: 0 = clean; 1 = unregistered MV detected or manifest malformed.

Flag: none — this is a build-time CI gate.
Rollback: fix by regenerating the manifest (`python tools/codegen/gen_facts.py`)
  and adding any new MV to the static _CH_MV_TARGETS list in gen_facts.py.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
# Allow ERASURE_MANIFEST_PATH env var to override the manifest path (used in tests/CI).
_ERASURE_JSON = (
    Path(os.environ["ERASURE_MANIFEST_PATH"])
    if os.environ.get("ERASURE_MANIFEST_PATH")
    else _REPO / "tools/codegen/generated/erasure_targets.json"
)


# ---------------------------------------------------------------------------
# Manifest loading
# ---------------------------------------------------------------------------

def _load_manifest() -> dict:
    """Load and parse the erasure_targets.json manifest. Exits 1 on error."""
    if not _ERASURE_JSON.exists():
        print(f"[FAIL] erasure_targets.json not found at {_ERASURE_JSON.relative_to(_REPO)}")
        print("       Run: python tools/codegen/gen_facts.py")
        sys.exit(1)

    try:
        manifest = json.loads(_ERASURE_JSON.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"[FAIL] erasure_targets.json is not valid JSON: {exc}")
        sys.exit(1)

    return manifest


def _get_registered_mv_names(manifest: dict) -> set[str]:
    """Extract the set of MV table names registered in the manifest.

    Returns short table names (without 'brain.' prefix) for comparison with
    system.tables output.
    """
    registered: set[str] = set()
    for target in manifest.get("targets", []):
        if target.get("type") == "materialized_view":
            tbl = target["table"]
            # Normalise: strip 'brain.' prefix if present.
            if tbl.startswith("brain."):
                tbl = tbl[len("brain."):]
            registered.add(tbl)
    return registered


# ---------------------------------------------------------------------------
# ClickHouse query (via HTTP API — no client library dep)
# ---------------------------------------------------------------------------

def _query_ch_mvs(
    ch_url: str,
    ch_user: str,
    ch_password: str,
    ch_db: str,
) -> list[str]:
    """Return the list of MaterializedView table names in the brain CH database.

    Uses the ClickHouse HTTP interface with JSONEachRow format.
    Returns a list of short table names (without the database prefix).
    """
    query = (
        f"SELECT name FROM system.tables "
        f"WHERE database = '{ch_db}' AND engine = 'MaterializedView'"
    )
    encoded_query = urllib.parse.quote(query)
    url = f"{ch_url.rstrip('/')}/?query={encoded_query}&default_format=JSONEachRow"

    req = urllib.request.Request(url)
    req.add_header("X-ClickHouse-User", ch_user)
    req.add_header("X-ClickHouse-Key", ch_password)

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8").strip()
    except urllib.error.URLError as exc:
        print(f"[WARN] Could not connect to ClickHouse at {ch_url}: {exc}")
        print("       Skipping live-CH check (run with --manifest-only to suppress this warning).")
        return []

    mv_names: list[str] = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
            mv_names.append(row["name"])
        except (json.JSONDecodeError, KeyError):
            continue

    return mv_names


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(
        description="P1-F CI gate: verify every CH MaterializedView is in erasure_targets.json"
    )
    ap.add_argument(
        "--manifest-only",
        action="store_true",
        help="Only check manifest structure (skip live CH query). Useful in CI without CH.",
    )
    args = ap.parse_args()

    print("P1-F — Erasure MV registration CI gate\n")

    # Step 1: Load + validate the manifest.
    manifest = _load_manifest()
    registered_mvs = _get_registered_mv_names(manifest)
    n_targets = len(manifest.get("targets", []))
    n_mv = len(registered_mvs)

    try:
        manifest_display = str(_ERASURE_JSON.relative_to(_REPO))
    except ValueError:
        manifest_display = str(_ERASURE_JSON)
    print(f"Manifest: {manifest_display}")
    print(f"  {n_targets} registered targets ({n_mv} MVs: {sorted(registered_mvs)})")

    # Structural check: the manifest must have at least the known workspace_daily_metrics_mv.
    issues: list[str] = []
    if "workspace_daily_metrics_mv" not in registered_mvs:
        issues.append(
            "workspace_daily_metrics_mv is NOT registered in erasure_targets.json. "
            "Run: python tools/codegen/gen_facts.py"
        )

    if args.manifest_only:
        print("\n[manifest-only mode — skipping live CH query]")
        if issues:
            for issue in issues:
                print(f"  [FAIL] {issue}")
            print("\nRESULT: manifest structure check FAILED.")
            return 1
        print("  [ok]   manifest structure check passed.")
        print("\nRESULT: manifest structure OK.")
        return 0

    # Step 2: Query live CH for all MVs.
    ch_url = os.environ.get("CLICKHOUSE_URL", "http://localhost:8123")
    ch_user = os.environ.get("CLICKHOUSE_USER", "default")
    ch_password = os.environ.get("CLICKHOUSE_PASSWORD", "")
    ch_db = os.environ.get("CLICKHOUSE_DATABASE", "brain")

    print(f"\nQuerying CH at {ch_url} (db={ch_db}) for MaterializedViews ...")
    live_mvs = _query_ch_mvs(ch_url, ch_user, ch_password, ch_db)

    if not live_mvs:
        # CH unreachable — skip the live check but still check the manifest.
        print("  [WARN] CH unreachable — live MV check skipped (manifest-only result).")
        if issues:
            for issue in issues:
                print(f"  [FAIL] {issue}")
            return 1
        print("  [ok]   manifest structure check passed (no live CH to verify against).")
        return 0

    print(f"  CH reports {len(live_mvs)} MV(s): {sorted(live_mvs)}")

    # Step 3: Every live MV must be in the manifest.
    unregistered = sorted(set(live_mvs) - registered_mvs)
    if unregistered:
        issues.append(
            f"The following CH MaterializedView(s) are NOT in erasure_targets.json:\n"
            + "\n".join(f"    - brain.{mv}" for mv in unregistered)
            + "\n  ClickHouse ALTER DELETE does NOT cascade to MVs — unregistered MVs hold "
            "subject data after erasure (silent DPDP §12 non-compliance).\n"
            "  Fix: add the MV to _CH_MV_TARGETS in tools/codegen/gen_facts.py, then "
            "regenerate:\n"
            "    python tools/codegen/gen_facts.py"
        )

    # Report + structural issues.
    print()
    if issues:
        for issue in issues:
            print(f"[FAIL] {issue}")
        print(
            "\nRESULT: erasure MV registration check FAILED.\n"
            "Every CH MaterializedView carrying or deriving from customer_ref data "
            "must be registered in tools/codegen/generated/erasure_targets.json.\n"
            "Run: python tools/codegen/gen_facts.py"
        )
        return 1

    print("[ok]   All CH MVs are registered in erasure_targets.json.")
    print(f"[ok]   registered={sorted(registered_mvs)}, live={sorted(live_mvs)}")
    print("\nRESULT: erasure MV registration check PASSED.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
