---
title: "Google Merchant — Roadmap (Proposal)"
sidebar_label: "Google Merchant Roadmap"
sidebar_position: 3
---

# Google Merchant — Roadmap (Proposal)

> **Status:** draft. Companion to [Google Merchant Center Integration](./google-merchant.md). The shipped surface today covers OAuth, GCP developer registration, data-source management, single + bulk product sync, import-from-Google with fuzzy matching, auto-resync on product update, and proactive token refresh. This roadmap covers what the integration **does not yet do** and proposes a phased build to close those gaps.

## What's missing today

| Area | Today | Gap |
|---|---|---|
| Account health | We only know whether the OAuth refresh_token is present | No view of Google's own account-level approval/rejection state, no surfacing of business-info issues, no policy-warning feed |
| Account business profile | Inert — we don't read or write `accounts.businessInfo` or `accounts.businessIdentity` | New accounts must be configured in the Merchant UI before products will be approved |
| Initial setup | Linear OAuth → developer-register → data-source flow, but each step is a separate admin click | No "you are X% set up" view, no validation at each step, no recovery when a step half-completed |
| Product disapprovals | We capture per-product `sync_error` only on our own write attempt | No view of Google's *product-level* statuses (disapprovals, pending review, country-specific issues) |
| Inventory | `availability` flag flips on product update | No real-time stock-level sync; no regional inventory; no price/sale-price overrides per region |
| Promotions | None | Promotion-rule sync (sale prices, coupons, free shipping) is a separate Merchant API surface we don't touch |
| Shipping | None | `accounts.shippingSettings` (rates, zones, delivery times) — required for many countries to lift product disapprovals |
| Reports | None | `reports.search` API for performance metrics (clicks, impressions, conversions) per product |

This doc proposes a phased plan that closes the high-impact gaps in a build order matched to operator pain.

---

## Phase 1 — Account approval / rejection resolution

**Why first.** When an account is in a degraded state (suspended, pending verification, country-not-eligible), every other operation behaves unpredictably. Surface it before adding any new write surface.

### Two API surfaces, two phases-within-the-phase

The Merchant API has **two distinct issue endpoints**, with very different access rules:

| Endpoint | Path | Access | Returns |
|---|---|---|---|
| `accounts.issues.list` | `GET /accounts/v1beta/{parent=accounts/*}/issues` | Standard OAuth | Raw `AccountIssue` rows — severity, breakdowns, documentation_uri |
| `issueresolution.renderaccountissues` | `POST /issueresolution/v1/accounts/{ACCOUNT_ID}:renderaccountissues` | Standard OAuth | `RenderedIssue[]` with `prerendered_content` (HTML) + `actions[]` |
| `issueresolution.triggeraction` | `POST /issueresolution/v1/accounts/{ACCOUNT_ID}:triggeraction` | **Allowlist-gated** — must submit an allowlist request | Executes a structured action (e.g. request re-review, dispute issue) |

**Phase 1a — read-only (no allowlist needed):**
1. **Service method** `getAccountIssues(accountId)` calls `accounts.issues:list`. Returns normalized rows with severity, breakdowns, and documentation URLs.
2. **Service method** `renderAccountIssues(accountId, { languageCode, timeZone })` calls `renderaccountissues`. When called **without** `user_input_action_option` in the request, the response's `actions[]` returns links that deep-link the operator to Merchant Center to complete the action. This is the unblocked default.
3. **Admin UI** embeds `prerendered_content` directly (sanitize via DOMPurify per Google's recommendation — the HTML uses `issue-detail` / `callout-banner` / `segment` CSS classes). Each action becomes a deep-link button.
4. **Subscriber refresh.** On every successful sync workflow, also refresh `account.last_status_at` + cache the latest rendered-issue list on the account row (`api_config.last_issues`). Avoids a separate poller for accounts in active use.
5. **Scheduled poll** for accounts with no recent sync activity. New job `src/jobs/refresh-google-merchant-account-status.ts` running hourly that re-fetches issues for each `is_active` account and bumps `last_status_at`.

**Phase 1b — in-app resolution (after allowlist approval):**
1. **Allowlist application** — submitted out-of-band via the form Google provides on the `triggeraction` reference page. Track the submission date on a project ticket; until approved, the deep-link UX from 1a is what operators see.
2. **Service method** `triggerAccountIssueAction(accountId, { actionContext, actionInput })` calls `triggeraction`. `actionInput` carries `actionFlowId` + `inputValues[]` (typed as `checkboxInputValue` etc. depending on the action). On 400, surface the per-field validation messages Google returns.
3. **Admin UI** swaps the deep-link buttons for inline forms once the allowlist is approved — same component skeleton, different action handler.

This split lets us ship operator value (visible health + deep-links) without blocking on Google's allowlist approval, then upgrade to in-app resolution when it lands.

### Admin UI

1. **Health badge on `/admin/google-merchant/accounts`** — green/amber/red driven by `overall`.
2. **Account detail page → "Health" tab** — issue list with severity, plain-language title, "Fix" CTA per issue. CTAs route to either:
   - An inline form (for issues we can resolve via API).
   - A deep-link out to Google's Merchant UI (for issues we can't resolve programmatically — claim URL, identity verification, etc.).
