# Brain — Business Context (condensed primer)

> **The agent-loadable condensation of `canon/business-requirements.md` (Standalone v1.1).**
> Every agent reads this at session start. The full source of truth is `${CLAUDE_PLUGIN_ROOT}/canon/business-requirements.md` (1,836 lines) + `canon/technical-requirements.md` + `canon/TECH/00–18`. **The canon folder is the only source of truth.** When this primer and the canon disagree, the canon wins — re-read it.
> **Build reference:** `canon/IMPLEMENTATION-BLUEPRINT.md` consolidates the business + technical canon into one implementation-oriented build bible (the single doc the team and agents reference while building Brain).
> Updated 2026-05-23.

---

## 0. What Brain is (prime directive)

Brain is the **AI-native commerce operating system for DTC brands** in **India (launch market), UAE, and GCC**. It is the place a founder/operator opens repeatedly because it shows **live revenue movement, margin quality, leaks, recovery opportunities, customer risk, and executable next actions**.

Brain is **not** a passive dashboard, a chatbot with data access, a helpdesk wrapper, a WhatsApp sender, a generic CRM, a per-seat SaaS, or an ERP. The promise is not "better reporting" — it is:

> Brain helps DTC brands **grow realized revenue, recover lost revenue, protect contribution margin, and compound decision quality** across marketing, lifecycle, support, logistics, inventory, and finance.

**A feature ships only if it ties to one of:** revenue made/recovered/protected, profit (CM2/CM3/cash), risk reduction, operator time saved, compliance, or decision memory. If it can't, it doesn't ship.

**Five non-negotiable outcomes** every builder optimizes for: (1) revenue booked, (2) profit protected, (3) decision quality improved (logged condition→action→outcome), (4) operator time compressed, (5) safe execution (recommend → queue → execute → reverse → audit, with guardrails).

## 1. Naming

Product name is **Brain**. All code, prompts, routes, seed data, UI copy use **Brain-only** language. Provider names (Shopify, Meta, Google, Shiprocket, Razorpay, WhatsApp, Salla, Zid, Noon…) appear **only** as integration targets, never as positioning. No "modeled after X", no hardcoded vendor domains (use `{BRAIN_DOMAIN}`).

## 2. The operator problem

DTC operators rotate through 5–10 disconnected tools (store, ads, payments, logistics, WhatsApp/support, inventory, finance) chasing a dopamine loop. The real question is never "what was ROAS yesterday" — it's **"are we making high-quality money today, and what should I do before the day gets away?"** Failure modes Brain fixes: platform ROAS looks good but COD/RTO quality is poor → scaling bad revenue; revenue rises while CM2 falls; support treated as cost not revenue-save; WhatsApp blasts destroy margin; courier/pincode failures seen too late; ad changes unlogged; AI recs not outcome-tracked.

**The Brain loop:** Sense → Normalize → Detect → Decide (rank by expected CM2 impact, urgency, confidence, reversibility) → Act (recommend/queue/execute w/ guardrails) → Log (Decision Log) → Learn (Brand Fingerprint).

## 3. Customers (ICP)

DTC brands in India/UAE/GCC with real volume + margin pressure + multi-tool complexity. **Hard floor: ₹50L/month GMV** (or local equivalent); ₹25L–₹50L is case-by-case. Tiers: **T1 Operator-led** (₹50L–₹3Cr/mo, founder + 1–5), **T2 Scaling** (₹3Cr–₹50Cr/mo, growth/retention/support/ops/finance leads), **T3 Enterprise/multi-brand** (₹50Cr+/mo, CMO/CFO/COO, portfolio).

**Geography:** multi-region **by architecture from day one** (region-adapter pattern), **India-first by go-to-market**. UAE/GCC are first-class *adapters* activated for live customers in **Phase 4**. India: INR, GST 2.0 (0/5/18/40), COD/prepaid/RTO/NDR/pincode, DLT/NCPR/DND + 9am–9pm + WhatsApp opt-in, DPDP. UAE: AED, VAT 5%, WhatsApp-first, Tabby/Tamara BNPL, PDPL. KSA/GCC: per-country VAT (KSA 15%, UAE 5%, Bahrain 10%, Oman 5%; Qatar/Kuwait none), Ramadan/Eid, Arabic/English, Salla/Zid/Noon/Namshi, PDPL.

**Account structures:** A single-brand, B multi-brand group (isolated per brand), C agency-managed (scoped, all actions tagged), D enterprise overlay (residency, SLA, approval matrices).

