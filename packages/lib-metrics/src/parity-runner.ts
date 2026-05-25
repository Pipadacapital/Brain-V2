#!/usr/bin/env node
// @paradigm: sql
// CI parity gate runner — reads golden fixtures and outputs BIGINT conversion results as JSON.
// Invoked by tools/check-metrics-parity.sh to get the TS side of the byte-identity comparison.
// CF-QA-1.HARD.
//
// Child-4 extension (F3 carry-forward):
//   Also asserts expected_minor_units per fixture — the ts_result must ALSO match the
//   declared `expected_minor_units` in the fixture. A fixture where ts_result != expected_minor_units
//   is reported as an F3 violation (the declared expectation is wrong or the formula is wrong).
//   This catches fixtures that are internally consistent (TS==Python) but both wrong.
//
// Usage: node parity-runner.ts <fixture_path>
// Output: JSON array of { id, ts_result, expected_minor_units, f3_pass } — one per fixture vector.

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

const results: Array<{ id: string; ts_result: string; expected_minor_units: number; f3_pass: boolean }> = [];
let anyError = false;
let f3Violations = 0;

for (const v of vectors) {
  try {
    const result = decimalToMinorUnits(v.amount, v.subunit_multiplier);
    const tsResultNum = Number(result);
    // F3 carry-forward (Child-4): assert ts_result == expected_minor_units.
    // A passing TS↔Python byte-identity check with BOTH sides wrong would be invisible
    // without this check. expected_minor_units is the ground-truth anchor.
    const f3Pass = tsResultNum === v.expected_minor_units;
    if (!f3Pass) {
      process.stderr.write(
        `parity-runner: F3 VIOLATION on fixture ${v.id}: ` +
        `ts_result=${result} != expected_minor_units=${v.expected_minor_units} ` +
        `(amount=${v.amount}, multiplier=${v.subunit_multiplier})\n`
      );
      f3Violations++;
      anyError = true;
    }
    results.push({
      id: v.id,
      ts_result: result.toString(),
      expected_minor_units: v.expected_minor_units,
      f3_pass: f3Pass,
    });
  } catch (e) {
    process.stderr.write(`parity-runner: ERROR on fixture ${v.id}: ${e}\n`);
    anyError = true;
  }
}

process.stdout.write(JSON.stringify(results, null, 2) + '\n');

if (f3Violations > 0) {
  process.stderr.write(
    `parity-runner: ${f3Violations} F3 violation(s): ts_result != expected_minor_units. ` +
    'CF-C4-PARITY-SCOPE-1 / Child-2-F3.\n'
  );
}

if (anyError) {
  process.exit(1);
}
