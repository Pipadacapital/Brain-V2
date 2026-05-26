# Legacy → New Frontend Parity Gap Audit

**Audit only — no code changed.** Compares every legacy `*-content.tsx` page against its new-app counterpart, by FEATURE (not styling). Legacy lives in `legacy project/frontend/app/(protected)/...`; new lives in `apps/web/src/interfaces/components/...`. Line counts are a rough size signal — note that several new pages delegate to sub-components (e.g. `kpi-strip.tsx`, `pnl-statement-table.tsx`), so raw page LOC understates the new app slightly, but the functional gaps below account for that.

Severity key: **P0** = a whole table / the page's primary content is missing or the page is a stub. **P1** = sections / charts / filters / drill-downs missing. **P2** = minor (a few columns / cosmetic / read-only-vs-CRUD only).

## Summary table (P0 → P2)

| Page | New exists? | Severity | One-line gap |
|---|---|---|---|
| **Meta Ads** | Stub (`PlatformAdsView`) | **P0** | Entire ad/creative/funnel page (1,806 LOC) reduced to 7 aggregate tiles; ad-level table, 3 tabs, video-funnel & creative analytics all gone |
| **Google Ads** | Stub (`PlatformAdsView`) | **P0** | Entire ad/creative/funnel page (1,636 LOC) reduced to 7 tiles; ad-level table, 3 tabs, daily view, account selector all gone |
| **Store (data)** | Reused as revenue ladder | **P0** | Legacy Orders/Products/Customers data tables + COGS tab + sync/backfill entirely absent; new "store" is a 5-tile revenue ladder (≈ legacy *analytics*, not legacy *store*) |
| **Product COGS (coqs)** | No counterpart | **P0** | MISSING PAGE — per-product COGS editor (inline/bulk edit) has no new page |
| **Notifications** | No counterpart | **P0** | MISSING PAGE — notifications list / mark-read / unread filter gone |
| **Account** | No counterpart | **P0** | MISSING PAGE — profile edit, password change, sessions, sign-out-others gone |
| **Dashboard** | Yes | **P1** | 30+ customizable metric tiles (5 categories) + Customize panel → fixed 8-tile strip; date presets (Yesterday/7D/30D/90D/1Y) gone |
| **P&L** | Yes | **P1** | 34-column day/week/month grid + column picker + %-mode + pagination + totals → fixed 9-line statement; no granularity, no per-period rows |
| **Shiprocket** | Reused logistics summary | **P1** | Per-shipment table (14 cols), AWB search, status filters, row expand, sync/channel mgmt → aggregate summary only |
| **Acquisition** | Yes | **P1** | New-Customer Acquisition Trend (90/180/365 MA) chart + Order Composition section + chart both gone |
| **Timings** | Yes | **P1** | group-by selector (collection/vendor/type…), group filter, search, sort, 2→3/3→4 columns reduced |
| **Email & SMS** | Yes | **P1** | Unique-open $, unsub count/%, spam count/% columns dropped; opens-count column dropped |
| **Pincode Intelligence** | Yes | **P2** | State filter, min-orders filter, Revenue/Unique-customers/Top-courier columns dropped |
| **Distributions** | Yes | **P2** | Column sort + pagination + page-size dropped (chart+table otherwise present) |
| **Cohorts** | Yes | **P2** | Mode-disable-by-metric logic + Average row + "First Order (R)/First Order" columns reduced; heatmap present |
| **Lifetime Value** | Yes | **P2** | `collection`/`discount_codes` dimensions dropped; M-columns + curve + pagination present |
| **Products** | Yes | **P2** | Column picker + NC/EC splits + sales/refunds breakdown columns + pagination dropped; core CM1 table present |
| **First Product Cascade** | Yes | **P2** | Cohort-funnel summary card + column sorting dropped; table present |
| **Costs** | Yes (read-only) | **P2** | Add/Edit/Delete cost CRUD dialog gone (read-only resolved view) |
| **Goals** | Yes (read-only) | **P2** | Goal create/edit/delete form gone (RAG report only) |
| **Festivals** | Yes (read-only) | **P2** | Add/Edit/Delete/Reset-defaults CRUD gone (template table only) |
| **Calendar** | Yes | **P2** | "Add marketing action" dialog gone; grid + RAG + overlays present |
| **Integrations** | Yes (parity-ish) | **P2** | Shiprocket/Klaviyo/WooCommerce connectors + product-data-source config absent; Shopify/Meta/Google connect+sync present |
| **Ad Campaigns (settings)** | Yes (read-only) | **P2** | Per-campaign intent classification edit + search/platform filter gone (split tiles only) |
| **Workspace Settings** | Yes (read-only) | **P2** | Timezone/name edit + delete-workspace danger zone gone (read-only) |
| **Team** | Yes (read-only) | **P2** | Invite dialog (read-only; new shows disabled affordance) |
| **Store / Revenue Ladder** | Yes | OK | New surface; parity good |
| **Analytics (store)** | Yes | OK | Strong parity (cards + daily area chart); sessions/conversion honestly deferred |
| **Waterfall** | Yes | OK | Strong parity; only "New/Returning customer" filter + per-row formula tooltip missing (P2) |
| **RTO Analytics** | Yes | **P1** | "RTO by product (top 50)" table missing; rate/payment/courier present |
| **COD vs Prepaid** | Yes | OK | Strong parity; legacy "calculator" inputs (P2) the only extra |
| **Customer Lifecycle** | Yes | OK | Strong parity (buckets + thresholds + revenue attribution) |
| **Logistics** | Yes | OK | Strong parity (rates + charges + by-courier + by-payment) |
| **Inventory** | Yes (NEW) | OK | NEW page (no direct legacy single-page equiv; was a Store/Products column) |
| **COGS Settings / Filters Settings** | Folded | **P1** | Standalone COGS-settings editor + Filters-settings editor pages have no new counterpart (COGS partly surfaced read-only on Costs) |

