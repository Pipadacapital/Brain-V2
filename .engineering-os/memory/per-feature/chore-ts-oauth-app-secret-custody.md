# Feature journal — chore-ts-oauth-app-secret-custody

> Named follow-on of `chore-app-hmac-secret-custody` (CF-HMAC-TS-VS-PY-OWNER-1).
> Move TS (core-service) Shopify OAuth consumers of `SHOPIFY_CLIENT_SECRET` onto a proper custody
> source WITHOUT growing a Node AWS client. NEVER print the live `shpss_…` value.

## Stage 1 — Rohan (cto-advisor) — 2026-05-29T18:30:00Z

- **Decision:** ADVANCE → Stage 2 (Aryan). Lane high-stakes. Paradigm sql (₹0/mo).
- **Consumers (verified):** `apps/core-service/src/application/connectors/provider-config.ts`
  C1 `validateShopifyHmac():153` (secret `:156`, `timingSafeEqual:166`), C2 `exchangeShopify():199`
  (`client_secret:210`); `requireEnv:76`.
- **THE INJECTION RULING — CF-HMAC-TS-OWNER-INJECT-1:** platform env-injection. TS keeps `requireEnv`
  unchanged + no AWS SDK; CDK task-def `secrets:` mapping resolves the ap-south-1 SM secret
  `brain/_app/shopify/hmac_secret` → `SHOPIFY_CLIENT_SECRET`. Preserves CF-CC-OWNER-1. A direct TS SM
  read RE-OPENS CF-CC-OWNER-1 = Founder escalation, never a silent flip.
- **Persona:** secret-injection-boundary-realist:haiku — 5 concerns; key ones: no deployed
  core-service container → gate at CDK **synth** level + unit level, not a live smoke (CF-TS-INJECT-SYNTH-1);
  fail-fast assert must be at **boot**, not call-time (CF-TS-FAILFAST-1); AWS-SDK-import grep bound as a
  hard test (CF-TS-NO-AWS-CLIENT-1); rotation picked up on task restart (runbook note).
- **CF contract (8):** CF-HMAC-TS-OWNER-INJECT-1, CF-TS-NO-AWS-CLIENT-1, CF-TS-FAILFAST-1,
  CF-TS-HMAC-CONST-1, CF-TS-NEVERLOG-1, CF-TS-RESIDENCY-1, CF-TS-SAME-KEY-1, CF-TS-INJECT-SYNTH-1.
- **HELD for Stage 8:** live task-role injection wiring + rotated secret value. No commit/deploy.
- **Escalation:** none fired; trigger armed (Node AWS SM client → CF-CC-OWNER-1 reopen → Rohan→Founder).
- **Run folder:** `.engineering-os/runs/2026-05-29T18-30-00Z__13116e1__chore-ts-oauth-app-secret-custody__rishabhporwal`.
- **Next:** Aryan (Stage 2) — binding plan over the 8 CFs + 3 open questions (boot-assert home,
  synth-assertion shape, AWS-grep-as-test).
