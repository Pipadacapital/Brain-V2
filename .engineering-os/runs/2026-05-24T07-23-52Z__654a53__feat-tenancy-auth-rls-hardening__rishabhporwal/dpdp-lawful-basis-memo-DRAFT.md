# DPDP Lawful-Basis & Processing-Continuity Memo

> **Status: ACCEPTED via FOUNDER DECISION 2026-05-24 — gate `CF-SEC-3.HARD` SATISFIED.** The Founder did not sign this specific §7 instrument; instead he recorded a broader authorization (see §8): as **legal owner and authorized controller of Sugandh Lok** — the only brand whose data is in the live DB during this phase — he authorizes the Child-1 migration processing on his own brand's data, and **consciously defers** formal governance instruments (DPAs, §7 memos, credential rotation, data-governance policy) to a **dedicated post-migration security/governance phase** (backlog: `chore-security-governance-hardening-phase`). The lawful-basis analysis in §§1–5 stands as the substantive record of WHY the Child-1 acts are defensible; §6 commitments are carried into that backlog rather than executed now.
>
> **⚠️ Residual-risk note (recorded, not blocking):** this authorization rests on Sugandh Lok being the Founder's own brand. **Before ANY third-party brand's PII is processed in production**, the deferred DPA work (§6.2) must land for that brand. Child 1 proceeds because the live data in scope is the Founder's own brand.
>
> **⚠️ Not legal advice.** Drafted by the engineering pipeline for the Founder. Recommend review by qualified Indian data-protection counsel before relying on it for an enterprise/anchor-customer security review.

| Field | Value |
|-------|-------|
| **Instrument type** | Interim lawful-basis & processing-continuity attestation (bridge to per-brand DPAs) |
| **Covers requirement** | `feat-tenancy-auth-rls-hardening` (Child 1 of epic `chore-migrate-legacy-to-brain`) |
| **Satisfies gate** | `CF-SEC-3.HARD` (DPDP §4 lawful basis for migration-time PII processing) |
| **Governing law** | Digital Personal Data Protection Act, 2023 (India) + DPDP Rules, 2025 |
| **Data location** | `ap-south-1` (Mumbai) — confirmed; no cross-border transfer (DPDP §16) |
| **Signed by** | _(Founder — Rishabh Porwal) — UNSIGNED IN DRAFT_ |
| **Date** | _(to be set at signing)_ |
| **Review-by date** | Superseded automatically when the Sugandh Lok DPA is executed; in any case re-reviewed within 90 days of signing |

---

## 1. Parties & roles

1.1 **Brain** (operated by Pipada Capital) is a **Data Processor** under DPDP §2(k)/§8(2): it processes personal data **on behalf of** each onboarded brand.

1.2 Each onboarded **brand** (e.g. the anchor customer **Sugandh Lok**) is the **Data Fiduciary** for its own customers' personal data and determines the purpose and means of processing.