---

## P0 — primary content / whole page missing

### Meta Ads  (legacy 1,806 LOC → new `marketing/platform-ads-view.tsx` 123 LOC, shared with Google)
The new app routes `/meta-ads` to a shared `PlatformAdsView` that shows 7 aggregate tiles only.
- **MISSING in new**
  - **Ad-level performance table** — columns: Ad/group, Campaign/ad set, Intent, Spend, Impr, Hook %, Hold %, P25, P50, P75, P95, Avg watch (s), CTR, ROAS, Diagnostics.
  - **Campaign-level table** — columns: Spend, Impressions, Clicks, CTR, CPC, CPM, Conversions, ROAS.
  - **3 tabs**: Performance / Funnel / Creative.
  - **Creative/video-funnel analytics**: hook/hold rates, watch-time percentiles (P25–P95), "Spend by campaign intent" chart.
  - **Filters/controls**: Intent filter, Ad-account selector (multi-account).
- **DIFFERENT/NEW in new**: 7 tiles — platform spend, total ad spend, MER, aMER, new customers, blended CAC, acquisition spend — plus an honest "connect to see per-campaign breakdown" `ConnectorPending` panel.

### Google Ads  (legacy 1,636 LOC → same shared 123-LOC `PlatformAdsView`)
- **MISSING in new**
  - **Ad-level table** — columns: Creative preview, Ad, Campaign, Channel, Intent, Spend, Impr, Clicks, CTR, Conv, Conv. value, ROAS.
  - **3 tabs** Performance / Funnel / Creative; **campaigns-vs-daily view toggle**; **account selector**; Intent filter.
  - "Spend by campaign intent" breakdown + per-campaign table (Spend/Clicks/CTR/ROAS).
- **DIFFERENT/NEW in new**: identical 7-tile aggregate as Meta (only the platform-spend tile differs).

### Store (data)  (legacy `store/store-content.tsx` 233 LOC → new `store/store-content.tsx` 99 LOC)
These are NOT the same feature. Legacy `store` is the synced-data browser; new `store` is a revenue-quality ladder (closer to legacy `analytics`).
- **MISSING in new** (the entire legacy store page):
  - **Tabbed data browser**: Orders / Products / Customers / Product COGS tabs.
  - **Orders table** — columns: Order, Customer (email), Total, Payment (financialStatus), Fulfillment, Date.
  - **Products table** — columns: Product (image), Type, Vendor, Status, Inventory, COGS, Published.
  - **Customers table** — columns: Customer, Email, Orders, Total spent, State, Created.
  - **Controls**: "Refresh from Shopify/WooCommerce", "Backfill Customers", "Bulk Backfill (4 Years)", last-synced timestamp.
