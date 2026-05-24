# Backlog Epic: Security, Compliance & Data-Governance Hardening Phase (post-migration)

| Field | Value |
|-------|-------|
| **backlog_id** | `chore-security-governance-hardening-phase` |
| **type** | deferred epic (NOT in active pipeline) |
| **created** | 2026-05-24 |
| **created_by** | rishabhporwal (Founder decision) |
| **trigger to activate** | legacy→Brain migration phase is stable + production-ready (epic `chore-migrate-legacy-to-brain` substantially complete) OR before ANY third-party brand's PII is processed in production (whichever comes first) |
| **owners** | Shreya (security) + Jatin (platform) lead; Aryan (architecture) + Maya (data governance) supporting |
| **why deferred** | Founder (legal owner/controller of anchor brand Sugandh Lok) authorized proceeding with the migration on his own brand's data and consciously deferred formal governance to this dedicated phase. See `…/feat-tenancy-auth-rls-hardening/dpdp-lawful-basis-memo-DRAFT.md` §8. |

> **Standing guardrails that REMAIN ACTIVE during the deferral** (deferral ≠ negligence):
> - Credentials NEVER committed; `.env`/`**/.env` gitignored; secrets only in local untracked `.env` for dev (enforced now).
> - No secret values in logs, docs, configs, or artifacts.
> - The migration's own isolation work (Child 1 RLS, etc.) still ships with its in-pipeline gates (Shreya/Tanvi) — those are NOT deferred.
> - The residency assertion (`ap-south-1`, both URLs) still runs at Child-1 deploy.
> - Third-party-brand PII in production is the hard tripwire that force-activates this backlog.

---

## Architectural action plan (9 workstreams)

Each becomes its own `/requirement` (child of this backlog epic) when the phase activates. Sequenced by dependency.

### WS-1 — Credential management & secret rotation  *(activate FIRST; owner Jatin)*
- Migrate all integration + DB + AI credentials (Supabase DB, Supabase keys, Shopify/Meta/Google OAuth, Shiprocket/Klaviyo/Unicommerce, SMTP, Anthropic) from local `.env` → **AWS Secrets Manager** (ap-south-1), per `CF-SEC-SECRETS-1`.
- **Rotate every credential shared during development** (treat all as exposed/burned).
- Per-service IAM scoping; runtime fetch (no env-baked secrets in images); rotation schedule + automated rotation where the vendor supports it.
- Connector token storage encryption at rest (legacy stored `ShiprocketConnection.password`/`KlaviyoConnection.apiKey` in plaintext — see Child-3 CF-SEC-4).

### WS-2 — Data governance & DPDP compliance framework  *(owner Shreya + Maya)*
- Execute formal **DPAs** per onboarded brand, **starting Sugandh Lok** (supersedes the interim lawful-basis memo).
- Consent primitive (per customer/channel/purpose/source/timestamp/region/withdrawal) — absent in legacy schema.
- Data-retention + right-to-erasure (DPDP §12) workflows; erasure-scopability incl. `AuditLog` null-workspace rows.
- Breach-notification runbook (DPDP §8(6) / Rules 2025 timeline).
- PII-minimisation review (addresses → pincode/city default per canon).

### WS-3 — Security policies & documentation  *(owner Shreya)*
- Written InfoSec policy set; threat model (STRIDE) per service; secure-SDLC doc (the EOS pipeline IS the change-management control — document it).
- Enterprise-security-questionnaire answer pack.

### WS-4 — Compliance workflows (India telecom + privacy)  *(owner Shreya)*
- DLT/TCCCPR, NCPR/DND two-layer, 9am–9pm window, 48h cap, AI-voice disclosure + recording consent — relevant once lifecycle/outbound (Child 5+) is live.
- GST handling review.

### WS-5 — Access-control audits  *(owner Shreya)*
- Audit the 4-layer workspace isolation end-to-end (JWT → gateway → RLS → ClickHouse gateway) once all slices land.
- Role-model (5-level) review; least-privilege on every MCP tool scope; periodic access review cadence.

### WS-6 — Production security hardening  *(owner Jatin)*
- WAF, rate-limit/abuse protection, network policy/VPC, mTLS between services, cert-pinning rotation (mobile).
- Vulnerability scanning gates in CI (pnpm audit/Snyk, Bandit/pip-audit, Trivy) — wire as enforced gates.

### WS-7 — Infrastructure security reviews  *(owner Jatin + Shreya)*
- CDK/IaC security review; SCP/residency guardrails proving data can't leave ap-south-1 (data-residency-enforcement skill); KMS/encryption posture; backup/restore + DR.

### WS-8 — Audit-log immutability & Decision-Log integrity  *(owner Shreya + Vikram)*
- WORM (S3 Object Lock) for the audit trail + Decision Log; hash-chaining/append-only proof; 7-year retention integrity — prove to a SOC2/ISO auditor.

### WS-9 — SOC 2 / ISO 27001 readiness  *(owner Shreya; Phase 4)*
- Map existing controls (RBAC, audit log, vuln scanning, change mgmt, encryption, IR, residency) to TSC; evidence-as-you-build; Type 1 → Type 2 (vendor Sprinto).

---

## Activation
When ready, the Founder (or CTOA) files WS-1 first via `/requirement` (it unblocks the rest by getting secrets off local `.env`), then WS-2/WS-8 (compliance + audit integrity), then WS-3..WS-7, with WS-9 in Phase 4. Until then this doc is the durable record so nothing is lost.
