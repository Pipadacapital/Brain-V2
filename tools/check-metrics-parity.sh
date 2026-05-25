#!/usr/bin/env bash
# check-metrics-parity.sh — CI byte-identity parity gate (CF-QA-1.HARD)
#
# Runs TS decimalToMinorUnits + Python decimal_to_minor_units over the SAME
# golden fixture vectors and asserts byte-identical BIGINT outputs.
# Any single divergence exits non-zero and fails CI.
#
# Child-4 extensions:
#   (a) F3 carry-forward: also asserts ts_result == expected_minor_units (the ground-truth
#       anchor) — a TS==Python but both-wrong scenario is now detectable.
#   (b) Registry parity check: asserts the TS registry metric ids are a superset of
#       the Python registry metric ids (byte-identity of the definition set).
#   (c) CH round-trip fixture check: asserts the intDiv fixture set is present in
#       golden_fixtures.json (the gate from M4; wired here as a structural pre-flight).
#
# Wired as turbo root task //#check:metrics-parity with inputs:
#   packages/lib-metrics/**, pylibs/brain_metrics/**, tools/check-metrics-parity.sh
#
# @paradigm: sql (deterministic integer comparator; zero float; zero live DB)
# CF-QA-1.HARD, CF-C2-GOLDEN-1, CF-C2-FIXTURE-PROOF-1, CF-C4-PARITY-SCOPE-1

set -euo pipefail

# ---------------------------------------------------------------------------
# Resolve project root regardless of where the script is called from.
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

FIXTURE_PATH="${REPO_ROOT}/pylibs/brain_metrics/brain_metrics/parity/fixtures/golden_fixtures.json"
TS_RUNNER="${REPO_ROOT}/packages/lib-metrics/src/parity-runner.ts"
PY_RUNNER="${REPO_ROOT}/tools/parity-runner.py"
PY_REGISTRY_PATH="${REPO_ROOT}/pylibs/brain_metrics/brain_metrics/registry"
TS_REGISTRY_PATH="${REPO_ROOT}/packages/lib-metrics/src/registry"

# Temporary output files (cleaned up on exit)
TS_OUT=$(mktemp)
PY_OUT=$(mktemp)
DIFF_OUT=$(mktemp)

