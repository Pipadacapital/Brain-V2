# Stage 6 — Retro — Slice E: connector data ingestion

## What worked
- **Reuse over rebuild.** Slice E wired two already-stress-tested primitives (Child-3 ingest contract +
  slice-D custody) rather than rebuilding. ZERO new deps, no Kafka/ClickHouse/Python runtime for local.
- **The persona earned its keep.** The dominant risk wasn't "does ingest work" (Child-3 proved that) but
  "does a CONNECTED workspace actually read its OWN ingested numbers, idempotently, isolated, with correct
  money/GST". Framing the persona at the ingest→ACL→fact→analytics SEAM (not the raw-row layer) is exactly
  where the real bugs would live.
- **Verify-the-verifier (again).** The verification caught two real build-time bugs before review:
  a wrong micros→minor-units expectation (I'd mis-stated ₹3000 in micros) and a BigInt JSON.stringify in a
  test. Both positive proof the gates aren't vacuous.
- **The seed-vs-real architectural reframe at S1.** The directive said "normalize to the facts the analytics
  read" — but those facts were a hardcoded seed, not a table. Catching that at intake (not at build) made
  the DispatchingDataPlane + LocalDbDataPlane the centerpiece of the plan instead of an afterthought.

## What didn't / friction
- `psql` not on PATH (DB is in docker) → had to route migrations + checks through `docker exec`. Minor.
- The careful hook (correctly) blocked TRUNCATE on the dev DB — had to use DELETE in FK order. Working as
  intended; noted for future dev-DB cleanup.
- The macOS shell has no `timeout`; background-pid + sleep + kill is the portable pattern for live smoke.
- The local harness `LocalSeedMembershipResolver` honors the x-workspace-id header (by design in harness
  mode), which initially looked like a tenancy gap until I confirmed it's the slice-A harness path (prod
  uses DbMembershipResolver keyed on the verified sub). The dispatcher correctly routed the header-supplied
  non-Sugandh workspace to LocalDbDataPlane and returned honest empty — a good wire-level P-001 proof.

## What surprised us
- The analytics read path is far MORE consolidated than the canon's 7-service split suggests: one TS gateway
  `StubDataPlane` keyed to a single workspace. Slice E's real work was less "ingest data" and more "teach
  the read path that workspaces other than Sugandh exist and have their own facts" — the DispatchingDataPlane.
- The cleanest honest-state design needed 18 empty-result factories (one per non-fed surface). That LOOKS
  like over-engineering but is load-bearing: without it, a real workspace's non-fed pages would either crash
  or fall through to the Sugandh seed (a fabrication). Honest-empty is the requirement, not gold-plating.

## Lessons for the next CTOA intake
- When a directive says "feed the existing analytics," FIRST verify whether "the existing analytics" read
  from a TABLE or a SEED. If a seed, the slice's hardest work is the read-seam + dispatcher, not the writer.
- For per-connector slices, the idempotency proof MUST be at the AGGREGATE/analytics layer (re-sync ≠ 2×
  revenue), not just the raw-row layer. Raw dedup is necessary but not sufficient.
- Money from vendor APIs arrives as decimal STRINGS (Shopify) or MICROS (Google) — the ACL must convert
  with integer math, never `parseFloat()*100`. Bake a no-float-drift test into every connector ACL.
