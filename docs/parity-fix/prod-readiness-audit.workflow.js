export const meta = {
  name: 'brain-production-readiness-audit',
  description: 'Adversarially-verified production-readiness audit of Brain across 11 dimensions; outputs a severity-ranked report with concrete fixes',
  phases: [
    { title: 'Audit', detail: 'one agent per production-readiness dimension (read-only, empirically grounded)' },
    { title: 'Verify', detail: 'adversarial skeptic per P0/P1 finding — refute or confirm' },
    { title: 'Synthesize', detail: 'dedup + prioritize -> production-readiness-report.md' },
  ],
}

const SCHEMA_ARTIFACT = 'docs/parity-fix/00-live-schema.md'
const LEGACY = 'legacy project'

const COMMON = [
  'You are auditing the Brain app for PRODUCTION READINESS. The local stack is LIVE and you can inspect it:',
  '- Postgres: docker exec brain-postgres-dev psql -U postgres -d brain_dev -c "<SQL>" (brain_dev; READ-ONLY — SELECT/introspection only, NO writes/DDL).',
  '- ClickHouse: docker exec brain-clickhouse-dev clickhouse-client --user brain_app --password brain_app_pw --database brain -q "<SQL>" (read RMT tables with FINAL).',
  '- Gateway logs (real errors from the user clicking around): docker logs brain-api-gateway 2>&1 | tail -200.',
  '- Gateway health: curl -s http://localhost:3001/health. Web: http://localhost:3000.',
  'SHARED GROUND TRUTH: read ' + SCHEMA_ARTIFACT + ' for the EXACT live PG+CH schema (what columns/tables actually exist). The new app is apps/web + apps/api-gateway + apps/core-service + packages/*. The LEGACY reference app (the behavior to match) is "' + LEGACY + '/" (backend = ' + LEGACY + '/backend/src, frontend = ' + LEGACY + '/frontend). Legacy is REFERENCE ONLY — never edit it.',
  'CONTEXT: data was just migrated from legacy Supabase into local PG (hot mirror) + CH (OLAP facts); READ_FROM_CH=true; BRAIN_GATEWAY_LOCAL_HARNESS=false (stub plane OFF). net_sales = gross minus discount (Brain definition — KEEP it). Useful docs: docs/adr-convergence-001-schema-100-integrations.md, docs/legacy-parity-audit-v2.md, docs/parity-progress.md, docs/scale-performance-plan-2026-06-02.md.',
  'Ground every finding in EVIDENCE (a log line, a query result, a file:line). Do NOT report style nits or speculative issues — only things that genuinely block or risk a production launch. Severity: P0 = breaks a user-facing feature / data wrong / security hole; P1 = serious risk or missing safety net; P2 = should-fix hardening. For each finding give a CONCRETE fix (file + what to change) and a VERIFICATION step.',
].join('\n')

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['dimension', 'summary', 'findings'],
  properties: {
    dimension: { type: 'string' },
    summary: { type: 'string', description: 'one-paragraph state of this dimension' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'severity', 'location', 'issue', 'prodImpact', 'evidence', 'fix', 'verification'],
        properties: {
          id: { type: 'string', description: 'short slug e.g. readpath-distributions-vendor-product-id' },
          title: { type: 'string' },
          severity: { type: 'string', enum: ['P0', 'P1', 'P2'] },
          location: { type: 'string', description: 'file:line or component/endpoint' },
          issue: { type: 'string' },
          prodImpact: { type: 'string' },
          evidence: { type: 'string', description: 'the log line / query result / code excerpt proving it is real' },
          fix: { type: 'string', description: 'concrete change: file + what to do' },
          verification: { type: 'string' },
        },
      },
    },
  },
}