## 4. Personas & roles

Personas: Founder/Owner, Operator/COO, Growth/Media-Buyer, Retention/CRM, Support Head, Finance/CFO, Ops/Logistics, Agency, Investor. **5 canonical roles** (RBAC): **Viewer (1)** < **Analyst (2)** < **Agency (3, scoped+tagged)** < **Operator (4)** < **Owner (5)**. Approval matrix is per action class (e.g. increase ad budget = Owner by default; issue refund = Owner or Operator within cap; enable auto-execute = Owner only).

## 5. The six product pillars

1. **Honest profit analytics** — true economics, not platform numbers. CM1/CM2/CM3, MER/aMER/CAC/payback/LTV:CAC, RTO-adjusted CM2. Move operators off vanity ROAS toward contribution margin.
2. **Regional commerce intelligence** — COD vs prepaid margin, RTO by pincode/city/courier/product/payment/offer/campaign, NDR as leading indicator, GST-inclusive correction, pincode/tier scoring, festival seasonality, settlement timing. UAE/GCC: VAT, marketplace leakage, BNPL, cross-border duties.
3. **Decision memory (the moat)** — the **Decision Log** records condition → recommendation → approval/rejection/edit → execution → reversal → 7d/30d outcome. **No official Brain action exists unless it is logged.**
4. **Lifecycle as a revenue engine** — abandoned cart, browse abandon, COD-confirm/prepaid-conversion, post-delivery education, replenishment, winback, VIP, second-order, refund-save. **Always CM2-gated** (never discount where expected CM2 is negative after message/offer/RTO cost).
5. **AI ticket management as revenue protection** — support is a commerce event: faster FRT, autonomous resolution of repetitive tickets, refund-leakage reduction, exchange-over-refund, delivery recovery before RTO, product education driving repeat.
6. **Safe agentic execution** — graduate from "recommend" to "act" on low-risk, reversible, capped, outcome-tracked actions; always with visible guardrails + Owner kill switch.

## 6. Metrics that matter (formulas live in the metric engine, never in an LLM)

- **Revenue ladder:** Gross Sales → Net Sales → Net Sales Net Tax (tax extracted **per line item by SKU GST/VAT slab**) → Net Revenue → **Realized/Delivered Revenue** (survives cancellation/RTO/refund/payment-failure — the honest number, and the **billing base**).
- **CM waterfall (canonical):** Net Revenue − COGS − non-marketing variable costs = **CM1**; CM1 − marketing = **CM2** (the most important metric — if CM2<0, scale makes it worse); CM2 − allocated fixed = **CM3**; CM3 − founder salary/financing/one-offs = Operating Profit. **True CM2** subtracts RTO provision + refund/payment-failure provisions.
- **Marketing:** MER = Net Rev ÷ total marketing spend; aMER = new-customer rev ÷ acquisition spend; paMER; CAC (on delivered new customers); CAC payback; LTV:CAC (cohort cumulative CM2 ÷ cohort CAC); creative fatigue. **ROAS is display-only, never the P&L decision metric.**
- **COD/RTO:** RTO rate, RTO cost (forward+reverse+restock+write-down), COD realization, **break-even COD RTO rate r\* = M/(M+C)** (M = delivered-order CM, C = RTO cost per failed order). COD RTO commonly 20–35% vs prepaid ~2–8% — the single largest controllable margin leak in Indian DTC.
- **Lifecycle/support:** recovered cart/winback revenue + CM2, reorder capture, VIP retention, campaign incrementality (vs holdout), **Recovered Revenue ÷ Brain Fee**; FRT, autonomous resolution rate, refund-save rate, **support-protected CM2**.
- **Goal RAG:** higher-better Green ≥95% / Amber 80–95% / Red <80%; lower-better Green ≤105% / Amber 105–125% / Red >125%; output includes explanation + recommended action.

## 7. Product surfaces

**Home/Command Center** (live revenue+profit strip, revenue-quality panel, Top-3 actions, queues, Decision ROI, integration health). **Morning Brief** (THE daily executive surface; mobile-primary; ≤3 actions each with problem/evidence/action/impact/risk/confidence/buttons; writes responses to Decision Log). **Evening Pulse**. **Weekly Review**. **Month-End Compound Report** ("what did Brain learn this month?"). **Sale/Event Mode** (high-frequency hourly pace vs forecast curve; margin-trap alert if CM2 falls even as revenue rises). **Natural-language query** (direct answer + exact numbers/formulas + confidence + next action; LLMs never invent numbers).

