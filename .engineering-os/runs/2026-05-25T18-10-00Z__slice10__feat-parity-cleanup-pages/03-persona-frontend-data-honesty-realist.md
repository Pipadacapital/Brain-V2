# Persona stress-test — frontend-data-honesty-realist (:haiku, bounded)

**Angle:** For each of the 9 pages, is every rendered value either (a) a real shipped seed value, or (b) an explicit honest "pending cutover" affordance? Flag any place a developer is likely to invent a plausible-but-fake number.

## Concerns (≥1 required — this persona found 4)

**C1 (HIGH) — `/analytics` sessions/conversion is the #1 fabrication trap.** A "Store Analytics" page screams for a sessions funnel and conversion rate. Those are Shopify-sync fields, NULL in legacy when unsynced, and NOT in the StubDataPlane. A developer will be tempted to seed `sessions: 48000, conversion: 2.3%` to make the page "look complete". **That is a lie.** Gate: the conversion/sessions tiles MUST render an honest "Storefront sessions pending connector cutover" state, not a number. The real content is the store revenue/CM ladder (which IS seeded).

**C2 (HIGH) — `/meta-ads` & `/google-ads` per-campaign tables.** Seeded data has aggregate `meta_spend_mu`/`google_spend_mu` but NO per-campaign rows (campaign-level data is OAuth-fetched live). A developer will be tempted to fabricate "Campaign: Diwali Prospecting | spend ₹X | ROAS Y". Gate: render the real aggregate spend/efficiency (seeded) + an honest "Connect Meta/Google to see per-campaign breakdown" — which is EXACTLY what legacy returns at HTTP 200 when unconnected. Do not invent campaigns.

**C3 (MED) — `/settings/integrations` "last sync" timestamps.** The honest-state centerpiece. Risk: a developer renders "Last synced: 2 minutes ago" (a fake live-feeling timestamp) for connectors that aren't actually syncing. Gate: status must be honest per connector — e.g. Shopify CONNECTED with a fixed seed last-sync (the anchor brand's real backfilled data epoch), Meta/Google/Shiprocket "PENDING CUTOVER" with NO fake sync time. The page's job is to tell the truth about connection health, not to look busy.

**C4 (MED) — `/settings/backfill` empty state.** Backfill jobs are connector-triggered; none are running locally. Risk: faking a "Job #1234 — 87% complete" progress bar. Gate: honest "No backfill jobs — connector cutover pending; backfill triggers available after cutover" with the trigger button disabled. An empty-but-honest page beats a fake-progress page.

## Cross-cutting
- **C5 (LOW) — zero-scaffold proof must be a TEST, not a one-time grep.** A structural test (`expect no (shell) page to import ScaffoldPage`) prevents regression and is the Founder's literal bar. Recommend it be a committed test, not just a smoke grep.
- **PII note (defer to Shreya):** `/team` member emails are real PII; READ-only + RLS fail-closed + ANALYST-gated is the right posture. No fabrication risk here (members are seeded from the anchor workspace), but tenancy at the wire must be proven.

**Verdict:** ADVANCE-WITH-GATES. The dominant risk is fabricated connector-live values on 4 of 9 pages (analytics, meta-ads, google-ads, backfill). The honest affordance must be load-bearing and test-anchored (`CF-S10-HONEST-STATE-1` + a no-fake-number assertion), not cosmetic.