3. **Toast on resolve** — re-poll status after a write and refresh the badge.

### Files

| Path | Change |
|---|---|
| `src/modules/google_merchant/service.ts` | `getAccountStatus`, `resolveAccountIssue` |
| `src/modules/google_merchant/provider.ts` | `accounts.issues:list`, `accounts.businessInfo:patch` calls |
| `src/api/admin/google-merchant/accounts/[id]/status/route.ts` | **New** — GET issues, POST a resolution |
| `src/jobs/refresh-google-merchant-account-status.ts` | **New** — hourly poll for inactive accounts |
| `apps/admin-ui/src/routes/google-merchant/accounts/[id]/health/page.tsx` | **New** — health tab |

---

## Phase 2 — Business profile + initial setup writes

**Why next.** Many account-level issues from Phase 1 are "missing business info" / "homepage not claimed" / "program not enabled". Letting admins fix these directly from JYT removes the second-most-common support escalation.

### Sub-resources covered

The Merchant API `accounts_v1beta` exposes more than business info — Phase 2 covers the full set of write surfaces operators currently need to bounce to Merchant Center for:

| Sub-resource | Methods | Why |
|---|---|---|
| `accounts.businessInfo` | `getBusinessInfo`, `updateBusinessInfo` | Legal business name, phone, address, customer-service contact. Resolves the most common Phase 1 issues |
| `accounts.businessIdentity` | `getBusinessIdentity`, `updateBusinessIdentity` | Woman-owned / veteran-owned / small-business / latino-owned / black-owned attestations for advertiser-attribution programs |
| `accounts.homepage` | `claim`, `unclaim`, `getHomepage`, `updateHomepage` | Homepage claim is a hard prerequisite for serving Shopping ads. Without it every product is disapproved |
| `accounts.programs` | `enable`, `disable`, `get`, `list` | Per-program toggles for `FREE_LISTINGS` / `SHOPPING_ADS` etc. Enables free listings without bouncing to Merchant Center |
| `accounts.programs.checkoutSettings` | full CRUD | Checkout-on-Merchant settings for programs that support it |
| `accounts.automaticImprovements` | `getAutomaticImprovements`, `updateAutomaticImprovements` | Toggles for Google's automatic-fix features (item updates, image improvements). Most operators want this on by default |
| `accounts.shippingSettings` | `getShippingSettings`, `insert` | Phase 5c covers full shipping; Phase 2 only exposes a read view so operators can see what's configured |
| `accounts.termsOfServiceAgreementStates` | `get`, `retrieveForApplication` | New accounts must accept Merchant ToS before products can serve. Block the rest of onboarding until this returns ACCEPTED |
| `termsOfService` | `accept`, `get`, `retrieveLatest` | Used together with the agreement-state read above to render-and-accept ToS in-app |

### Backend

1. New service methods per sub-resource (~20 methods). Each pair is a thin wrapper around the API call + an account-row cache write.
2. **Phone verification flow**: phone updates kick off a separate verification request; persist `phone_verification_status` on the account row.
3. **Validation**: server-side Zod schemas matching Merchant API requirements (E.164 phone, ISO 3166-1 country, BCP-47 language, RFC 7231 URL) before the API call. Fail fast with a structured error rather than letting Google return a 400.
4. **Idempotency** on homepage claim: `claim` is safe to call repeatedly (returns the existing claim if already claimed). The UI can call it freely on "Re-verify" without server-side dedup.

### Admin UI

- New route `/admin/google-merchant/accounts/[id]/business-profile` with tabs:
  - **Info** — business info form, phone-verification CTA + status pill
  - **Identity** — identity attestations
  - **Homepage** — claim status + claim/unclaim buttons + URL field
  - **Programs** — enable/disable cards per program with eligibility hints
  - **Automatic improvements** — three toggles (item updates, price updates, availability updates)
  - **Terms of service** — render `termsOfService.retrieveLatest` HTML; accept button when ToS state is `PENDING`

