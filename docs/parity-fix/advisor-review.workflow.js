export const meta = {
  name: 'brain-advisor-review',
  description: 'Honest advisor-grade review of Brain across 10 lenses (flow/arch/db/security/testing/QA/integration/perf/code/ops), adversarially verified',
  phases: [
    { title: 'Review', detail: '10 parallel reviewers — one honest expert per lens' },
    { title: 'Verify', detail: 'adversarial check of each P0/P1 claim — confirm or refute' },
    { title: 'Synthesize', detail: 'candid advisor report with a real verdict' },
  ],
}

const SCHEMA = 'docs/parity-fix/00-live-schema.md'
const LEGACY = 'legacy project'

const COMMON = [
  'You are a SENIOR INDEPENDENT ADVISOR reviewing the Brain codebase for the Founder — NOT a cheerleader and NOT an assistant. Be brutally honest: if something is wrong, say it is wrong, why it matters, and how to fix it. If something is genuinely good, say so plainly (no flattery, no padding). No false alarms — every claim must be backed by EVIDENCE you actually gathered (a file:line, a query result, a log line, a reproduced behaviour). If you are unsure, say so rather than asserting.',
  'The local stack is LIVE and READ-ONLY for you — inspect freely, never write/DDL/mutate:',
  '- Postgres: docker exec brain-postgres-dev psql -U postgres -d brain_dev -c "<SQL>"  (db brain_dev)',
  '- ClickHouse: docker exec brain-clickhouse-dev clickhouse-client --user brain_app --password brain_app_pw --database brain -q "<SQL>"  (read RMT tables with FINAL)',
  '- Gateway: curl -s localhost:3001/health ; localhost:3001/ready ; docker logs brain-api-gateway ; web on :3000.',
  'CODE: new app = apps/web + apps/api-gateway + apps/core-service + apps/{ingestion,analytics,intelligence}-service + packages/*. The behavioural reference (what the product SHOULD do) is the LEGACY app at "' + LEGACY + '/" (backend ' + LEGACY + '/backend/src, prisma ' + LEGACY + '/backend/prisma/schema.prisma, frontend ' + LEGACY + '/frontend) — REFERENCE ONLY, never edit. Live schema snapshot: ' + SCHEMA + '.',
  'CONTEXT: a recent 8-wave production-readiness pass landed (docs/parity-fix/production-readiness-report.md). You may USE it for orientation but review INDEPENDENTLY — verify its claims, and judge what it did NOT cover. Net definition kept = gross − discount. READ_FROM_CH=true; stub plane OFF.',
  'Deliver a verdict for your lens, the genuine STRENGTHS (what is done well), and the FINDINGS (what is wrong / risky / missing) with severity, why-it-matters, and a concrete recommendation. Prioritise substance over volume — the most important 5-12 findings, not a laundry list.',
].join('\n')

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['dimension', 'verdict', 'bottomLine', 'strengths', 'findings'],
  properties: {
    dimension: { type: 'string' },
    verdict: { type: 'string', enum: ['excellent', 'solid', 'adequate', 'weak', 'critical'] },
    bottomLine: { type: 'string', description: 'one or two sentences — the honest headline for this lens' },
    strengths: {
      type: 'array',
      items: {
        type: 'object', required: ['title', 'evidence'],
        properties: { title: { type: 'string' }, evidence: { type: 'string' } },
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'severity', 'issue', 'whyItMatters', 'recommendation', 'evidence'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          issue: { type: 'string' },
          whyItMatters: { type: 'string' },
          recommendation: { type: 'string' },
          evidence: { type: 'string' },
        },
      },
    },
  },
}

