#!/usr/bin/env python3
"""ddr-dump.py — Dump the DDR parity_gap rows as a JSON dict for the registry-parity gate.

Invoked by tools/check-metrics-parity.sh step 6.
Output: JSON dict keyed by metric_id, value = { metric_id, parity_gap, formula_snapshot }
Only parity_gap:true rows are included.

CF-C4-VERIFY-THE-VERIFIER-1: the registry-parity gate cross-checks TS correctness_fixture
metrics against the DDR formula_snapshot to ensure all three artifacts agree.

@paradigm: sql
"""

from __future__ import annotations

import json
import sys
import os

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(_SCRIPT_DIR)
_PYLIBS = os.path.join(_REPO_ROOT, "pylibs", "brain_metrics")

if _PYLIBS not in sys.path:
    sys.path.insert(0, _PYLIBS)

from brain_metrics.parity.definitional_delta_register import DEFINITIONAL_DELTA_REGISTER  # noqa: E402

parity_gap_rows = {
    mid: {
        "metric_id": mid,
        "parity_gap": row.parity_gap,
        "formula_snapshot": row.formula_snapshot,
    }
    for mid, row in DEFINITIONAL_DELTA_REGISTER.items()
    if row.parity_gap
}

print(json.dumps(parity_gap_rows, indent=2))
