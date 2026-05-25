#!/usr/bin/env python3
"""registry-dump.py — Dump the Python METRIC_REGISTRY as a JSON array for the parity gate.

Invoked by tools/check-metrics-parity.sh step 6 (registry-parity gate).

Output: JSON array of { id, kind, unit, scale, display_only, parity_class, clickhouse_sql }
One row per metric in METRIC_REGISTRY.

CF-C4-VERIFY-THE-VERIFIER-1: this output is compared against the TS registry dump
by check-metrics-parity.sh to assert cross-language registry parity.

CF-C6-ROAS-DISPLAY-CONTRACT-1: `scale` field added (Child 6 amendment, additive).
The parity gate asserts scale byte-identity across TS↔Python.

@paradigm: sql
"""

from __future__ import annotations

import json
import sys
import os

# Support being invoked from any working directory — resolve pylibs relative to this script.
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(_SCRIPT_DIR)
_PYLIBS = os.path.join(_REPO_ROOT, "pylibs", "brain_metrics")

if _PYLIBS not in sys.path:
    sys.path.insert(0, _PYLIBS)

from brain_metrics.registry.definitions import METRIC_REGISTRY  # noqa: E402

rows = [
    {
        "id": mdef.id,
        "kind": mdef.kind,
        "unit": mdef.unit,
        # CF-C6-ROAS-DISPLAY-CONTRACT-1: scale is 10000 (bp), 100 (×100), or 1 (money/count).
        "scale": mdef.scale,
        "display_only": mdef.display_only,
        "parity_class": mdef.parity_class,
        "clickhouse_sql": mdef.clickhouse_sql,
    }
    for mdef in METRIC_REGISTRY.values()
]

print(json.dumps(rows, indent=2))
