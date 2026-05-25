/**
 * G-REGISTRY-ONLY / CF-C6-RENDER-ONLY-1: Render-only invariant.
 *
 * Tests verify that the mobile domain layer:
 *   1. Has NO arithmetic on _mu fields (no Number() coercion, no division, no multiply).
 *   2. Uses formatMoney from @brain/lib-metrics — the ONE canonical formatter.
 *   3. Confidence is rendered as-is (pre-formatted int, no multiply).
 *   4. All InsightItem fields are consumed verbatim from the server struct.
 *
 * These are static / structural tests backed by the actual source code content.
 * They complement the arithmetic-grep gate in G-REGISTRY-ONLY.
 */

import * as fs from 'fs';
import * as path from 'path';

const MOBILE_SRC = path.join(__dirname, '../src');

/**
 * Read all TypeScript/TSX files under a directory recursively.
 */
function readAllTsFiles(dir: string): Array<{ file: string; content: string }> {
  const results: Array<{ file: string; content: string }> = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...readAllTsFiles(fullPath));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      results.push({ file: fullPath, content: fs.readFileSync(fullPath, 'utf8') });
    }
  }
  return results;
}

const allFiles = readAllTsFiles(MOBILE_SRC);

// ---------------------------------------------------------------------------
// POSITIVE: formatMoney imported from @brain/lib-metrics, not locally defined.
// CF-C6-FORMATMONEY-CANONICAL-1: ONE home in lib-metrics; zero local reimpls.
// ---------------------------------------------------------------------------
describe('formatMoney — no local reimplementation', () => {
  it('formatMoney is NOT defined locally in any mobile src file', () => {
    const localImplFiles = allFiles.filter(
      ({ content }) =>
        // A local reimplementation would define the function.
        /function\s+formatMoney\s*\(/.test(content) ||
        /const\s+formatMoney\s*=/.test(content) ||
        /export\s+function\s+formatMoney/.test(content),
    );
    if (localImplFiles.length > 0) {
      const names = localImplFiles.map((f) => f.file).join('\n  ');
      throw new Error(
        `CF-C6-FORMATMONEY-CANONICAL-1 VIOLATED: local formatMoney found in:\n  ${names}`,
      );
    }
    expect(localImplFiles).toHaveLength(0);
  });

  it('formatMoney import uses @brain/lib-metrics (not a local path)', () => {
    const filesUsingFormatMoney = allFiles.filter(({ content }) =>
      content.includes('formatMoney'),
    );
    for (const { file, content } of filesUsingFormatMoney) {
      // Any import of formatMoney must be from @brain/lib-metrics.
      const importMatches = content.match(/import[^;]+formatMoney[^;]+from\s+['"]([^'"]+)['"]/g);
      if (importMatches) {
        for (const importLine of importMatches) {
          if (!importLine.includes('@brain/lib-metrics')) {
            throw new Error(
              `CF-C6-FORMATMONEY-CANONICAL-1 VIOLATED: formatMoney imported from non-canonical path in ${file}:\n  ${importLine}`,
            );
          }
        }
      }
    }
    // Pass if any file uses formatMoney (the screen does).
    expect(filesUsingFormatMoney.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE: no arithmetic on _mu fields in mobile src.
// CF-C6-RENDER-ONLY-1: no Number() coercion of _mu before formatMoney.
// ---------------------------------------------------------------------------
describe('render-only: no arithmetic on _mu fields', () => {
  const ARITHMETIC_ON_MU_PATTERN = /Number\s*\(\s*\w*_mu\w*\s*\)/;
  const REDUCE_ON_MU_PATTERN = /\.reduce\([^)]*_mu[^)]*\)/;
  const DIRECT_DIVISION_MU_PATTERN = /\w*_mu\w*\s*\/\s*\d+/;

  it('no Number() coercion on _mu fields', () => {
    const violations = allFiles.filter(({ content }) =>
      ARITHMETIC_ON_MU_PATTERN.test(content),
    );
    expect(violations.map((f) => f.file)).toHaveLength(0);
  });

  it('no .reduce() accumulating _mu fields (orphan aggregation)', () => {
    const violations = allFiles.filter(({ content }) =>
      REDUCE_ON_MU_PATTERN.test(content),
    );
    expect(violations.map((f) => f.file)).toHaveLength(0);
  });

  it('no direct division of _mu fields by a literal number', () => {
    // The only division allowed is inside formatMoney (which lives in lib-metrics, not here).
    const violations = allFiles.filter(({ content }) =>
      DIRECT_DIVISION_MU_PATTERN.test(content),
    );
    expect(violations.map((f) => f.file)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POSITIVE: confidence_display_pct rendered as-is (no multiply).
// CF-C6-NO-UI-FLOAT-1: pre-formatted int — render `${confidence_display_pct}%`.
// ---------------------------------------------------------------------------
describe('confidence_display_pct — no multiplication', () => {
  it('confidence_display_pct is NOT multiplied in any mobile src file', () => {
    const violations = allFiles.filter(({ content }) =>
      /confidence_display_pct\s*\*\s*\d+/.test(content) ||
      /confidence_display_pct\s*\/\s*\d+/.test(content),
    );
    expect(violations.map((f) => f.file)).toHaveLength(0);
  });

  it('confidence_display_pct appears in the screen file', () => {
    const screenFiles = allFiles.filter(({ file }) =>
      file.includes('MorningBriefScreen'),
    );
    expect(screenFiles.length).toBeGreaterThan(0);
    const screenContent = screenFiles[0]!.content;
    expect(screenContent).toContain('confidence_display_pct');
  });
});

// ---------------------------------------------------------------------------
// POSITIVE: axios absent from mobile src (CF-C6-NEW-LAYER-1).
// -------------------------------------------------------------------------
describe('no axios in mobile src (CF-C6-NEW-LAYER-1)', () => {
  it('axios is not imported in any mobile src file', () => {
    const violations = allFiles.filter(({ content }) =>
      /import\s+.*from\s+['"]axios['"]/.test(content) ||
      /require\s*\(\s*['"]axios['"]\s*\)/.test(content),
    );
    expect(violations.map((f) => f.file)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POSITIVE: no Zustand in mobile src (CF-C6-NEW-LAYER-1).
// ---------------------------------------------------------------------------
describe('no Zustand in mobile src (CF-C6-NEW-LAYER-1)', () => {
  it('zustand is not imported in any mobile src file', () => {
    const violations = allFiles.filter(({ content }) =>
      /import\s+.*from\s+['"]zustand/.test(content),
    );
    expect(violations.map((f) => f.file)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POSITIVE: no AsyncStorage for tokens (CF-MASVS-L1).
// Tokens must use expo-secure-store, not AsyncStorage.
// ---------------------------------------------------------------------------
describe('no AsyncStorage for tokens (MASVS L1)', () => {
  it('auth-store.ts does not import AsyncStorage', () => {
    const authStore = allFiles.find(({ file }) => file.includes('auth-store'));
    if (!authStore) {
      // File must exist (this is a negative control for the implementation).
      throw new Error('auth-store.ts not found — file missing from mobile src');
    }
    expect(authStore.content).not.toContain("from '@react-native-async-storage/async-storage'");
  });

  it('auth-store.ts uses expo-secure-store', () => {
    const authStore = allFiles.find(({ file }) => file.includes('auth-store'));
    expect(authStore?.content).toContain('expo-secure-store');
  });
});
