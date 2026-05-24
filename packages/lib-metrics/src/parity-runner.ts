#!/usr/bin/env node
// @paradigm: sql
// CI parity gate runner — reads golden fixtures and outputs BIGINT conversion results as JSON.
// Invoked by tools/check-metrics-parity.sh to get the TS side of the byte-identity comparison.
// CF-QA-1.HARD.
//
// Usage: node parity-runner.ts <fixture_path>
// Output: JSON array of { id, ts_result } — one per fixture vector.

import { readFileSync } from 'node:fs';
import { decimalToMinorUnits } from './convert.js';

const fixturePath = process.argv[2];
if (!fixturePath) {
  process.stderr.write('parity-runner: usage: node parity-runner.ts <fixture_path>\n');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(fixturePath, 'utf-8')) as Record<string, unknown>;

interface FixtureVector {
  id: string;
  amount: string;
  subunit_multiplier: number;
  expected_minor_units: number;
}

// Flatten all fixture groups (skip _meta).
const vectors: FixtureVector[] = [];
for (const [key, items] of Object.entries(raw)) {
  if (key.startsWith('_')) continue;
  if (!Array.isArray(items)) continue;
  for (const item of items) {
    if (typeof item === 'object' && item !== null && 'amount' in item && 'expected_minor_units' in item) {
      vectors.push(item as FixtureVector);
    }
  }
}

const results: Array<{ id: string; ts_result: string }> = [];
let anyError = false;

for (const v of vectors) {
  try {
    const result = decimalToMinorUnits(v.amount, v.subunit_multiplier);
    results.push({ id: v.id, ts_result: result.toString() });
  } catch (e) {
    process.stderr.write(`parity-runner: ERROR on fixture ${v.id}: ${e}\n`);
    anyError = true;
  }
}

process.stdout.write(JSON.stringify(results, null, 2) + '\n');

if (anyError) {
  process.exit(1);
}
