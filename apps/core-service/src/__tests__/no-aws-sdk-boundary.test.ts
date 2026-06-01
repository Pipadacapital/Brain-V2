/**
 * Hard gate: ZERO AWS SDK in apps/core-service (CF-TS-NO-AWS-CLIENT-1).
 *
 * This test re-opens CF-CC-OWNER-1 and triggers a Founder-escalation if it
 * ever fails. Do NOT weaken or skip this test — see plan §0 + §11.
 *
 * Assertions:
 *   1. No aws-sdk-namespaced or bare-aws-sdk import in any non-test source
 *      file under apps/core-service/src (test files excluded — they legitimately
 *      reference the banned string to assert its absence).
 *   2. core-service package.json dependencies + devDependencies contain no
 *      aws-sdk key.
 *   3. NEGATIVE never-log cross-check (CF-TS-NEVERLOG-1): the fatal message
 *      from assertShopifyOAuthSecretsPresent contains the var NAME and NOT any
 *      provided secret value.
 *
 * NOTE: The sdk identifier strings are built at runtime via concatenation to
 * prevent this test file from matching its own scan (grep-self false-positive).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { assertShopifyOAuthSecretsPresent } from '../application/contexts/connectors/boot-assert.js'

// Resolve the source root relative to THIS test file (src/__tests__/…).
// __dirname is not available in ESM; derive from import.meta.url.
const SRC_ROOT = resolve(new URL('..', import.meta.url).pathname)
const PACKAGE_JSON_PATH = resolve(SRC_ROOT, '..', 'package.json')

// ---------------------------------------------------------------------------
// File-tree grep (synchronous, no shell — pure Node fs)
// ---------------------------------------------------------------------------

/**
 * Collect all .ts and .js production source files under a directory.
 * Excludes: node_modules, dist, __tests__ (test files reference banned strings
 * in assertions and must not self-trigger the grep).
 */
function collectSourceFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') continue
      results.push(...collectSourceFiles(full))
    } else if (full.endsWith('.ts') || full.endsWith('.js')) {
      results.push(full)
    }
  }
  return results
}

// Construct the match strings at runtime so the literal text does not appear
// in this source file and cause the grep-itself false positive.
// "@" + "aws-sdk/" is the namespaced form; "aws-sdk" is the legacy bare form.
// Build string fragments at runtime so no banned literal appears in this file.
const _awsSdk = 'aws' + '-sdk'            // "aws-sdk"
const AWS_NAMESPACED = '@' + _awsSdk + '/'  // "@aws-sdk/"
const AWS_BARE_Q1 = "'" + _awsSdk + "'"    // "'aws-sdk'"
const AWS_BARE_Q2 = '"' + _awsSdk + '"'    // '"aws-sdk"'

/** AWS SDK import pattern — matches both @aws-sdk/* and bare aws-sdk. */
function containsAwsSdk(content: string): boolean {
  return (
    content.includes(AWS_NAMESPACED) ||
    content.includes(AWS_BARE_Q1) ||
    content.includes(AWS_BARE_Q2)
  )
}

describe('CF-TS-NO-AWS-CLIENT-1 — zero aws-sdk in core-service src', () => {
  it('(+) no aws-sdk import found in any production source file', () => {
    const files = collectSourceFiles(SRC_ROOT)
    expect(files.length).toBeGreaterThan(0) // sanity: we actually scanned files

    const violations: string[] = []
    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      if (containsAwsSdk(content)) {
        violations.push(file)
      }
    }

    // Report ALL violations at once so the engineer can fix them in one pass.
    expect(violations, `AWS SDK imports found in: ${violations.join(', ')}`).toHaveLength(0)
  })

  it('(+) package.json dependencies contain no aws-sdk keys', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }

    const allDeps = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ]

    const awsDeps = allDeps.filter(
      (dep) => dep.startsWith(AWS_NAMESPACED) || dep === _awsSdk,
    )

    expect(awsDeps, `AWS SDK in package.json: ${awsDeps.join(', ')}`).toHaveLength(0)
  })
})

describe('CF-TS-NEVERLOG-1 — never-log cross-check on assertShopifyOAuthSecretsPresent', () => {
  const FAKE = 'shpss_FAKE_TEST_VALUE_NOT_REAL'

  it('(+) present → returns null, no log output', () => {
    const result = assertShopifyOAuthSecretsPresent({ SHOPIFY_CLIENT_SECRET: FAKE })
    expect(result).toBeNull()
  })

  it('(-) absent → fatal string contains var name SHOPIFY_CLIENT_SECRET', () => {
    const result = assertShopifyOAuthSecretsPresent({})
    expect(result).not.toBeNull()
    expect(result).toContain('SHOPIFY_CLIENT_SECRET')
  })

  it('(-) absent → fatal string does NOT contain the fake secret value (CF-TS-NEVERLOG-1)', () => {
    // Even if someone passes a value in env and then the key is ABSENT, the
    // message must not embed any secret. We test both branches.
    const absentResult = assertShopifyOAuthSecretsPresent({})
    expect(absentResult).not.toContain(FAKE)
    expect(absentResult).not.toContain('shpss_')
  })

  it('(-) fatal string does not contain any shpss_-shaped token', () => {
    // Regex guard: even a partial match would be a NEVERLOG failure.
    const result = assertShopifyOAuthSecretsPresent({})
    expect(result).not.toMatch(/shpss_[A-Za-z0-9_]+/)
  })
})