const DIMENSIONS = [
  { key: 'readpath-correctness', focus: 'Read-path query correctness. Inspect EVERY query in apps/core-service/src/application/contexts/connectors/sync/fact-analytics.ts (PG) and fact-analytics-ch.ts (CH) and apps/api-gateway/src/infrastructure/local-db-data-plane.ts (~59 methods). Cross-check every table/column referenced against the live schema (' + SCHEMA_ARTIFACT + '). Find: missing columns (e.g. li.vendor_product_id), wrong table names (connector_line_item_facts vs _hot), CH syntax errors, PG/CH variant divergence, and the silent catch{} that hides CH errors then re-throws on PG fallback. Tie each to the tRPC endpoint it breaks. Confirm by grepping logs for INTERNAL_SERVER_ERROR trpc_path values and reproducing the SQL via psql/clickhouse-client.' },
  { key: 'stub-mock-elimination', focus: 'Zero stub/mock/dummy/hardcoded data in any user-facing path (Founder requirement: live data EVERYWHERE). Grep the gateway + core + web for: StubDataPlane, harness, hardcoded numbers/arrays returned as data, placeholder/unknown fallbacks that mask missing data, Math.random, faker, TODO-return-empty, the "honest-deferred" stubs from docs/parity-progress.md. For each, determine whether real data EXISTS in PG/CH to back it (if yes -> must wire to live; if no -> must be honest-empty, not fabricated). List every fabricated value still reachable in production.' },
  { key: 'migration-completeness', focus: 'Migration completeness + data correctness vs legacy. Compare migrated facts (PG hot + CH) against legacy source tables (legacy schema in ' + LEGACY + '/backend/prisma/schema.prisma). Find DROPPED source columns the read path needs: line-item vendor_product_id (legacy shopify_line_items.product_shopify_id / woo product_id), line discount/tax/cogs/line_total, order is_new_customer correctness, product cogs_mu population, shipment facts (is the PG shipment table even present?), refund mapping. For each gap: which endpoint/metric it breaks + the ETL fix. Verify counts/sums vs legacy where possible.' },
  { key: 'tenant-isolation-rls', focus: 'Multi-tenant isolation. Verify RLS is ENABLED + FORCED + fail-closed (no app.workspace_id -> 0 rows) on EVERY table holding tenant data in brain_dev. For each connector_*/workspace_* table check pg_policies + relrowsecurity + relforcerowsecurity. Test fail-closed empirically (SELECT with no app.workspace_id set returns 0). Check apps/core-service/src/infrastructure/db/workspace-context.ts sets the GUC correctly and cannot leak across tenants. Note the standing OPEN-P0 (live Supabase zero RLS) as context but audit the LOCAL brain_dev prod-shape.' },
  { key: 'secrets-credentials', focus: 'Secrets hygiene. Grep the repo (exclude node_modules, "' + LEGACY + '") for hardcoded secrets/passwords/tokens/keys, connection strings with passwords, the legacy Supabase password, default dev passwords (postgres/postgres, brain_app_pw, rls_app_pw) used as if prod, committed .env files. Check credential custody (CONNECTOR_CUSTODY_KEY) and OAuth client-secret handling. Flag anything that would ship a secret or a dev-default into production.' },
  { key: 'authn-authz', focus: 'AuthN + AuthZ. Audit apps/api-gateway auth: JWT verification (real Supabase), procedure builders (protectedProc/superadminProc), every tRPC router authz gate, the admin suite (/admin, SUPERADMIN). Find: endpoints missing auth, missing workspace-membership checks, role-escalation gaps, auth middleware fail-open vs fail-closed. Verify unauth requests are rejected (curl tRPC without token).' },
  { key: 'resilience-errors', focus: 'Resilience + error handling. Find unhandled promise rejections, empty/swallowing catch blocks (esp. the catch{} PG-fallback in fact-analytics that hides CH failures), missing timeouts on DB/CH/HTTP calls, no retry/circuit-breaker on external calls, crashes on null/empty data, missing zod validation on tRPC inputs, process-level crash safety. Rank by production blast radius.' },
  { key: 'observability', focus: 'Observability. Audit structured logging (pino), trace_id propagation end-to-end (verify it reaches CH/PG query context + responses), metrics (packages/lib-metrics — exported/scraped?), health/readiness endpoints, error reporting. Find gaps that would make a production incident undiagnosable.' },
  { key: 'performance-scale', focus: 'Performance + scale. Find: N+1 patterns, missing indexes (pg_indexes vs the WHERE/JOIN columns the read path uses), full-table scans, CH queries missing FINAL (correctness) or missing PREWHERE/workspace_id-first (perf), OFFSET pagination on large tables (should be keyset — docs/req-keyset-pagination-admin-tables.md), unbounded result sets, the double-version CH order rows (170894 vs 85447 — OPTIMIZE FINAL needed?). Reference docs/scale-performance-plan-2026-06-02.md.' },
  { key: 'tests-ci', focus: 'Test + CI readiness. Does the conformance suite (tests/conformance C1-C14) pass? Is the metric TS<->Python parity gate green? Are the erroring endpoints covered by tests (clearly not, since they fail at runtime)? Any real-network smoke tests? Run the suites you can (pnpm -w test or per-package) and report pass/fail + coverage gaps on the broken read paths. Flag missing CI gates (drift gate from ADR P0-4).' },
  { key: 'config-infra', focus: 'Config + infra. Audit: env var validation (fail-fast on missing required env vs silent misbehavior?), the Dockerfiles (just fixed for proto-ts rename — any other drift?), docker-compose vs a real prod target (CDK/IaC under infra/ or cdk/ if present), the READ_FROM_CH flag (should prod always read CH?), build reproducibility, the open ADR-CONVERGENCE-001 P0/P1 backlog (vendor ENUM->TEXT, canonical fact-schema CI drift gate, status-gated purge). List what must be true in config before prod.' },
]