- **DIFFERENT/NEW in new**: 5-tile revenue ladder (Gross → Net → Net-of-Tax → Net Revenue → Realized) + staleness label. (Good content, but it replaces a different legacy page; the legacy *analytics* page maps to new `store/analytics-content.tsx`.)

### Product COGS  (legacy `store/coqs/coqs-content.tsx` 811 LOC → NO new page)
- **MISSING PAGE.** Per-product COGS editor with inline COGS input per product, **bulk-edit mode**, search, Status filter, COGS filter (set/unset), save-per-row. Table cols: Product, COGS (editable), action.

### Notifications  (legacy `notifications-content.tsx` 195 LOC → NO new page)
- **MISSING PAGE.** Notification list, unread badge/count, "All / Unread" filter, mark-one-read, mark-all-read, click-through to `actionUrl`.

### Account  (legacy `account/account-content.tsx` 468 LOC → NO new page)
- **MISSING PAGE.** Profile (avatar, full name, job role + save), **change password** (current/new/confirm), **active sessions** + "sign out other sessions". (Note: new app may handle some of this elsewhere in auth flows — but there is no `/account` route.)

---

## P1 — sections / charts / filters / drill-downs missing

### Dashboard  (legacy 209 LOC + `dashboard-metrics-grid` → new 139 LOC + `kpi-strip` 8 tiles)
- **MISSING in new**
  - **Customizable metric grid** — 30+ tiles in 5 categories with a **"+ Customize"** show/hide panel. Tiles: *Revenue* (Gross Sales, Net Sales, Discounts, Tax, Orders, AOV, Prepaid Orders %); *Margins* (COGS, Material Margin, Material Margin %, Variable Costs, Other Costs, CM1, CM2, Misc. Expenses, CM3, CM3 %); *Marketing* (Meta Spend, Google Spend, Total Ad Spend, MER, aMER, ACOS); *Logistics* (RTO Orders, RTO %, Total RTO Cost, Revenue Lost to RTO, COD Orders, COD %, COD Revenue, Prepaid Revenue); *Store* (Sessions, Conversion Rate).
  - **Date presets**: Yesterday / 7D / 30D / 90D / 1Y buttons.
  - Shopify connection-error banner.
- **DIFFERENT/NEW in new**: fixed 8-tile KPI strip (Net Revenue, CM2, CM3, Blended ROAS, Orders, AOV, RTO Rate, Conversion Rate) + a CM waterfall panel + a "Top-3 recommended actions (Phase 2)" placeholder + drill drawer. Net: far fewer metrics, no user customization, but adds a waterfall the legacy dashboard lacked.

### P&L  (legacy 533 LOC → new 87 LOC + `pnl-statement-table` 123 LOC)
- **MISSING in new**
  - **34-column period grid** — the legacy P&L is a per-period table (Day/Week/Month/Quarter rows), with a **column picker** exposing: Gross Sales, Product Gross, Shipping Gross, Discounts, Product/Shipping Discount, Sales, Net Sales, Product/Shipping Net, Refunds, Product/Shipping Refunds, Return Fees, Revenue, NC/EC Net Revenue, Net Revenue, COGS, Variable Costs, Shipping/Returns/Payment/Customs/Other Variable Costs, Ad Spend, Meta Ads, Google Ads, CM1, CM2, CM3, Fixed Costs, Founder's Salary, Net Profit.
  - **Granularity toggle** (Day/Week/Month/Quarter), **Absolute vs Percentage mode** (% of Net Sales), **YTD / Last-year presets**, **pagination** (rows-per-page), **Total row**.
- **DIFFERENT/NEW in new**: a fixed 9-line statement (Net Revenue, COGS, Variable Costs, CM1, Ad Spend, CM2, Fixed Overheads, CM3, True CM2) + InsightStrip (AI narration) + waterfall panel. Honest CM ladder, but no time-series, no per-period drill, far fewer line items.