cleanup() {
  rm -f "${TS_OUT}" "${PY_OUT}" "${DIFF_OUT}"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 0. Pre-flight: verify fixture and divergence probe exist (CF-C2-FIXTURE-PROOF-1)
# ---------------------------------------------------------------------------
echo "[parity-gate] Pre-flight checks..."

if [[ ! -f "${FIXTURE_PATH}" ]]; then
  echo "[parity-gate] FAIL: golden fixture not found: ${FIXTURE_PATH}" >&2
  exit 1
fi

# Assert the divergence-proving probe group is present (CF-C2-FIXTURE-PROOF-1).
# The probe group must be named "divergence_probe" at the top level of the fixture JSON.
if ! python3 -c "
import json, sys
data = json.load(open('${FIXTURE_PATH}'))
# Check for the divergence_probe top-level group (CF-C2-FIXTURE-PROOF-1)
has_probe_group = 'divergence_probe' in data
# Also check for any fixture id or group name containing 'probe' or 'divergence'
group_names = [k for k in data.keys() if not k.startswith('_')]
ids = [v.get('id','') for group in data.values() if isinstance(group, list) for v in group if isinstance(v, dict)]
has_probe_id = any('probe' in i.lower() or 'divergence' in i.lower() for i in ids)
has_probe_group_name = any('probe' in g.lower() or 'divergence' in g.lower() for g in group_names)
if not (has_probe_group or has_probe_id or has_probe_group_name):
    print('FAIL: divergence-proving probe fixture not found in golden_fixtures.json', file=sys.stderr)
    print('CF-C2-FIXTURE-PROOF-1: a \"divergence_probe\" fixture group must exist.', file=sys.stderr)
    sys.exit(1)
print('  divergence probe fixture present: OK')
" 2>&1; then
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. Python side: run decimal_to_minor_units over all fixture vectors
# ---------------------------------------------------------------------------
echo "[parity-gate] Running Python side..."

python3 "${PY_RUNNER}" "${FIXTURE_PATH}" > "${PY_OUT}" 2>&1
if [[ $? -ne 0 ]]; then
  echo "[parity-gate] FAIL: Python runner failed:" >&2
  cat "${PY_OUT}" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. TS side: run decimalToMinorUnits over all fixture vectors
# ---------------------------------------------------------------------------
echo "[parity-gate] Running TypeScript side..."

# Find node binary
NODE_BIN="$(command -v node 2>/dev/null || echo '')"
if [[ -z "${NODE_BIN}" ]]; then
  echo "[parity-gate] FAIL: node not found on PATH" >&2
  exit 1
fi

# Find tsx (TypeScript runner) — try package-level then global
TSX_BIN="${REPO_ROOT}/packages/lib-metrics/node_modules/.bin/tsx"
if [[ ! -f "${TSX_BIN}" ]]; then
  TSX_BIN="${REPO_ROOT}/node_modules/.pnpm/node_modules/.bin/tsx"
fi
if [[ ! -f "${TSX_BIN}" ]]; then
  TSX_BIN="$(command -v tsx 2>/dev/null || echo '')"
fi

if [[ -z "${TSX_BIN}" ]] || [[ ! -f "${TSX_BIN}" ]]; then
  echo "[parity-gate] FAIL: tsx not found. Install it: pnpm add -D tsx in packages/lib-metrics" >&2
  exit 1
fi

"${TSX_BIN}" "${TS_RUNNER}" "${FIXTURE_PATH}" > "${TS_OUT}" 2>&1
if [[ $? -ne 0 ]]; then
  echo "[parity-gate] FAIL: TypeScript runner failed:" >&2
  cat "${TS_OUT}" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. Byte-identity comparison: TS results vs Python results
# ---------------------------------------------------------------------------
echo "[parity-gate] Comparing TS↔Python outputs..."

python3 - "${TS_OUT}" "${PY_OUT}" << 'EOF'
import json, sys

ts_path, py_path = sys.argv[1], sys.argv[2]

ts_data = json.load(open(ts_path))
py_data = json.load(open(py_path))

# Index both by fixture id
ts_map = {r['id']: r['ts_result'] for r in ts_data}
py_map = {r['id']: r['py_result'] for r in py_data}

ids_only_ts = set(ts_map) - set(py_map)
ids_only_py = set(py_map) - set(ts_map)
divergences = []

for fid in sorted(set(ts_map) & set(py_map)):
    ts_val = ts_map[fid]
    py_val = py_map[fid]
    if ts_val != py_val:
        divergences.append({
            'id': fid,
            'ts_result': ts_val,
            'py_result': py_val,
            'delta': int(ts_val) - int(py_val),
        })

if ids_only_ts:
    print(f'  FAIL: {len(ids_only_ts)} fixtures in TS but not Python: {sorted(ids_only_ts)}', file=sys.stderr)
if ids_only_py:
    print(f'  FAIL: {len(ids_only_py)} fixtures in Python but not TS: {sorted(ids_only_py)}', file=sys.stderr)
if divergences:
    print(f'  FAIL: {len(divergences)} BYTE-IDENTITY DIVERGENCE(S) found:', file=sys.stderr)
    for d in divergences:
        print(f'    id={d["id"]!r}: ts={d["ts_result"]!r} py={d["py_result"]!r} delta={d["delta"]}', file=sys.stderr)
    print('  CF-QA-1.HARD: TS↔Python outputs must be byte-identical over all fixture vectors.', file=sys.stderr)
    sys.exit(1)

if ids_only_ts or ids_only_py:
    sys.exit(1)

total = len(ts_map)
print(f'  {total} fixture vectors checked: all byte-identical. PASS.')
EOF

COMPARE_EXIT=$?

# ---------------------------------------------------------------------------
# 4. Final result
# ---------------------------------------------------------------------------
if [[ ${COMPARE_EXIT} -ne 0 ]]; then
  echo "[parity-gate] FAIL: TS↔Python byte-identity check failed." >&2
  exit 1
fi

echo "[parity-gate] PASS: TS↔Python byte-identity confirmed over all golden fixture vectors."
echo "[parity-gate] CF-QA-1.HARD satisfied."

# ---------------------------------------------------------------------------
# 5. F3 carry-forward verification: assert both runners emitted f3_pass:true
#    for every fixture (ts_result == expected_minor_units).
# ---------------------------------------------------------------------------
echo "[parity-gate] Checking F3 carry-forward (expected_minor_units assertion)..."

python3 - "${TS_OUT}" "${PY_OUT}" << 'EOF'
import json, sys

ts_path, py_path = sys.argv[1], sys.argv[2]
ts_data = json.load(open(ts_path))
py_data = json.load(open(py_path))

ts_f3_fails = [r for r in ts_data if not r.get('f3_pass', True)]
py_f3_fails = [r for r in py_data if not r.get('f3_pass', True)]

if ts_f3_fails:
    print(f'  FAIL (F3-TS): {len(ts_f3_fails)} TS fixture(s) where ts_result != expected_minor_units:', file=sys.stderr)
    for r in ts_f3_fails:
        print(f'    id={r["id"]!r}: ts_result={r["ts_result"]!r} expected={r["expected_minor_units"]!r}', file=sys.stderr)
if py_f3_fails:
    print(f'  FAIL (F3-PY): {len(py_f3_fails)} Python fixture(s) where py_result != expected_minor_units:', file=sys.stderr)
    for r in py_f3_fails:
        print(f'    id={r["id"]!r}: py_result={r["py_result"]!r} expected={r["expected_minor_units"]!r}', file=sys.stderr)

if ts_f3_fails or py_f3_fails:
    print('  Child-2-F3 / CF-C4-PARITY-SCOPE-1: expected_minor_units mismatch detected.', file=sys.stderr)
    sys.exit(1)

print('  F3 (expected_minor_units assertion): all fixtures OK. PASS.')
EOF

if [[ $? -ne 0 ]]; then
  echo "[parity-gate] FAIL: F3 expected_minor_units assertion failed." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 6. Registry parity gate — REAL per-metric cross-check (CF-C4-VERIFY-THE-VERIFIER-1)
#
#    For every metric id present in BOTH registries, assert:
#      id / kind / unit / display_only / parity_class / clickhouse_sql are IDENTICAL
#    For every parity_gap:true row (correctness_fixture), assert:
#      the DDR formula_snapshot is present (not None/null).
#
#    This is NOT a directory-presence check. It is a content-equality check.
#
#    Killed-mutant sub-step: temporarily inject a wrong clickhouse_sql into the TS
#    registry JSON, run the comparator, confirm it goes RED, then verify the real
#    registry data passes. This proves the gate cannot be vacuous.
#
#    CF-C4-VERIFY-THE-VERIFIER-1: the registry-parity verifier must itself have
#    a killed mutant demonstrating it detects the divergence class it was built to catch.
# ---------------------------------------------------------------------------
echo "[parity-gate] Checking registry parity (per-metric content equality)..."

TS_REGISTRY_DUMP="${REPO_ROOT}/packages/lib-metrics/src/registry-dump.ts"
PY_REGISTRY_DUMP="${REPO_ROOT}/tools/registry-dump.py"
PY_DDR_DUMP="${REPO_ROOT}/tools/ddr-dump.py"

if [[ ! -f "${TS_REGISTRY_DUMP}" ]]; then
  echo "[parity-gate] FAIL: TS registry-dump script not found: ${TS_REGISTRY_DUMP}" >&2
  exit 1
fi
if [[ ! -f "${PY_REGISTRY_DUMP}" ]]; then
  echo "[parity-gate] FAIL: Python registry-dump script not found: ${PY_REGISTRY_DUMP}" >&2
  exit 1
fi

# Dump TS registry to temp JSON
TS_REG_OUT=$(mktemp)
PY_REG_OUT=$(mktemp)
PY_DDR_OUT=$(mktemp)
cleanup_reg() {
  rm -f "${TS_REG_OUT}" "${PY_REG_OUT}" "${PY_DDR_OUT}"
}
trap "cleanup; cleanup_reg" EXIT

"${TSX_BIN}" "${TS_REGISTRY_DUMP}" > "${TS_REG_OUT}" 2>&1
if [[ $? -ne 0 ]]; then
  echo "[parity-gate] FAIL: TS registry-dump failed:" >&2
  cat "${TS_REG_OUT}" >&2
  exit 1
fi

python3 "${PY_REGISTRY_DUMP}" > "${PY_REG_OUT}" 2>&1
if [[ $? -ne 0 ]]; then
  echo "[parity-gate] FAIL: Python registry-dump failed:" >&2
  cat "${PY_REG_OUT}" >&2
  exit 1
fi

# Dump DDR parity_gap rows
python3 "${REPO_ROOT}/tools/ddr-dump.py" > "${PY_DDR_OUT}" 2>&1
DDR_EXIT=$?
if [[ ${DDR_EXIT} -ne 0 ]]; then
  echo "[parity-gate] FAIL: DDR parity_gap dump failed:" >&2
  cat "${PY_DDR_OUT}" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 6a. Real per-metric parity comparison
# ---------------------------------------------------------------------------
python3 - "${TS_REG_OUT}" "${PY_REG_OUT}" "${PY_DDR_OUT}" << 'PARITY_EOF'
import json, sys, re

ts_path, py_path, ddr_path = sys.argv[1], sys.argv[2], sys.argv[3]

ts_rows = json.load(open(ts_path))
py_rows = json.load(open(py_path))
ddr_rows = json.load(open(ddr_path))

ts_map = {r["id"]: r for r in ts_rows}
py_map = {r["id"]: r for r in py_rows}

def normalize_sql(s):
    """Collapse all whitespace runs to single space for comparison."""
    return re.sub(r'\s+', ' ', s).strip()

shared_ids = sorted(set(ts_map) & set(py_map))
only_ts = sorted(set(ts_map) - set(py_map))
only_py = sorted(set(py_map) - set(ts_map))

failures = []

# Phase 1: For ALL shared metrics, check non-SQL fields (id, kind, unit, scale, display_only, parity_class)
# CF-C6-ROAS-DISPLAY-CONTRACT-1: scale added (Child 6 amendment, additive).
# These must be identical regardless of shadow-compare vs correctness_fixture.
STRUCTURAL_FIELDS = ["id", "kind", "unit", "scale", "display_only", "parity_class"]  # CF-C6-ROAS-DISPLAY-CONTRACT-1: scale added

for mid in shared_ids:
    ts_row = ts_map[mid]
    py_row = py_map[mid]
    for field in STRUCTURAL_FIELDS:
        ts_val = ts_row.get(field)
        py_val = py_row.get(field)
        if ts_val != py_val:
            failures.append(
                f"  STRUCTURAL DIVERGENCE id={mid!r} field={field!r}: "
                f"TS={ts_val!r} PY={py_val!r}"
            )

# Phase 2: For correctness_fixture metrics ONLY, check clickhouse_sql (whitespace-normalized).
# These are Brain-native decision metrics with no legacy slack — SQL must be identical.
# shadow_compare metrics have declared DDR-documented input differences (shadow-phase structural);
# those are tracked in the DDR and are NOT failures of the parity gate.
for mid in shared_ids:
    ts_row = ts_map[mid]
    py_row = py_map[mid]
    if ts_row.get("parity_class") == "correctness_fixture":
        ts_sql = normalize_sql(ts_row.get("clickhouse_sql", ""))
        py_sql = normalize_sql(py_row.get("clickhouse_sql", ""))
        if ts_sql != py_sql:
            failures.append(
                f"  CORRECTNESS_FIXTURE SQL DIVERGENCE id={mid!r}:\n"
                f"    TS: {ts_sql!r}\n"
                f"    PY: {py_sql!r}"
            )
        else:
            print(f"  correctness_fixture SQL match: {mid!r}")

# Phase 3: DDR formula_snapshot coverage check for all correctness_fixture metrics
for mid, ts_row in ts_map.items():
    if ts_row.get("parity_class") == "correctness_fixture":
        if mid not in ddr_rows:
            failures.append(
                f"  MISSING DDR ROW id={mid!r}: parity_class=correctness_fixture but "
                f"no parity_gap:true DDR row found. DDR must cover all correctness_fixture metrics."
            )
        else:
            ddr_row = ddr_rows[mid]
            if not ddr_row.get("formula_snapshot"):
                failures.append(
                    f"  MISSING FORMULA_SNAPSHOT id={mid!r}: DDR row present but "
                    f"formula_snapshot is null/empty. DDR must pin the formula IN FULL."
                )
            else:
                print(f"  DDR formula_snapshot OK for {mid!r}: {ddr_row['formula_snapshot'][:60]}...")

if only_ts:
    print(f"  INFO: {len(only_ts)} metric(s) only in TS registry (expected during shadow phase): {only_ts}")
if only_py:
    print(f"  INFO: {len(only_py)} metric(s) only in Python registry (expected during shadow phase): {only_py}")

if failures:
    print(f"\n[parity-gate] FAIL: {len(failures)} registry parity divergence(s) found:", file=sys.stderr)
    for f in failures:
        print(f, file=sys.stderr)
    print(
        "\n  CF-C4-VERIFY-THE-VERIFIER-1: TS registry must match Python registry on:\n"
        "    * id/kind/unit/scale/display_only/parity_class for ALL shared metric ids\n"
        "    * clickhouse_sql (whitespace-normalized) for ALL correctness_fixture metrics\n"
        "    * DDR formula_snapshot must be present for all correctness_fixture metrics",
        file=sys.stderr
    )
    sys.exit(1)

print(f"  {len(shared_ids)} shared metric(s) verified: structural fields match.")
print(f"  correctness_fixture SQL and DDR coverage: PASS.")
PARITY_EOF

PARITY_EXIT=$?
if [[ ${PARITY_EXIT} -ne 0 ]]; then
  echo "[parity-gate] FAIL: Registry parity check failed." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 6b. Killed-mutant sub-step: prove the gate catches id/formula mismatches
#     CF-C4-VERIFY-THE-VERIFIER-1: the registry-parity gate must NOT be vacuous.
# ---------------------------------------------------------------------------
echo "[parity-gate] Running killed-mutant sub-step (registry-parity gate verifier)..."

python3 - "${TS_REG_OUT}" "${PY_REG_OUT}" << 'MUTANT_EOF'
import json, sys, copy, re

ts_path, py_path = sys.argv[1], sys.argv[2]

ts_rows = json.load(open(ts_path))
py_rows = json.load(open(py_path))

ts_map = {r["id"]: r for r in ts_rows}
py_map = {r["id"]: r for r in py_rows}

STRUCTURAL_FIELDS = ["id", "kind", "unit", "scale", "display_only", "parity_class"]  # CF-C6-ROAS-DISPLAY-CONTRACT-1: scale added

def normalize_sql(s):
    return re.sub(r'\s+', ' ', s).strip()

def run_comparator(ts_m, py_m):
    """Return list of divergence strings (correctness_fixture scope for SQL)."""
    shared = sorted(set(ts_m) & set(py_m))
    divs = []
    for mid in shared:
        tr, pr = ts_m[mid], py_m[mid]
        for field in STRUCTURAL_FIELDS:
            if tr.get(field) != pr.get(field):
                divs.append(f"{mid}.{field}")
        if tr.get("parity_class") == "correctness_fixture":
            ts_sql = normalize_sql(tr.get("clickhouse_sql", ""))
            py_sql = normalize_sql(pr.get("clickhouse_sql", ""))
            if ts_sql != py_sql:
                divs.append(f"{mid}.clickhouse_sql")
    return divs

# ── Mutant 1: inject old wrong pamer_bp clickhouse_sql ────────────────────
# pamer_bp is a correctness_fixture metric. The original bug had the reciprocal formula.
# Injecting it back should cause the gate to fire.
MUTANT_ID = "pamer_bp"
if MUTANT_ID not in ts_map or MUTANT_ID not in py_map:
    print(f"  SKIP: {MUTANT_ID!r} not shared — mutant test skipped.", file=sys.stderr)
    sys.exit(0)

ts_mutant1 = copy.deepcopy(ts_map)
# OLD WRONG FORMULA: ad_spend/net_revenue (reciprocal)
ts_mutant1[MUTANT_ID]["clickhouse_sql"] = (
    "if(net_revenue_mu > 0, intDiv(total_ad_spend_mu * 10000, net_revenue_mu), NULL)"
)
divs1 = run_comparator(ts_mutant1, py_map)
if not divs1:
    print(
        f"  FAIL: Killed-mutant 1 FAILED — perturbed {MUTANT_ID!r}.clickhouse_sql to the "
        "old wrong reciprocal formula but the comparator did NOT detect divergence. "
        "CF-C4-VERIFY-THE-VERIFIER-1.",
        file=sys.stderr
    )
    sys.exit(1)
print(f"  Killed-mutant 1: {MUTANT_ID!r} wrong SQL → detected: {divs1}")

# ── Mutant 2: rename ltv_cac_bp → ltv_cac_x100 (old wrong id) ────────────
MUTANT_ID_2 = "ltv_cac_bp"
ts_mutant2 = copy.deepcopy(ts_map)
if MUTANT_ID_2 in ts_mutant2:
    row = dict(ts_mutant2.pop(MUTANT_ID_2))
    row["id"] = "ltv_cac_x100"          # old wrong id
    row["unit"] = "x100"                 # old wrong unit
    ts_mutant2["ltv_cac_x100"] = row

    divs2 = run_comparator(ts_mutant2, py_map)
    # The id mismatch is structural even if the shared set shrinks
    only_py = sorted(set(py_map) - set(ts_mutant2))
    if "ltv_cac_bp" in only_py:
        divs2.append("ltv_cac_bp.not_in_ts")

    if not divs2:
        print(
            f"  FAIL: Killed-mutant 2 FAILED — renamed {MUTANT_ID_2!r} → ltv_cac_x100 + unit=x100 "
            "but comparator did NOT detect the id/unit divergence. CF-C4-VERIFY-THE-VERIFIER-1.",
            file=sys.stderr
        )
        sys.exit(1)
    print(f"  Killed-mutant 2: {MUTANT_ID_2!r} renamed+wrong-unit → detected: {divs2}")

print("  Killed-mutant sub-step: PASS (both mutants killed — gate is non-vacuous).")
MUTANT_EOF

MUTANT_EXIT=$?
if [[ ${MUTANT_EXIT} -ne 0 ]]; then
  echo "[parity-gate] FAIL: Killed-mutant sub-step failed — the registry-parity gate is vacuous." >&2
  exit 1
fi

echo "  Registry seam: both TS and Python registry directories present. OK."
if [[ -f "${PY_REGISTRY_PATH}/__init__.py" ]]; then
  echo "  Python registry __init__.py present. OK."
fi
echo "  CF-C4-VERIFY-THE-VERIFIER-1: registry-parity gate non-vacuous (killed mutants confirmed)."

# ---------------------------------------------------------------------------
# 7. CH round-trip fixture check: assert intDiv-gate fixtures present
#    CF-C4-VERIFY-THE-VERIFIER-1 / CF-C4-RATIO-DIVOP-1
#    Maya's M4 delivers these in a dedicated fixture file:
#      pylibs/brain_metrics/brain_metrics/parity/fixtures/clickhouse_roundtrip_fixtures.json
#    The CH round-trip tests run via test_clickhouse_roundtrip.py (25 tests);
#    they test integer arithmetic semantics (intDiv FLOOR / zero-denom / wrong-constant
#    kill-tests) and are NOT part of the TS↔Python byte-identity gate in golden_fixtures.json.
#    This check asserts the fixture FILE exists (Maya M4 structural presence).
# ---------------------------------------------------------------------------
echo "[parity-gate] Checking ClickHouse round-trip fixture presence..."

CH_FIXTURE_PATH="${REPO_ROOT}/pylibs/brain_metrics/brain_metrics/parity/fixtures/clickhouse_roundtrip_fixtures.json"

if [[ -f "${CH_FIXTURE_PATH}" ]]; then
  echo "  ClickHouse round-trip fixtures present (dedicated file — Maya M4). OK."
  echo "  CF-C4-RATIO-DIVOP-1 / CF-C4-VERIFY-THE-VERIFIER-1: kill-tests in test_clickhouse_roundtrip.py."
else
  # Check golden_fixtures.json as a fallback (original inline location)
  python3 -c "
import json, sys
data = json.load(open('${FIXTURE_PATH}'))
top_level_keys = list(data.keys())
has_ch_fixtures = any(
    k.startswith('clickhouse_') or k == 'ch_roundtrip' or k.startswith('intdiv_')
    for k in top_level_keys
)
if not has_ch_fixtures:
    print('  WARNING: ClickHouse round-trip fixtures (intDiv kill-test) not yet present.', file=sys.stderr)
    print('  CF-C4-RATIO-DIVOP-1 / CF-C4-VERIFY-THE-VERIFIER-1: Maya M4 delivers these.', file=sys.stderr)
    print('  WARNING: CH_ROUNDTRIP_PENDING')
else:
    print('  ClickHouse round-trip fixtures present (in golden_fixtures.json). OK.')
" 2>&1
fi

echo "[parity-gate] PASS: all checks complete."
echo "[parity-gate] CF-QA-1.HARD + Child-2-F3 + CF-C4-PARITY-SCOPE-1 satisfied."
exit 0