phase('Audit')
const audited = await pipeline(
  DIMENSIONS,
  (d) => agent(COMMON + '\n\n=== YOUR DIMENSION: ' + d.key + ' ===\n' + d.focus + '\n\nReturn structured findings. Be exhaustive within this dimension but report ONLY real, evidence-backed, production-relevant issues.',
    { label: 'audit:' + d.key, phase: 'Audit', schema: FINDINGS_SCHEMA }),
  (res, d) => {
    if (!res || !res.findings) return { dimension: d.key, summary: (res && res.summary) || '', findings: [] }
    const toVerify = res.findings.filter((f) => f.severity === 'P0' || f.severity === 'P1')
    const p2 = res.findings.filter((f) => f.severity === 'P2').map((f) => ({ ...f, verdict: { real: true, note: 'P2 not adversarially verified' } }))
    return parallel(toVerify.map((f) => () =>
      agent(COMMON + '\n\nYou are an adversarial SKEPTIC. Another auditor claims this ' + f.severity + ' production issue:\nTITLE: ' + f.title + '\nLOCATION: ' + f.location + '\nISSUE: ' + f.issue + '\nEVIDENCE: ' + f.evidence + '\nPROPOSED FIX: ' + f.fix + '\n\nTry to REFUTE it. Reproduce the evidence yourself (run the query, grep the code, read the file, check the log). Is it actually real, in a production code path, and not already handled? Is the severity right? Default to refuted (real=false) if you cannot independently reproduce it.',
        { label: 'verify:' + d.key + ':' + f.id, phase: 'Verify', schema: {
          type: 'object', required: ['real', 'severityConfirmed', 'note'],
          properties: { real: { type: 'boolean' }, severityConfirmed: { type: 'string', enum: ['P0','P1','P2'] }, note: { type: 'string' } },
        } })
        .then((v) => ({ ...f, verdict: v ? { real: v.real, severity: v.severityConfirmed, note: v.note } : { real: true, note: 'verifier errored — kept' } }))
    )).then((verified) => ({ dimension: d.key, summary: res.summary, findings: verified.concat(p2) }))
  }
)

phase('Synthesize')
const confirmed = audited
  .filter(Boolean)
  .map((d) => ({ dimension: d.dimension, summary: d.summary, findings: (d.findings || []).filter((f) => !(f.verdict && f.verdict.real === false)) }))

const flat = confirmed.flatMap((d) => d.findings.map((f) => ({ id: f.id, title: f.title, dimension: d.dimension, severity: (f.verdict && f.verdict.severity) || f.severity, location: f.location, issue: f.issue, fix: f.fix, verification: f.verification })))
const counts = { P0: flat.filter((f) => f.severity === 'P0').length, P1: flat.filter((f) => f.severity === 'P1').length, P2: flat.filter((f) => f.severity === 'P2').length, total: flat.length }
log('Confirmed findings: ' + counts.total + ' (P0=' + counts.P0 + ' P1=' + counts.P1 + ' P2=' + counts.P2 + ')')

const reportJson = JSON.stringify({ dimensions: confirmed, counts }, null, 2)
const synth = await agent(
  COMMON + '\n\nYou are the lead architect writing a PRODUCTION-READINESS REPORT for the Founder. Below is the full set of adversarially-verified findings across 11 dimensions (JSON).\n\n' + reportJson + '\n\nWrite a crisp, prioritized report to docs/parity-fix/production-readiness-report.md with: (1) headline verdict — is Brain production-ready, and the single biggest blocker; (2) a P0 table (must-fix-before-prod) with id, dimension, issue, fix, verification; (3) a P1 table; (4) a P2 list (one-liners); (5) a recommended fix SEQUENCE (what order, what unblocks what — e.g. migration-completeness before read-path query fixes); (6) anything Founder/Rohan-gated (live deploy, RLS cutover, enum->TEXT contract). Dedup overlapping findings across dimensions. Use EXACT file paths. After writing the file, RETURN a 200-word executive summary (verdict + P0 count + the fix sequence).',
  { label: 'synthesize:report', phase: 'Synthesize' }
)

return { counts, reportPath: 'docs/parity-fix/production-readiness-report.md', executiveSummary: synth, p0: flat.filter((f) => f.severity === 'P0').map((f) => ({ id: f.id, dimension: f.dimension, title: f.title })) }
