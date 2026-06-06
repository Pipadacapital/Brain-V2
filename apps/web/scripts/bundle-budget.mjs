#!/usr/bin/env node
// Web bundle-size budget gate. Sums all emitted .next/static JS and fails if it
// exceeds the budget — a cheap regression guard that catches a duplicated heavy
// dep (e.g. recharts bundled twice) or a new large import landing on the routes.
// Run AFTER `next build`. Budget is total static JS (a robust proxy for the
// per-route First Load JS, without parsing Next's text output).

import { readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BUDGET_KB = Number(process.env.WEB_BUNDLE_BUDGET_KB ?? 3300)

const here = dirname(fileURLToPath(import.meta.url))
const staticDir = join(here, '..', '.next', 'static')

if (!existsSync(staticDir)) {
  console.error(`bundle-budget: ${staticDir} not found — run \`next build\` first.`)
  process.exit(2)
}

let bytes = 0
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walk(p)
    else if (entry.name.endsWith('.js')) bytes += statSync(p).size
  }
}
walk(staticDir)

const kb = Math.round(bytes / 1024)
console.log(`web bundle: ${kb} KB of .next/static JS — budget ${BUDGET_KB} KB`)
if (kb > BUDGET_KB) {
  console.error(
    `FAIL: bundle ${kb} KB exceeds budget ${BUDGET_KB} KB. ` +
    `Investigate (dynamic-import heavy components, check for duplicated deps) or, ` +
    `if intentional, raise WEB_BUNDLE_BUDGET_KB in the CI job with justification.`,
  )
  process.exit(1)
}
console.log('OK: within budget.')