const LENSES = [
  { key: 'application-flow', focus: 'END-TO-END APPLICATION FLOW. Trace the real user journeys: unauth → /auth/login → onboarding → workspace dashboard → each feature page. Follow the wires: web (Next.js, apps/web) → tRPC client → api-gateway routers (apps/api-gateway/src/interfaces/trpc) → DispatchingDataPlane → LocalDbDataPlane → core read fns → PG/CH. Judge: are flows coherent, are loading/empty/error states handled, do workspace-switch + auth-redirect work, are there dead ends / broken navigations / missing back-pressure, is the 4-tuple correlation actually threaded? Click through real pages (logs show the tRPC calls). Call out broken or confusing flows AND flows that are clean.' },
  { key: 'architecture-review', focus: 'ARCHITECTURE. Judge the real design vs the documented HLD/LLD (docs/, ADRs). Service boundaries (the "independent services" claim vs the in-process Phase-0 monolith — is that honest + appropriate?), DDD layering (contexts/<bc>), the OLTP(PG hot)↔OLAP(CH) split, the vendor-discriminator generic-fact model for 100+ integrations, coupling/seams, the dual PG+CH read path (fact-analytics.ts + fact-analytics-ch.ts) as a maintenance + correctness hazard. Is the architecture sound, over-engineered, or under-built for where the product is? What would you change and why?' },
  { key: 'database-review', focus: 'DATABASE. Review PG (brain_dev) + CH (brain) schemas (' + SCHEMA + ' + the migrations apps/core-service/migrations/local-dev/*.sql, apps/analytics-service/migrations/clickhouse/*.sql). Judge: fact-model design + grain, normalization-vs-denormalization choices, money-as-minor-units discipline, indexes vs the actual query predicates (run EXPLAIN on the heavy reads), RLS coverage + FORCE, the RMT version/FINAL discipline + the un-merged duplicate versions (e.g. order_facts 2x), the PG↔CH column drift, constraints/FKs/NULL handling, migration hygiene + idempotency, data integrity (orphans, referential gaps). Reproduce with queries. What is solid, what is fragile?' },
  { key: 'security-testing', focus: 'SECURITY (pen-test mindset). authn (Supabase JWT verify, fail-closed), authz (every tRPC router role gate + workspace-membership), TENANT ISOLATION / RLS (test fail-closed empirically: no app.workspace_id → 0 rows; cross-workspace reads), SQL INJECTION (the read path string-interpolates filter values into SQL in fact-analytics(.ch).ts / platform-ads — probe it), secrets handling, CORS, OAuth state/callback, the standing OPEN-P0 (live DB zero RLS), DPDP/PII (customer_ref hashing, k-anonymity). Try to BREAK it; report exploitable holes with severity + the exact fix, and confirm what is genuinely fail-closed.' },
  { key: 'test-suite-quality', focus: 'TEST-SUITE QUALITY (not just pass/fail). Run the suites (pnpm --filter <pkg> exec vitest run; cd apps/analytics-service && uv run pytest; tests/conformance/run_conformance.py --with-behavioral). Judge: do tests assert REAL behaviour or just stubs (the read path was historically tested only via StubDataPlane — is the real LocalDbDataPlane covered?), negative/edge coverage, mutation-resistance, flakiness, the conformance + parity gates, integration/e2e gaps. Where is the coverage a false sense of security? What tests are missing that would have caught the bugs the prod-readiness pass found?' },
  { key: 'qa-functional-correctness', focus: 'QA / FUNCTIONAL CORRECTNESS vs LEGACY. The product MUST compute the same numbers the legacy app did. Pick the money-critical surfaces (P&L / CM waterfall, COGS, RTO/COD, cohorts/LTV, acquisition/MER, distributions, store summary, product performance) and VERIFY the numbers for a real workspace (Sugandhlok f165da80, Boddactive f7f275b0) against what legacy logic would produce (read ' + LEGACY + '/backend/src adapters/queries). Find where Brain is still WRONG or diverges (rounding, filters, grain, definitions), and confirm where it now matches. Be specific with numbers.' },
  { key: 'application-integration-testing', focus: 'APPLICATION / INTEGRATION TESTING against the LIVE stack. Exercise the real endpoints + pages: grep gateway logs for any remaining trpc INTERNAL_SERVER_ERROR / 500 / CH SYNTAX_ERROR / missing-column/relation; reproduce the underlying SQL. Walk every tRPC router (apps/api-gateway/src/interfaces/trpc/make-*.ts) and check each procedure actually returns sane live data for a real workspace (or honest-empty), not a crash or fabricated value. Report which surfaces are healthy, which still break, and which silently return wrong/empty data.' },
  { key: 'performance-scalability', focus: 'PERFORMANCE + SCALABILITY. Find: N+1 query patterns, missing indexes (EXPLAIN the read-path queries vs pg_indexes), full scans, CH reads missing FINAL (correctness) or missing PREWHERE/workspace_id-first (perf), OFFSET vs keyset pagination on large tables, unbounded result sets, the un-merged RMT duplicates inflating scans, per-request DB round-trips, connection-pool sizing, the realistic behaviour at 10x–100x data. Reference docs/scale-performance-plan-2026-06-02.md. What will fall over first under load, and what is the cheapest fix?' },
  { key: 'code-quality-maintainability', focus: 'CODE QUALITY + MAINTAINABILITY. Judge honestly: the dual PG/CH query duplication (fact-analytics.ts ~1900 lines + fact-analytics-ch.ts) — maintenance + drift hazard; the ~1400-line LocalDbDataPlane; error handling consistency (the catch{} pattern, now logged); type safety + any/casts; dead code + unused exports (noUnusedLocals?); naming/idioms consistency; module boundaries; documentation honesty (do comments match behaviour?). What would a senior eng flag in review? What is clean and should be kept as the pattern?' },
  { key: 'operability-devops', focus: 'OPERABILITY / DEVOPS / PRODUCTION-READINESS. CI/CD (.github/workflows/ci.yml — gates, what is NOT gated), the deploy path (CDK/k8s skeleton vs reality — is there an executable prod path?), observability (logging, /health vs /ready, the absent /metrics, trace propagation, error reporting), secrets/custody (AwsKmsCustody stub), config/env validation, rollback + migration safety in prod, runbooks, the Founder/Rohan-gated blockers. Is this operable in production today? What is the honest gap between "works on my docker" and "runs in prod with on-call"?' },
]