1.3 The personal data in scope was **collected by the brand from its customers** (via the brand's Shopify/WooCommerce store, shipping, and email flows) and made available to Brain solely to provide the brand the analytics/insights service the brand engaged Brain for.

---

## 2. Personal data in scope (named, per the gate)

This memo expressly covers Brain processing of the following live personal data during Child 1:

- **`Invitation.email`** — email addresses of users invited to a brand workspace.
- **`ShopifyCustomer` PII** — `email`, `firstName`, `lastName` (and equivalent fields on `WoocommerceOrder` / `ShiprocketShipment` delivery records: name, address, pincode, city, state).
- **`User`** — application user identities (email, name) tied to a workspace.

No card numbers, CVV, full UPI IDs, bank accounts, Aadhaar, or passwords are in scope (Brain does not store these — canon §21.1 / PCI SAQ-A posture).

---

## 3. The specific processing acts being authorised (Child 1 only)

Child 1 is **internal technical isolation-hardening**, not new collection, new purpose, new disclosure, or transfer. The acts are:

1. **Applying Postgres Row-Level Security (RLS) policies** to workspace-scoped tables (DDL; does not read PII content).
2. **The `CF-SEC-1` RLS probe** — a verification query that may `SELECT` a small number of rows (incl. `Invitation.email`) **solely to prove tenant isolation works** (deny-by-default), then discards them.
3. **An optional `workspace_id` denormalization backfill** on FK-transitively-scoped tables (e.g. `ShopifyCustomer`) — a structural column write that reads each row's existing workspace association; it does not export, transmit, or repurpose PII.

All three occur **in-region (`ap-south-1`)**, on data Brain already lawfully holds as processor, for the **same purpose** the brand provided it.

---

## 4. Lawful basis (DPDP)

4.1 **Primary basis — processor under contract (DPDP §8(2)).** Brain processes the in-scope data as a Data Processor on behalf of each brand Data Fiduciary, under the engagement by which the brand onboarded to Brain. The Child-1 acts in §3 are **a continuation of the existing, already-authorised processing** (operating the analytics service), performed for the **same specified purpose** — not a new purpose requiring fresh consent.

4.2 **Supporting basis — purpose continuity / legitimate use (DPDP §7).** The §3 acts fall within the purpose for which the data principals voluntarily provided their data to the brand and for which the brand engaged Brain; no new purpose is introduced.

4.3 **Data-protection-*enhancing* nature.** The Child-1 processing **reduces** privacy risk: it replaces application-layer-only tenant separation (no database RLS) with structural Postgres RLS, **closing a cross-brand leak surface** that would otherwise be a DPDP §8(6) exposure. Proceeding is the privacy-protective choice; *not* proceeding leaves the leak surface open.

4.4 **Minimisation.** The probe (§3.2) reads the **minimum** rows necessary to verify isolation and retains nothing. No PII is copied out of Postgres, logged in plaintext, or sent to any third party or model during Child 1.

---

## 5. Residency & transfer

5.1 The data resides in **`ap-south-1` (Mumbai)**, confirmed at the Postgres level. (Historical note: a prior `ap-southeast-1`/Singapore configuration existed; the current state is Mumbai, and Child 1's deploy harness asserts `ap-south-1` on **both** connection URLs before any DDL, per `CF-RES-1.a`.)

5.2 No personal data is transferred outside India during Child 1. **DPDP §16 cross-border-transfer restrictions are not engaged.**

---

## 6. Conditions & commitments (Founder attests)

By signing, the Founder attests and commits that:

6.1 Brain's engagement with each in-scope brand authorises Brain to operate the analytics service on the brand's customer data, and Child 1's §3 acts are within that engagement.

6.2 Brain will **execute a formal DPA** with each brand — **starting with Sugandh Lok** — that memorialises the §8(2) processor relationship, security obligations, sub-processor terms, breach-notification (DPDP §8(6) / Rules 2025 timeline), and erasure support (DPDP §12). **This memo is superseded by that DPA** once executed.

6.3 Brain will not, under cover of this memo, (a) introduce a new processing purpose, (b) disclose in-scope PII to any third party, (c) transfer it outside `ap-south-1`, or (d) use it to train any model — without a separate, explicit basis.

6.4 The credentials exposed during intake will be **rotated** and managed via AWS Secrets Manager (`CF-SEC-SECRETS-1`) before the build's dual-run touches live integrations.

6.5 `AuditLog` null-`workspace_id` rows remain erasure-scopable under the Child-1 dual-policy (`CF-C1-AUDITLOG-1.a`), preserving DPDP §12 erasure capability.

---

## 7. Scope limits

This memo authorises **only** the Child-1 acts in §3. It does **not** pre-authorise later slices (connectors / metrics / AI engine / frontend), each of which carries its own compliance review. It is an interim bridge, not a standing waiver.

---

## 8. Signature

**Founder decision recorded (verbatim intent):** "I have the necessary authorization to access and store the user and business data required for this migration work… Sugandhlok is my own brand/product, so I am the legal owner and authorized controller of the platform and its associated systems. Therefore, for the current development and migration phase, proceed without blocking on governance formalities." Formal security/compliance/governance to be addressed systematically **after** the migration phase, tracked in `chore-security-governance-hardening-phase`.

```
Authorization: FOUNDER DECISION (ownership-based; formal governance deferred)
Basis:         Legal owner + authorized controller of Sugandh Lok (the in-scope brand)
Name:          Rishabh Porwal (Founder, Pipada Capital)
Date (UTC):    2026-05-24
Recorded-by:   orchestrator (per Founder instruction in-session)
Gate:          CF-SEC-3.HARD — SATISFIED for Child 1 (Sugandh Lok data only)
Deferred-to:   chore-security-governance-hardening-phase (post-migration)
```