### Shiprocket  (legacy 1,014 LOC → new 120 LOC, reuses logistics.summary)
- **MISSING in new**
  - **Per-shipment table** — columns: Shipment, SR Order, Channel, Shopify Ref, AWB, Status, Payment, Created, Zone, Wt (kg), Fwd ₹, COD ₹, RTO ₹, (expand). Row expansion, **AWB/Shipment/Order search**, RTO-only toggle, status badges, **pagination + page-size**.
  - **Connection management**: last-sync time/error, **"Sync selected channels"**, channel enable/disable toggles, refresh channels.
- **DIFFERENT/NEW in new**: aggregate ops tiles + charge tiles + by-courier table (delegates to logistics summary) + a disabled "Backfill (pending cutover)" button.

### Acquisition  (legacy 847 LOC → new 315 LOC)
Core strip + daily ComposedChart + daily table have good parity. Missing:
- **MISSING in new**
  - **"New Customer Acquisition Trend"** section — LineChart of 90/180/365-day moving averages of daily new-customer count.
  - **"New Customer Order Composition"** section — 6 % tiles (Discounts %, CM2 %, Ad Spend %, COGS %, Variable Costs %, Refunds %) + a 6-series 7-day-smoothed composition LineChart.
  - The daily ComposedChart drops the **Blended CAC** line (legacy has 4 series; new has 3).
  - Goal RAG inline lines under tiles (`KpiGoalLine`), "Classify campaigns" link.

### RTO Analytics  (legacy 352 LOC → new 136 LOC)
- **MISSING in new**: **"RTO by product (top 50)"** table — columns Product, Quantity, Revenue lost. (By-payment + by-courier tables + headline tiles present.)

### Timings  (legacy 629 LOC → new 133 LOC)
- **MISSING in new**: **group-by selector** (product/collection/vendor/type/etc.), per-group **filter dropdown**, **search**, **column sorting**; the per-group table drops 2→3 and 3→4 interval columns and 4th-order %. Overall summary + by-first-product table present.

### Email & SMS  (legacy 181 LOC → new 139 LOC)
- **MISSING in new** (table columns): Opens (count), **$/unique open**, **Unsub**, **Unsub %**, **Spam**, **Spam %**. (Delivered, Open %, Click %, Orders, Revenue, $/recipient present; same 5 group-by options.)

### COGS Settings & Filters Settings  (legacy standalone editors → no new page)
- **MISSING in new**: standalone `cogs-settings` editor (default COGS %, fallback, markup save form) and `filters-settings` editor (excluded products/customers/etc. with search). COGS values are surfaced read-only on the new Costs page; Filters settings have no new home at all.

---

## P2 — minor (few columns / read-only-vs-CRUD / cosmetic)

