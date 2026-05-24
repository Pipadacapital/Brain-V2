#!/usr/bin/env bash
# check-metrics-parity.sh — CI byte-identity parity gate (CF-QA-1.HARD)
#
# Runs TS decimalToMinorUnits + Python decimal_to_minor_units over the SAME
# golden fixture vectors and asserts byte-identical BIGINT outputs.
# Any single divergence exits non-zero and fails CI.
#
# Wired as turbo root task //#check:metrics-parity with inputs:
#   packages/lib-metrics/**, pylibs/brain_metrics/**, tools/check-metrics-parity.sh
#
# @paradigm: sql (deterministic integer comparator; zero float; zero live DB)
# CF-QA-1.HARD, CF-C2-GOLDEN-1, CF-C2-FIXTURE-PROOF-1

set -euo pipefail

# ---------------------------------------------------------------------------
# Resolve project root regardless of where the script is called from.
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

FIXTURE_PATH="${REPO_ROOT}/pylibs/brain_metrics/brain_metrics/parity/fixtures/golden_fixtures.json"
TS_RUNNER="${REPO_ROOT}/packages/lib-metrics/src/parity-runner.ts"
PY_RUNNER="${REPO_ROOT}/tools/parity-runner.py"

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
exit 0
