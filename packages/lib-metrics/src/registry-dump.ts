#!/usr/bin/env node
// @paradigm: sql
// registry-dump.ts — Dump the TS METRIC_REGISTRY as a JSON array for the parity gate.
// Invoked by tools/check-metrics-parity.sh step 6 (registry-parity gate).
//
// Output: JSON array of { id, kind, unit, scale, display_only, parity_class, clickhouse_sql }
// One row per metric in METRIC_REGISTRY.
//
// CF-C4-VERIFY-THE-VERIFIER-1: this output is compared against the Python registry dump
// by check-metrics-parity.sh to assert cross-language registry parity.
//
// CF-C6-ROAS-DISPLAY-CONTRACT-1: `scale` field added (Child 6 amendment, additive).
// The parity gate asserts scale byte-identity across TS↔Python.

import { METRIC_REGISTRY } from './registry/index.js';

const rows = Object.values(METRIC_REGISTRY).map((def) => ({
  id: def.id,
  kind: def.kind,
  unit: def.unit,
  // CF-C6-ROAS-DISPLAY-CONTRACT-1: scale is 10000 (bp), 100 (×100), or 1 (money/count).
  scale: def.scale,
  display_only: def.display_only,
  parity_class: def.parity_class,
  clickhouse_sql: def.clickhouse_sql,
}));

process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