phase('Review')
const reviewed = await pipeline(
  LENSES,
  (l) => agent(COMMON + '\n\n=== YOUR REVIEW LENS: ' + l.key + ' ===\n' + l.focus + '\n\nReturn your honest structured review (verdict + strengths + findings).',
    { label: 'review:' + l.key, phase: 'Review', schema: REVIEW_SCHEMA }),
  (res, l) => {
    if (!res || !res.findings) return { dimension: l.key, verdict: res?.verdict, bottomLine: res?.bottomLine, strengths: res?.strengths || [], findings: [] }
    const high = res.findings.filter((f) => f.severity === 'P0' || f.severity === 'P1')
    const rest = res.findings.filter((f) => f.severity === 'P2' || f.severity === 'P3').map((f) => ({ ...f, verdict: { real: true, note: 'not adversarially verified (P2/P3)' } }))
    return parallel(high.map((f) => () =>
      agent(COMMON + '\n\nADVERSARIAL CHECK. A reviewer made this ' + f.severity + ' claim about ' + l.key + ':\nTITLE: ' + f.title + '\nISSUE: ' + f.issue + '\nEVIDENCE: ' + f.evidence + '\nRECOMMENDATION: ' + f.recommendation + '\n\nIndependently reproduce it (run the query, read the file, hit the endpoint). Is it ACTUALLY true, in a real code path, and is the severity fair (not inflated)? An honest advisor neither cries wolf nor whitewashes. Default real=false if you cannot reproduce it.',
        { label: 'verify:' + l.key + ':' + f.id, phase: 'Verify', schema: {
          type: 'object', required: ['real', 'severityConfirmed', 'note'],
          properties: { real: { type: 'boolean' }, severityConfirmed: { type: 'string', enum: ['P0','P1','P2','P3'] }, note: { type: 'string' } } } })
        .then((v) => ({ ...f, verdict: v ? { real: v.real, severity: v.severityConfirmed, note: v.note } : { real: true, note: 'verifier errored — kept' } }))
    )).then((checked) => ({ dimension: l.key, verdict: res.verdict, bottomLine: res.bottomLine, strengths: res.strengths || [], findings: checked.concat(rest) }))
  }
)

phase('Synthesize')
const clean = reviewed.filter(Boolean).map((d) => ({
  dimension: d.dimension, verdict: d.verdict, bottomLine: d.bottomLine,
  strengths: d.strengths || [],
  findings: (d.findings || []).filter((f) => f.verdict?.real !== false).map((f) => ({ ...f, severity: f.verdict?.severity || f.severity })),
}))
const flat = clean.flatMap((d) => d.findings.map((f) => ({ ...f, dimension: d.dimension })))
const counts = { P0: flat.filter((f) => f.severity === 'P0').length, P1: flat.filter((f) => f.severity === 'P1').length, P2: flat.filter((f) => f.severity === 'P2').length, P3: flat.filter((f) => f.severity === 'P3').length }
log('Verified findings: P0=' + counts.P0 + ' P1=' + counts.P1 + ' P2=' + counts.P2 + ' P3=' + counts.P3 + ' across ' + clean.length + ' lenses')

const reportJson = JSON.stringify({ lenses: clean, counts }, null, 2)
const synth = await agent(
  COMMON + '\n\nYou are the lead advisor. Below are 10 adversarially-verified lens reviews (JSON). Write an HONEST advisor report to docs/parity-fix/advisor-review-2026-06-02.md:\n' + reportJson + '\n\nStructure: (1) Headline verdict — is Brain in good shape or not, in plain terms, and the single most important thing to fix; per-lens verdict table (lens → verdict → one-line). (2) What is genuinely STRONG (do not invent praise — only real strengths from the reviews). (3) The hard truths — P0/P1 findings as a prioritised table (id, lens, issue, why it matters, fix). (4) P2/P3 as one-liners grouped by lens. (5) A 30/60/90-style improvement roadmap (what to fix first and why), separating what an engineer can do in-repo from what is Founder/Rohan-gated. (6) A direct closing paragraph to the Founder: your candid professional opinion on production-readiness and the biggest risk. Dedupe cross-lens overlaps. Be specific, cite file paths/numbers. After writing the file, RETURN a ~250-word executive summary.',
  { label: 'synthesize:advisor-report', phase: 'Synthesize' }
)

return { counts, verdicts: clean.map((d) => ({ lens: d.dimension, verdict: d.verdict, bottomLine: d.bottomLine })), reportPath: 'docs/parity-fix/advisor-review-2026-06-02.md', executiveSummary: synth }