### Files

| Path | Change |
|---|---|
| `src/modules/google_merchant/service.ts` | ~20 new methods covering the sub-resources above |
| `src/api/admin/google-merchant/accounts/[id]/business-info/route.ts` | **New** GET, PATCH |
| `src/api/admin/google-merchant/accounts/[id]/business-identity/route.ts` | **New** GET, PATCH |
| `src/api/admin/google-merchant/accounts/[id]/business-info/verify-phone/route.ts` | **New** POST |
| `src/api/admin/google-merchant/accounts/[id]/homepage/route.ts` | **New** GET, PATCH + `claim`/`unclaim` actions |
| `src/api/admin/google-merchant/accounts/[id]/programs/route.ts` | **New** list, enable, disable |
| `src/api/admin/google-merchant/accounts/[id]/automatic-improvements/route.ts` | **New** GET, PATCH |
| `src/api/admin/google-merchant/accounts/[id]/terms-of-service/route.ts` | **New** GET (state + latest), POST (accept) |
| `apps/admin-ui/src/routes/google-merchant/accounts/[id]/business-profile/` | **New** UI with tabs above |

---

## Phase 3 — Onboarding wizard for new accounts

**Why.** OAuth → developer registration → data-source detection are three independent admin clicks today. New operators stall on step 2 or 3 because there's no checklist, no validation, no recovery from partial completion.

### Scope

A **stepwise wizard** that drives a new account from "OAuth done" to "first product synced", with per-step status persistence on the account row so an operator can resume later. Each step has a concrete API check that drives "completed?" — no soft validation.

```
Step 1: OAuth          refresh_token present + getAccountIssues returns 200
Step 2: GCP register   developerRegistration:registerGcp succeeded
Step 3: Data source    dataSources:list contains an API source matching feed_label+content_language
Step 4: Terms of svc   termsOfServiceAgreementStates returns ACCEPTED
Step 5: Business info  businessInfo has phone (verified), address, customerServiceContact
Step 6: Homepage       homepage.claim returns CLAIMED
Step 7: Account active accounts.issues:list returns no severity=CRITICAL issues
Step 8: First sync     bulk-sync runs and finishes with at least one product approved
```

Steps 4 and 6 are blockers in Google's data model — products literally cannot serve without them. Step 5 is technically not blocking but in practice every Phase 1 issue points at it.

### Implementation

1. **State on the account row:** new column `onboarding_state` (jsonb): `{ current_step: int, completed_steps: int[], blockers: [{step, code, detail}] }`.
2. **Service method** `getOnboardingState(accountId)` that reads from cache, then re-validates each completed step (e.g. is the data source still there? is the OAuth refresh_token still valid?). Returns `current_step` adjusted downward if a previous step regressed.
3. **One route** `/admin/google-merchant/accounts/[id]/onboarding` that returns `{ steps, current_step, ctas }`. CTAs are URLs (own UI) or external redirects (Google's Merchant UI for things we can't automate).
4. **Wizard UI** at `/admin/google-merchant/accounts/[id]/onboarding`. Renders step status. Drives the right child route per step.
5. **Auto-advance** — completing step N kicks off validation for N+1 and surfaces blockers immediately.

### Phase ordering note

This phase **depends** on Phase 1 (status read) and Phase 2 (business info write) being shipped — step 4 can't be implemented otherwise.

---

## Phase 4 — Per-product status / disapproval handling

### Scope

Today we capture our own write errors. Google additionally emits *its own* status per product (pending review → approved / disapproved / warning), often **after** our successful insert. Without surfacing these, products silently fail to serve in Shopping ads.

### Backend

1. `getProductStatus(accountId, productId)` calls `merchantapi.googleapis.com/products/v1/{name}` and merges `product_status.itemLevelIssues`.
2. Bulk pull: `getAllProductStatuses(accountId, since?)` paginates `products:list` with `productStatus` field. Run this from a new job `src/jobs/refresh-google-merchant-product-statuses.ts` every 6h per account.
3. Persist on the **link** row (`product_google_merchant_link.metadata.google_status`) so per-account product status is visible without a fresh API call.

### Admin UI

- Existing product detail page → "Sync status" panel — extend to show Google's *evaluation* status, not just our last write result.
- New filter on the product list: "show products with active Google issues".

---

## Phase 5 — Inventory + promotions + shipping (parallel work, not blocking each other)

These three are independent and each opens a new Merchant API surface.

### Inventory