## 8. Lifecycle & WhatsApp

One audience/decision layer drives WhatsApp/email/SMS/calls/push/ad-audiences (build the segment **once** — Single-Primitive Rule). WhatsApp: template mgmt, consent-aware sending, **per-delivered-template-message cost by category** (marketing/utility/auth; service-window replies free, post-Jul-2025 model), frequency caps. **Offer ladder:** no-discount → low-cost value-add → limited discount (CM2-positive only) → escalated retention → human review. Show **realized** revenue + CM2, not just placed.

## 9. AI ticket management

15 ticket types (order status, delivery delay, NDR, address change, cancel, return, refund status, replacement, missing/damaged, recommendation, education, COD→prepaid, payment-failed-but-debited, coupon, complaint). Enrich every ticket with order history/RFM/LTV/shipment/payment/consent/policy + suggested resolution + CM2 impact. Flow: classify → pull commerce truth → policy/permission check → estimate impact → autonomous if high-confidence+low-risk, else draft, else escalate → log. **Never** invent delivery status, promise outside policy, reveal margin/scores, continue after human requested, send without consent, or make irreversible financial action above cap.

## 10. Agents, auto-execute, pricing, compliance

- **Product agent groups:** **AICMO** (growth/acquisition/creative/lifecycle/pricing), **AICOO** (logistics/inventory/support/fulfillment), **AICFO** (profit/cash/planning/risk). Realized as **15 domain agents** (see technical primer §agents). Every recommendation carries: why-now, metrics used, expected revenue + CM2, confidence, risk, reversibility, approval level, execution path, fallback, outcome plan.
- **Auto-execute:** OFF by default; Owner enables per action class with caps + confidence thresholds + consent/policy/freshness checks + **global kill switch (Owner pauses all in 60s)** + **auto-revert to recommend-only** if reversal/error rate crosses threshold + Decision Log entry per action.
- **Pricing:** **% of realized/delivered GMV** (Launch ~1.0% / Growth ~0.75% / Scale ~0.5% / Enterprise custom), **no per-seat**, **minimum monthly fee** per tier, **CM2 affordability guardrail** (fee ≤ cap% of CM2). Value proof: recovered revenue ÷ fee, CM2 recovered ÷ fee, operator time saved.
- **Compliance (P0):** India **DPDP Act 2023 + Rules 2025**; India telecom **TCCCPR/DLT + NCPR/DND + 9am–9pm** window; **WhatsApp** Meta opt-in + approved templates + free service window (24h customer-service / 72h ad-click entry-point); UAE/KSA **PDPL**. India data **in-region by default**. Consent tracked per customer/channel/purpose/source/timestamp/region/withdrawal; opt-out overrides all marketing.

## 11. Roadmap (phases)

**0 Foundation:** multi-tenant model, core integrations, cost setup, metric engine + CM waterfall, Store Analytics, Decision Log, integration health, basic Morning Brief, India adapter, audit log. **1 Operator Wedge:** high-freq Home, MER/aMER, RTO/COD/pincode, RFMC, WhatsApp abandoned-cart + COD-confirm, Weekly Review, first-product cascade, support classification, UAE/GCC adapter foundations. **2 Lifecycle & AI CX:** shared audience builder, WhatsApp campaigns, replenishment/winback/VIP, AI ticket mgmt, support→commerce loops, inventory/logistics queues, creative/budget recs, Plan/scenario. **3 Agentic Execution:** auto-execute + kill switch + reversal + outcome-accuracy dashboard + advanced guardrails. **4 Scale & Enterprise + UAE/GCC live:** portfolio rollups, enterprise controls, advanced benchmarking, custom integrations, residency, approval matrices, retail-aware extensions, mature UAE/GCC.

## 12. Acceptance bar (every implementation)

Brain-only naming · tenant-safe + role-aware · ties to revenue/profit/risk/time/compliance/memory · writes to Decision Log · deterministic metric formulas (LLMs never invent numbers) · exposes data freshness + caveats · India + UAE/GCC via **adapters** (no forks) · lifecycle/support as revenue workflows · guardrails before auto-execute · measures placed + realized + recovered/protected CM2 + fee coverage · audit/export/deletion/consent/PII-minimization.

**Top risks to defend against:** Brain becomes a dashboard · Decision Log not adopted · stale data → bad recs · wrong RTO/COD model · LLM hallucinated numbers · WhatsApp overuse · bad AI support CX · auto-execute financial damage · cross-brand leak · discount-led margin destruction. Each has a mitigation in canon §22.