- **Pincode Intelligence** (327→119): drops **State filter**, **min-orders filter**, and columns **Revenue, Unique Customers, Top Courier**. Adds reliability sort + high-RTO toggle; core table (Pincode/City/Tier/Shipments/RTO%/COD%/Delivered%/AOV/Repeat%/Score) present.
- **Distributions** (373→214): drops **column sort**, **pagination + page-size**. Chart (density + mode/mean reference lines) + table (Product/Orders/Mode/Mean/Diff) present.
- **Cohorts** (415→165): drops the **Average row**, the metric-specific mode-disable logic, and the **"First Order (R)" / "First Order"** columns. Heatmap + per-cohort economics (CAC/rr90/Payback/LTV/LTV:CAC) + summary present.
- **Lifetime Value** (480→183): drops `collection` and `discount_codes` dimensions; otherwise full (M1–M12 curve, summary cards, dimension table, pagination, search) — strong parity.
- **Products** (522→160): drops the **column picker** and the NC/EC split columns (NC/EC Return Rate, NC/EC Orders, NC/EC AOV), Sales/Refunds/Refunded/Net-Quantity breakdown columns, and **pagination**. Group-by also drops product_tags/order_tags/discount_codes. Core CM1/Pareto/return table present.
- **First Product Cascade** (302→146): drops the **"Cohort funnel (all products)"** summary card and **column sorting**. Table (first product → 2nd/3rd/4th rates, extra orders, avg LTV, days-to-2nd) present + observation-window selector.
- **Costs** (858→140): legacy has full **Add/Edit/Delete cost CRUD** (dialog + form, cost type/name/kind/amount). New is **read-only** resolved view (COGS resolution + cost stack + how-it-lands-in-CM).
- **Goals** (293→132): legacy has **create/edit/delete goal** form (metric, period, target, type). New is **read-only RAG report** (Metric/Period/Goal/Actual/Attainment/Status). New adds directional RAG badges.
- **Festivals** (246→100): legacy has **Add/Edit/Delete/Reset-to-defaults** CRUD + inline editing. New is **read-only** template calendar (Festival/Window/Expected/Regions/Categories + peak multiplier).
- **Calendar** (651→136): legacy has **"Add marketing action"** dialog (write). New is read-only grid; grid + per-cell RAG + action overlays + grain toggle present.
- **Integrations** (1,961→233): legacy connects **Shopify, Meta, Google, Shiprocket, Klaviyo, WooCommerce** + product-data-source config + per-vendor dialogs. New supports **Shopify/Meta/Google** connect+disconnect+**sync** only (real OAuth). **Shiprocket/Klaviyo/WooCommerce connectors absent.**
- **Ad Campaigns (settings)** (281→92): legacy has per-campaign **intent classification editor** (inline select per row) + search + platform filter + save. New shows acquisition/non-acq/Meta/Google split tiles (read-only) + "Edit classifications (coming soon)" disabled + a `ConnectorPending` per-campaign panel.
- **Workspace Settings** (320→83): legacy edits **timezone + name** (save) + **delete-workspace danger zone** (password-confirm). New is read-only (name/plan/timezone/region/currency/created) + disabled "Edit settings".
- **Team** (458→101): legacy has **Invite member** dialog (email + role, mutation). New is read-only member table (Name/Email/Role/Joined) + disabled "Invite member"; adds pending-invitation count.
- **Waterfall** (374→285): strong parity (vertical bar waterfall + absolute-values table). Drops the **New/Returning customer filter** and the **per-row/per-bar formula tooltip** (legacy shows the formula + Shiprocket charge breakdown on hover). New tooltip shows amount only.
- **COD vs Prepaid** (403→123): strong parity (comparison table + break-even tile). Legacy has extra calculator inputs (P2). New comparison cols: Method/Orders/Gross/RTO%/Effective/Fees/₹-per-order.

---

## Cross-cutting observations

1. **AI InsightSheet / "Generate insights" is gone almost everywhere.** Legacy analytics/pnl/acquisition/cohorts/ltv/waterfall pages all have an `InsightSheet` (per-page AI narration job). The new app only has a lighter `InsightStrip` on P&L (slice-9). This is a consistent P1-level feature deletion across ~6 pages.
2. **Date-range presets** (Yesterday/7D/30D/90D/1Y, YTD, Last-year) are present across most legacy pages via `DateRangeFilter`; the new app uses raw `<input type="date">` from/to with **no preset buttons** anywhere. Cross-cutting P2.
3. **CRUD → read-only.** Costs, Goals, Festivals, Calendar-actions, Ad-campaign classification, Workspace-settings, Team-invite, Product-COGS are all editors in legacy and read-only (or disabled "coming soon") in the new app — explicitly deferred behind the connector-cutover HOLD per the new code's comments.
4. **Connector coverage shrank**: Shiprocket, Klaviyo, WooCommerce connectors (and the standalone Shiprocket per-shipment view + sync) are not wired in the new app; only Shopify/Meta/Google.
5. **Column richness** consistently reduced: legacy P&L (34 cols), Products (NC/EC splits), Shiprocket (14 cols), Meta/Google ad tables — all collapsed to a much smaller fixed column set with no column picker.
6. **Genuinely strong-parity new pages**: Logistics, COD-Prepaid, Customer-Lifecycle, Analytics (store), Cohorts, LTV, Distributions, Waterfall, Pincode. These map cleanly and lost only minor controls.
7. **New-only page**: `Inventory` (per-SKU on-hand / days-of-cover / sell-through) — was a column inside legacy Store/Products, now its own page. No legacy single-page equivalent.