- Per-region availability + price overrides via `merchantapi.googleapis.com/inventories/v1/{name}/regionalInventories`.
- Sub-modules: `regional_inventory` link table mirroring `product_google_merchant_link` but keyed on `(product, account, region)`.
- Trigger: new subscriber on `inventory_level.updated`.

### Promotions

- Sync sale prices via `merchantapi.googleapis.com/promotions/v1`.
- Trigger: new subscriber on `promotion.applied`/`promotion.created`.
- Map JYT promotions → Merchant promotion shape (price-rule + valid_from/to + country list).

### Shipping

- One-time configuration: pull our shipping options + write them via `accounts.shippingSettings:update`.
- Re-sync trigger: subscriber on `shipping_option.updated`.

These three each get their own admin surface and own backlog. They are **not** prerequisites for any other phase.

---

## Phase 6 — Reports + analytics integration

`reports.search` returns merchant-level performance (impressions, clicks per product, by country). Once products are approved and serving, ops want a dashboard.

### Reuse, don't rebuild

| Reuse | Source | For |
|---|---|---|
| Recharts wrappers + filter popover + date-range presets | `src/admin/components/websites/website-analytics-modal.tsx` | Same chart shapes, different group-by key |
| `useWebsiteAnalytics` hook pattern | `src/admin/hooks/api/analytics.ts` | Mirror as `useGoogleMerchantReports({ account_id, product_id?, country?, date_range })` |
| `ad_report_row` table (introduced by [Google Ads Phase 1](../ad-planning/google-ads-integration.md#phase-1--account-connect--read-only-sync)) | `src/modules/socials/models/ad-report-row.ts` | **Don't** create a parallel `google_merchant_report_row`. Add a `source` discriminator to `ad_report_row` (`google_ads` / `google_merchant` / `meta_ads`) so cross-source queries are a single SQL aggregate. Coordinate with the Google Ads work — whichever ships first introduces the table. |
| `Conversion` model | `src/modules/ad-planning/models/conversion.ts` | When a Merchant click → JYT order, the existing `Conversion` record (with `platform="google"`) ties Merchant impressions to actual revenue without any new join |

### Backend

- Scheduled job pulls `reports.search` GAQL daily and writes rows to the unified `ad_report_row` table with `source="google_merchant"`.
- Service exposes a query method that joins report rows with `Conversion` (matched on `gclid` or product) for the revenue column.

### Admin UI

- Dashboard widget on each Merchant account detail page: time series of impressions / clicks / conversion-value, country pie, top/bottom products.
- Same filter popover + chart components as the Google Ads dashboard. Differences are aggregation key (product, country) instead of (campaign, ad group) and the source column on the report row.

### Cross-source value

Because Merchant impressions, Ads clicks, and Conversions all key off the same `ad_account_id` + `gclid`, a Phase 6 dashboard with the unified table can answer:

> "For products advertised via this Performance Max campaign, what's the Merchant impression count → Shopping click rate → JYT order rate funnel?"

Without standing up another report table.

---

## Phasing summary

| Phase | Operator pain it removes | Depends on | Est. T-shirt |
|---|---|---|---|
| 1. Account approval/rejection | "Why aren't my products live?" — opaque suspensions | — | M |
| 2. Business profile sync | Bouncing to Merchant UI to fix info | 1 | S |
| 3. Onboarding wizard | New operators getting stuck mid-setup | 1, 2 | M |
| 4. Per-product status | Products that "synced" but never served | 1 | S |
| 5a. Inventory | Stockouts shown as available on Shopping | — | M |
| 5b. Promotions | Sale prices missing on Shopping cards | — | S |
| 5c. Shipping | Disapprovals due to missing shipping config | — | M |
| 6. Reports | Operators asking us for performance numbers | 1, 4 | M |

Recommend shipping Phase 1 → 2 → 4 in sequence, then parallel-tracking 3, 5a, 5b, 5c, 6.

## Open questions

- **Multi-country accounts.** Phase 5a (regional inventory) and Phase 5c (shipping by zone) explode in complexity for accounts targeting >1 country. Do we scope the v1 to single-country accounts and gate multi-country behind a feature flag?
- **Auto-fix scope in Phase 1.** Some Google issue codes (e.g. claim verification by file upload) cannot be automated — we deep-link out. We need to enumerate the ~10 most-common codes and decide for each: (a) automate, (b) form-based admin UI, (c) deep-link out only.
- **Operator permissions.** Today every admin can OAuth-connect an account. Do we want an `editor` vs `owner` split before exposing business-info writes (Phase 2), or post-MVP?
