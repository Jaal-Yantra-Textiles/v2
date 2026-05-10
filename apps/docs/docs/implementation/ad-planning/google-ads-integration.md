---
title: "Google Ads Integration Plan (Proposal)"
sidebar_label: "Google Ads Integration"
sidebar_position: 3
---

# Google Ads Integration Plan (Proposal)

> **Status (May 2026):** Phases 0, 1, and 2 are shipped (PRs #203, #204). Phase 3 (campaign management write-back) and Phase 4 (Search ads) are still proposal-only. See [Google Ads — What's Shipped](./google-ads-shipped.md) for the actual implementation map, operator setup, and known gaps.
>
> Sister document to [Meta Ads Integration Plan](./meta-ads-integration.md). Covers a from-zero implementation of Google Ads (formerly AdWords) tied into the existing Google Merchant integration so we can run Shopping, Performance Max, and Search campaigns directly from JYT.

## Why now

We already ship products to Google Merchant Center. Approved products are *eligible* to serve in Shopping ads, but they don't actually serve until a **Google Ads campaign** picks them up. Today operators run those campaigns from Google's UI; results don't flow back into JYT analytics; and the conversion path between a Shopping click and a JYT order is broken.

This plan proposes a phased build that:

- Connects a Google Ads account to JYT via OAuth (same UX shape as our Merchant integration).
- Imports + displays existing campaigns, ad groups, ads, keywords, performance metrics.
- Lets operators create + manage Shopping and Performance Max campaigns from JYT.
- Closes the conversion loop by writing JYT orders back to Google Ads as conversions.

Status today: **not started**. No `google_ads` module, no routes, no workflows. Only the Merchant module exists.

---

## What's already in place

The codebase already has cross-channel scaffolding from the Meta Ads + analytics work. **Google Ads should extend it, not parallel it.**

| Asset | Where | Reuse for Google Ads |
|---|---|---|
| Google Merchant module | `src/modules/google_merchant/` | OAuth helper patterns, encrypted credential storage, GCP developer registration flow, token refresh job |
| `AdAccount` model | `src/modules/socials/models/AdAccount.ts` | Currently Meta-specific. **Generalize** with a `platform` discriminator + Google-specific fields (`customer_id`, `login_customer_id`, `manager`) instead of a parallel `GoogleAdsAccount` table |
| `AdCampaign` model | `src/modules/socials/models/AdCampaign.ts` | Holds Meta campaigns today. Add `platform` + Google-specific fields (`google_campaign_id`, `channel_type` for SEARCH/SHOPPING/PMAX, currency-micros budget). Same row shape, mirrored from Google's API |
| `Conversion` model | `src/modules/ad-planning/models/conversion.ts:30,113` | `platform` enum already includes `"google"` — placeholder waiting to be wired up. Source for conversion uploads |
| `CampaignAttribution` model | `src/modules/ad-planning/models/campaign-attribution.ts:22-24` | `platform` enum already includes `"google"`. Sessions are matched to campaigns post-hoc via UTMs and (future) click ids |
| Attribution resolver workflow | `src/workflows/ad-planning/attribution/resolve-session-attribution.ts` | Already triggered by `analytics-event.created` subscriber when session has UTM. Extend to also resolve by `gclid` |
| `analytics_event.created` subscriber | `src/subscribers/ad-planning/analytics-event-created.ts:1-150` | Already maps raw events → `Conversion` records. Becomes the natural source for the Google Ads conversion-upload subscriber |
| Analytics module | `src/modules/analytics/` | `AnalyticsEvent` + `AnalyticsSession` capture UTMs today; **need to add `gclid`/`fbclid` columns** (or formalize `metadata.click_ids`) so attribution can find Google clicks |
| Client-side `analytics.js` | `assets/analytics.js:82-100` | Captures `utm_*` but **not** `gclid`/`fbclid`. Add capture + sessionStorage persistence + transmit on `trackConversion`/`trackPageview` |
| Admin dashboard components | `src/admin/components/websites/website-analytics-modal.tsx` | Recharts AreaChart/BarChart/PieChart, filter popover, preset/custom date ranges, country map. Reuse for the Google Ads dashboard |
| Visual flows + scheduled jobs | `src/jobs/`, `src/scripts/seed-*` | Performance polling, anomaly-alert flows fired on `production_run.reminder_*`-style scheduled discovery (see [Production Run Reminders](../workflows/production-run-reminders.md) for the pattern) |

---

## High-level architecture

The integration spans **three existing modules** plus a thin new provider. There is no new data-storage module — Google Ads campaigns sit in the same `socials.AdCampaign` table as Meta campaigns, distinguished by a `platform` discriminator. Conversions go through the same `ad_planning.Conversion` pipeline that already supports `platform: "google"`. Click-id capture happens in the existing `analytics.js` client and the existing `/web/analytics/track` route.

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser — assets/analytics.js                                  │
│  + capture gclid + wbraid + gbraid (extend getUTMParams)        │
│  + persist in sessionStorage alongside UTMs                     │
│  + transmit on trackPageview + trackConversion                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ POST /web/analytics/track
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  modules/analytics                                              │
│  AnalyticsEvent + AnalyticsSession                              │
│  + new fields: gclid, fbclid, wbraid, gbraid                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ event "analytics_event.created"
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  modules/ad-planning  (existing subscriber)                     │
│  subscribers/ad-planning/analytics-event-created.ts             │
│  → resolveSessionAttributionWorkflow                            │
│      • UTM-based path (today)                                   │
│      • + gclid-based path (new)                                 │
│  → emit Conversion rows with platform="google"                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  modules/socials                                                │
│  AdAccount   ← platform discriminator + google_customer_id      │
│  AdCampaign  ← platform discriminator + google_campaign_id +    │
│                channel_type (SEARCH|SHOPPING|PERFORMANCE_MAX)   │
│  AdGroup, Ad, Keyword (new tables, scoped to platform="google") │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  modules/google_ads_provider  (thin — provider only)            │
│  GoogleAdsProvider — OAuth + customers.search GAQL +            │
│  conversions:upload + mutates                                   │
│  Reuses encryption + token-refresh pattern from google_merchant │
└──────────────────────────┬──────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
   ┌──────────────────┐       ┌──────────────────────┐
   │ Subscribers      │       │ Scheduled Jobs       │
   │ - order.completed│       │ - refresh-tokens     │
   │   → upload       │       │ - sync-campaigns     │
   │   ClickConversion│       │ - pull-reports       │
   │   from existing  │       │ - account-health     │
   │   Conversion row │       │                      │
   └──────────────────┘       └──────────────────────┘
                           ▲
                           │
   ┌─────────────────────────────────────────────────────────────┐
   │ Admin UI — extends existing analytics dashboards            │
   │   /admin/ads/accounts        unified Meta + Google list     │
   │   /admin/ads/campaigns       extend AdCampaign list with    │
   │                              platform filter chip           │
   │   /admin/ads/reports         reuse website-analytics-modal  │
   │                              charts + filter popover        │
   │   /admin/ads/audiences       Customer Match (Google)        │
   └─────────────────────────────────────────────────────────────┘
```

### Why reuse instead of standing up `google_ads/`

- **`Conversion.platform = "google"` already exists** (`src/modules/ad-planning/models/conversion.ts:30,113`). A parallel `GoogleAdsConversion` table would duplicate it.
- **`CampaignAttribution.platform = "google"` already exists** (`src/modules/ad-planning/models/campaign-attribution.ts:22-24`). The attribution resolver already works platform-agnostically.
- **`AdCampaign` already mirrors campaigns** for Meta. Adding a discriminator is a single migration; a parallel table is N migrations + N joins to query "all campaigns".
- **The `analytics_event.created → resolveSessionAttribution → Conversion` pipeline** is exactly the path Google needs. No reason to fork it.

The only **new** module is a thin `google_ads_provider` that owns the SDK client + OAuth. Models live in the existing modules.

---

## Required external setup (one-time, per JYT instance)

1. **Google Ads Developer Token + access tier.** Apply at `https://ads.google.com/aw/apicenter` (must be from a Google Ads **manager account**, not a regular customer). Four tiers exist:

   | Tier | Daily ops | What it unlocks | Review |
   |---|---|---|---|
   | Test Account Access | 15,000 | Test accounts only | Instant |
   | Explorer Access | 2,880 (prod) / 15,000 (test) | Production + test accounts | Auto-upgrade in some cases |
   | Basic Access | 15,000 | Production + test, full | **2 business days** |
   | Standard Access | Unlimited | Production + test, full | **10 business days** |

   "Per day" is a sliding 24-hour window. Over-quota requests fail with `RESOURCE_EXHAUSTED`. **Apply for Basic on day one** — 15K ops/day is enough for Phase 1 (read-only sync of campaigns + reports for a single-digit number of accounts) and the 2-day review fits comfortably inside the build timeline. Apply for Standard later, gated on actual conversion-upload volume.

2. **Manager (MCC) account.** Required by Google during the dev-token application — they want it at the **root** of the account hierarchy. Single-tenant deployments still need an MCC for the application; child accounts are linked under it.

3. **GCP project + OAuth client.** Same project as Merchant. Enable "Google Ads API" in the API library. Add `https://www.googleapis.com/auth/adwords` scope to the consent screen.

4. **Dev-token storage.** Encrypted env var `GOOGLE_ADS_DEVELOPER_TOKEN`. Single value across all customer accounts under our MCC. Multi-tenant deployments using their own dev token can override per-account in `api_config.developer_token` (encrypted).

Document this in a new guide (`apps/docs/docs/guides/google-ads-setup.md`) once Phase 1 ships.

---

## Phase 0 — Click-id plumbing (prerequisite for Phase 2)

**Goal:** capture `gclid` (and `fbclid` / `wbraid` / `gbraid` while we're here) from the URL, persist it on the analytics session, and surface it on the `Conversion` record. No Google Ads code yet — this is purely client-side + analytics-module work that **also** improves Meta attribution.

### 1. `assets/analytics.js`

Extend `getUTMParams()` (currently `assets/analytics.js:82-100`) to also pull:
- `gclid` — Google Ads click identifier
- `wbraid` — iOS 14+ web-aggregated click id
- `gbraid` — iOS 14+ web-only click id
- `fbclid` — Meta click identifier (already implicitly captured but not normalized)

Persist in sessionStorage at the same key as UTMs (or a sibling `jyt_click_ids` key) so subsequent `trackConversion` calls can attach them.

Transmit in the `trackPageview` and `trackConversion` POST bodies as a top-level `click_ids` object.

### 2. `modules/analytics`

Add columns to `AnalyticsEvent` and `AnalyticsSession`:
- `gclid: string | null`
- `fbclid: string | null`
- `wbraid: string | null` (Google iOS-14 web-aggregated)
- `gbraid: string | null` (Google iOS-14 web-only)

Indexes on each so the attribution resolver can look them up in O(log n) without a metadata-key scan.

`/web/analytics/track` route's Zod input adds an optional `click_ids` object. Workflow `trackAnalyticsEventWorkflow` (`src/workflows/analytics/track-analytics-event.ts`) writes them to the new columns.

### 3. `modules/ad-planning` — attribution resolver

Extend `resolveSessionAttributionWorkflow` so that when the session has a `gclid` (or other Google click id) it short-circuits the UTM fuzzy-match and writes a `CampaignAttribution` row with `platform="google"`, `resolution_method="gclid_match"`, `metadata.gclid=<value>`. The existing UTM path stays as a fallback.

### 4. `Conversion` row gets `gclid`

When the subscriber emits a `Conversion` row, copy any captured click ids from the session onto `Conversion.metadata.click_ids`. This is what Phase 2 reads when uploading to Google.

### Files

| Path | Change |
|---|---|
| `assets/analytics.js` | Extend `getUTMParams`, add `getClickIds`, persist + transmit |
| `src/modules/analytics/models/analytics-event.ts` | Add 4 nullable columns + indexes |
| `src/modules/analytics/models/analytics-session.ts` | Same |
| `src/workflows/analytics/track-analytics-event.ts` | Accept + persist `click_ids` |
| `src/api/web/analytics/track/route.ts` | Add `click_ids` to validator |
| `src/workflows/ad-planning/attribution/resolve-session-attribution.ts` | New gclid-match path |
| `src/subscribers/ad-planning/analytics-event-created.ts` | Copy click ids onto Conversion.metadata |

### Why this is Phase 0, not part of Phase 2

It blocks Phase 2 conversion uploads, but it's also independently valuable: Meta attribution improves the day this ships (via `fbclid`), and any future channel that has a click id (TikTok `ttclid`, etc.) gets the same plumbing for free. Shipping it standalone also means Phase 1 (read-only sync) can land in parallel without coordinating storefront work.

---

## Phase 1 — Account connect + read-only sync

**Goal:** an admin can OAuth-connect a Google Ads customer, see its existing campaigns, and pull daily performance metrics. No write surface.

### Generalize existing models

Don't create a parallel `google_ads/` module. Extend the existing `socials` module instead.

**`AdAccount` migration:**
```ts
// src/modules/socials/models/AdAccount.ts
platform: "meta" | "google"            // new — discriminator
google_customer_id: string | null      // new — Google Ads customer id
google_login_customer_id: string | null // new — MCC parent if applicable
google_manager: boolean                // new — is this an MCC?
google_currency: string | null         // new — pulled from customer record
google_time_zone: string | null        // new — required for report queries
// existing meta_* fields stay nullable; populated only when platform="meta"
```

**`AdCampaign` migration:**
```ts
// src/modules/socials/models/AdCampaign.ts
platform: "meta" | "google"            // new — discriminator
google_campaign_id: string | null      // new — Google Ads numeric id
channel_type: enum | null              // new — SEARCH|SHOPPING|PERFORMANCE_MAX|DISPLAY|VIDEO
budget_micros: bigint | null           // new — Google reports in micros (1M = 1 currency unit)
bidding_strategy_type: string | null   // new — MAXIMIZE_CONVERSIONS, TARGET_ROAS, etc.
// existing meta_* fields stay nullable
```

**New tables (scoped to `platform="google"`):**
- `ad_group` — `(ad_campaign_id, google_ad_group_id, name, status, type, cpc_bid_micros)`
- `ad` — `(ad_group_id, google_ad_id, type, headlines_json, descriptions_json, final_urls, status)`
- `keyword` — `(ad_group_id, google_criterion_id, text, match_type, status, cpc_bid_micros)`
- `ad_report_row` — `(ad_account_id, ad_campaign_id, ad_group_id?, ad_id?, keyword?, day, impressions, clicks, conversions, cost_micros, conversion_value_micros)`

`ad_report_row` is **append-only daily aggregates** scoped by `platform` so we can later store Meta report rows here too.

### New thin provider module

```
src/modules/google_ads_provider/
  index.ts
  service.ts
  provider.ts        // wraps google-ads-node SDK; owns auth + GAQL execution
  __tests__/
```

This module owns the SDK client and the OAuth refresh logic — analogous to `google_merchant` provider. **No models.** Models live in `socials` + `ad_planning`.

### API routes

Existing `/admin/ads/...` routes (or whatever currently surfaces Meta `AdAccount` / `AdCampaign`) get a `platform` filter. New Google-specific OAuth endpoints follow the Merchant pattern.

```
# Existing routes — extend with platform filter
GET    /admin/ads/accounts?platform=google           filter the existing list
GET    /admin/ads/campaigns?platform=google&account_id=…
GET    /admin/ads/campaigns/:id                      already platform-aware after migration

# New Google-specific OAuth + sync routes
POST   /admin/ads/accounts                           create (with platform="google")
GET    /admin/ads/accounts/:id/oauth-init            authorization URL
POST   /admin/ads/accounts/:id/oauth-callback        exchange code
POST   /admin/ads/accounts/:id/refresh-token         manual refresh
GET    /admin/ads/accounts/:id/sync-status           last sync timestamps + counts
POST   /admin/ads/accounts/:id/sync-campaigns        on-demand re-sync
GET    /admin/ads/accounts/:id/reports               query ad_report_row (filterable by campaign, date)
```

Naming the namespace `/admin/ads/` (not `/admin/google-ads/`) keeps the surface unified across Meta + Google. If the current Meta surface is at `/admin/socials/ads`, generalize that namespace as part of the migration; otherwise the migration scope grows. **Confirm with the Meta integration owner before locking the URL shape.**

### Workflows

| Workflow | Purpose |
|---|---|
| `sync-google-ads-account` | Pull campaigns + ad groups + ads + keywords for one account |
| `pull-google-ads-reports` | Pull last-N-days `customer.search` GAQL into report rows |
| `refresh-google-ads-token` | Token refresh (mirrors the merchant version) |

### Subscribers + jobs

| Job | Schedule | Purpose |
|---|---|---|
| `refresh-google-ads-tokens` | `*/30 * * * *` | Proactive refresh (mirrors `refresh-google-merchant-tokens.ts`) |
| `sync-google-ads-campaigns` | `0 */4 * * *` | Pull campaign + ad group + ad changes every 4h |
| `pull-google-ads-reports` | `0 5 * * *` | Daily pull of yesterday's metrics at 05:00 |

### Admin UI

- New section `/admin/google-ads/` in the sidebar.
- Accounts list mirrors the Merchant accounts list shape.
- Campaign list per account — name, status, type (badge), budget, today's metrics, 7-day metrics.
- Campaign detail — ad groups, ads, keywords, daily chart of impressions/clicks/conversions/cost.

### Files

| Path | Change |
|---|---|
| `src/modules/google_ads_provider/` | **New** thin provider module (no models) |
| `src/modules/socials/models/AdAccount.ts` | Add `platform`, Google fields, migration |
| `src/modules/socials/models/AdCampaign.ts` | Add `platform`, Google fields, migration |
| `src/modules/socials/models/ad-group.ts` | **New** |
| `src/modules/socials/models/ad.ts` | **New** |
| `src/modules/socials/models/keyword.ts` | **New** |
| `src/modules/socials/models/ad-report-row.ts` | **New** — shared with Meta later |
| `src/api/admin/ads/**` | Extend (or create if not present) — platform-aware |
| `src/workflows/google_ads/sync-google-ads-account.ts` | **New** |
| `src/workflows/google_ads/pull-google-ads-reports.ts` | **New** |
| `src/workflows/google_ads/refresh-google-ads-token.ts` | **New** |
| `src/jobs/refresh-google-ads-tokens.ts` | **New** — `*/30 * * * *` |
| `src/jobs/sync-google-ads-campaigns.ts` | **New** — `0 */4 * * *` |
| `src/jobs/pull-google-ads-reports.ts` | **New** — `0 5 * * *` |
| `src/admin/routes/ads/**` | Extend with Google-specific UI |

### Out of scope for Phase 1

Writes (create/update/delete on Google's side), Customer Match audiences, conversion uploads, smart bidding strategies. All are Phase 2+.

---

## Phase 2 — Conversion tracking (write-back)

**Goal:** every JYT order with a Google click id creates a corresponding click-conversion in Google Ads, so Smart Bidding has the signal it needs.

**Depends on Phase 0** (click-id capture in `analytics.js` + `Conversion.metadata.click_ids` populated by the existing subscriber).

### Required pieces

1. **Conversion action definitions.** New table `google_ads_conversion_action` mirroring Google's. Service methods to list/create. UI to map a JYT conversion goal (existing `ad_planning.ConversionGoal`) to a Google `ConversionAction` of type `UPLOAD_CLICKS` (status `ENABLED`). Lookup query (GAQL):
   ```sql
   SELECT conversion_action.resource_name, conversion_action.id, conversion_action.name
   FROM conversion_action
   WHERE conversion_action.type = 'UPLOAD_CLICKS' AND conversion_action.status = 'ENABLED'
   ```

2. **No new click-id storage.** Phase 0 already lands gclid/gbraid/wbraid on `AnalyticsSession`, copies onto `Conversion.metadata.click_ids`. Phase 2 just **reads** it. Exactly one of `gclid` / `gbraid` / `wbraid` is required by Google for standard click conversions.

3. **Subscriber on `conversion.created`** (not `order.completed` — the `Conversion` row carries the click id and resolved campaign). Source: `src/modules/ad-planning/models/conversion.ts`. Filter to `platform="google"` AND at least one of the three click ids present.

4. **`UploadClickConversions` request shape** — the contract is non-trivial; bake these into the provider so callers never construct it by hand:

   | Field | Required | Notes |
   |---|---|---|
   | `customer_id` | yes | Resolved from the `AdAccount.google_customer_id` |
   | `partial_failure` | yes — **must be `true`** | Google rejects imports with `partial_failure: false`. Iterate the response's `partial_failure_error` and the per-conversion `results` arrays in lockstep to surface row-level errors. |
   | `validate_only` | optional | Use for dry-runs in tests + the conversion-action mapping wizard |
   | `conversions[*].conversion_action` | yes | Resource name from the GAQL query above |
   | `conversions[*].conversion_date_time` | yes | Format `yyyy-mm-dd HH:mm:ss±HH:mm` — must include the customer's TZ offset, **not** UTC |
   | `conversions[*].conversion_value` + `currency_code` | recommended | From the JYT order |
   | `conversions[*].order_id` | recommended | **Use this for dedup, not gclid.** If you set it on import you must use it on any future adjustments — store it on the `google_ads_conversion_upload_failure` retry record so retries match |
   | `conversions[*].gclid` / `gbraid` / `wbraid` | exactly one | From `Conversion.metadata.click_ids` |
   | `conversions[*].consent.ad_user_data` | strongly recommended | Enum: `GRANTED` / `DENIED` / `UNSPECIFIED`. **If `DENIED`, the API returns zero results — request is not processed.** Source from JYT consent state at order time |
   | `conversions[*].consent.ad_personalization` | strongly recommended | Same enum, same DENIED behaviour |
   | `job_id` | optional | Use a stable hash of the run for diagnostics in Google Ads UI |

5. **Enhanced Conversions for Leads** — for conversions with no click id but with customer PII and consent, fall back to `user_identifiers` (hashed email + phone). When uploading without a click id, the provider must set `skip_conversion_threshold_check` accordingly. Hashing rules (mirror the Customer Match rules in Phase 4): SHA-256 of trimmed-lowercased email; phone in E.164; Gmail-only normalization removes periods + plus suffixes from the local part.

6. **Failure handling.** Failed uploads land in a new `google_ads_conversion_upload_failure` table (in `google_ads_provider`) keyed on `(conversion_id, attempt_count)`. The daily retry job re-reads the source `Conversion` row (so it always has fresh data) and re-uploads with the same `order_id` (Google dedups idempotently).

### Files

| Path | Change |
|---|---|
| `src/modules/google_ads_provider/models/conversion-action.ts` | **New** — mirror of Google `ConversionAction` |
| `src/modules/google_ads_provider/models/conversion-upload-failure.ts` | **New** — retry queue |
| `src/api/admin/ads/conversion-actions/**` | **New** — CRUD + JYT-goal-to-Google-action mapping UI |
| `src/subscribers/google-ads-upload-conversion.ts` | **New** — listens to `conversion.created` (filters to platform="google") |
| `src/jobs/retry-google-ads-conversion-uploads.ts` | **New** — daily retry sweep |

**No storefront work in Phase 2** — Phase 0 already covered it.

---

## Phase 3 — Campaign management (write surface)

**Goal:** create + edit Performance Max campaigns directly from JYT, tied to a Merchant feed already managed in JYT.

### Scope

- **Performance Max first.** Single campaign type that uses our Merchant feed automatically. Smaller surface than Search/Display.
- Then **Shopping**, then **Search**.

### Backend

#### Mutate ordering (the part that bites everyone)

PMax Retail must be created with a **single atomic `mutate` call** using temporary resource ids (negative integers). Order matters; some pairs must be **sequential without anything else in between**:

```
1. CampaignBudget         tempId=-1   explicitly_shared=false  (PMax can't share budgets)
2. Campaign               tempId=-2   advertising_channel_type=PERFORMANCE_MAX
                                      status=PAUSED            (always start paused)
                                      shopping_setting.merchant_id=<MC account id>
                                      campaign_budget=temp(-1)
                                      bidding_strategy: MAXIMIZE_CONVERSIONS or
                                                        MAXIMIZE_CONVERSION_VALUE
3. CampaignAssets         (immediately after Campaign — if brand guidelines on)
4. CampaignCriterion[]    language + geo target criteria
5. AssetGroup             tempId=-3   campaign=temp(-2)
6. AssetGroupAsset[]      sequential, immediately after AssetGroup, no other ops between
7. AssetGroupListingGroupFilter  for retail product targeting
```

Hard rules:
- `CampaignAsset` (when brand guidelines is enabled) **must be immediately after `Campaign`**, otherwise `CampaignError: missing assets`.
- `AssetGroup` and its `AssetGroupAsset[]` **must be sequential without intervening operations**, otherwise `AssetGroupError: missing assets`.
- Some asset types — text headlines/descriptions in particular — should be **created in a prior `mutate` request** as standalone `Asset` resources, then referenced by `AssetGroupAsset` in the campaign-creation request.

#### Workflows

1. `createPerformanceMaxRetailCampaignWorkflow` — composite workflow:
   - Step A: pre-create text/image/video `Asset[]` resources (separate mutate request) → returns resource names
   - Step B: build the single mutate request in the order above using temp ids + the asset resource names from A
   - Step C: execute. On success, sync the new resources back into `socials.AdCampaign` etc. with `platform="google"`.
   - Compensation: `Campaign.status=REMOVED` on the new campaign id; budget left in place (Google doesn't allow soft-delete of budgets without the campaign reference).
2. `updateCampaignWorkflow` — partial update on biddable fields (status, budget, bidding strategy targets).
3. `pauseCampaignWorkflow` / `enableCampaignWorkflow` — quick toggles via `status` mutate.
4. `assetCreateWorkflow` — image/video/text upload + sync back. Used independently of campaigns for asset library management.

#### Prerequisites the workflow must check before submitting

- **Conversion tracking exists** in the account (`SELECT conversion_action FROM conversion_action LIMIT 1` returns at least one). PMax refuses to serve without a conversion goal.
- **Merchant Center is linked** to the Ads account. Surface as a one-click action if missing — the linkage is a separate API call (`MerchantCenterLink:mutate`) requiring approval on the Merchant side.
- **Customer time zone + currency** known and stored on the `AdAccount` row. Required for the budget interpretation.
- **At least one Asset Group meets minimums** (image counts, text counts) per Google's PMax asset specs. Validate client-side before submit.

### Admin UI

- "Create campaign" button on the campaigns list.
- Form steps: name + budget → connect Merchant feed → upload assets → review + activate.
- Validation against Google's PMax requirements (asset counts, character limits) before submit.

### Out of scope

Smart Bidding strategy creation (Phase 4), creative auto-generation (later).

---

## Phase 4 — Audiences (Customer Match) + smart bidding

### Customer Match audiences

- **Source** from the existing `ad_planning.CustomerSegment` (behaviour-driven) **and** Medusa's `customer_group` (stable). Pick whichever is the operator's source of truth.
- **Storage**: new `google_ads_audience` model in `google_ads_provider` linking the source segment id ↔ Google `userList.resource_name`. **Don't** duplicate segment data; just store the mapping.
- **Upload mechanism is `OfflineUserDataJob`, not direct user_list mutate**:
  1. Create empty `UserList` via `UserListService` with `crm_based_user_list.upload_key_type` (`CONTACT_INFO` covers email + phone + address)
  2. Create `OfflineUserDataJob` with `customer_match_user_list_metadata`. Required: `consent.ad_user_data` + `consent.ad_personalization` — if either is `DENIED`, Google rejects with `CUSTOMER_NOT_ACCEPTED_CUSTOMER_DATA_TERMS`. For unconsented users, emit a separate `remove` job.
  3. `AddOfflineUserDataJobOperations` — recommended batch size **10,000** identifiers (max 100,000). Each `UserData` carries up to 20 identifiers; only one `upload_key_type` per list.
  4. `RunOfflineUserDataJob` (must be within 5 days of creation)
  5. Poll for completion, then verify match rate.
- **Hashing rules** (SHA-256 lowercase trimmed):
  - Phone → E.164 first
  - Gmail / Googlemail addresses only — strip periods + plus suffixes from local part before hashing
  - Other domains — preserve periods/plus signs, just lowercase + trim
  - Mailing address requires hashed first/last name + country code + postal code together
- **Activation thresholds.** Google recommends ≥5,000 members for the list to actually serve. Below that, the audience exists but has no targetable users. Surface this in the admin UI.
- **Resync trigger**: subscriber on `customer_segment.members.recomputed` or `customer_group.member.added/removed`. Don't mix `create` + `remove` ops in the same job — Google rejects with `CONFLICTING_OPERATION`.

### Smart bidding

- Bidding strategy CRUD (`bidding_strategy:create/update`).
- Attach a strategy to a campaign.
- Surface: account-level bidding-strategy library reused across campaigns.

### Recommendations API

Pull `recommendation:list` and surface "you should do X" prompts in the campaign UI. Auto-apply non-destructive recommendations on operator approval.

---

## Phase 5 — Reports + alerting

Built on the report rows already collected in Phase 1, surfaced in the existing analytics dashboard pattern.

### Reuse the analytics dashboard scaffolding

Don't write a new dashboard from scratch. The pieces already exist:

| Reuse | Source | For |
|---|---|---|
| Filter popover (preset + custom date range, UTM filters, source/medium chips) | `src/admin/components/websites/website-analytics-modal.tsx` | Same pattern, but filter by `(platform, ad_account_id, ad_campaign_id)` |
| Recharts `AreaChart` + `BarChart` + `PieChart` + `ResponsiveContainer` setup | same file | Time series of impressions / clicks / conversions / cost; channel-mix pie; campaign-cost bar |
| Country map | `src/admin/components/websites/analytics-country-map.tsx` | Reusable as-is for geo-performance views |
| Hook pattern `useWebsiteAnalytics(websiteId, filters)` | `src/admin/hooks/api/analytics.ts` | Mirror as `useAdReports({ platform, account_id, campaign_id?, date_range })` |

Where the existing dashboard groups by `pathname` / `utm_source`, the ads dashboard groups by `ad_campaign_id` / `ad_group_id`. Same chart shapes; different aggregation key. Worth lifting the chart components into a shared `apps/admin-ui/src/components/charts/` (or `src/admin/components/charts/`) so neither dashboard owns them privately.

### Cross-channel "Paid Media" view

Because `AdAccount` / `AdCampaign` / `ad_report_row` are now platform-discriminated, a single SQL aggregate gives Meta + Google side by side:

```sql
SELECT platform, sum(cost_micros)/1e6 AS spend, sum(conversions) AS conv,
       sum(conversion_value_micros)/1e6 AS revenue
FROM ad_report_row
WHERE day >= now() - interval '30 days'
GROUP BY platform;
```

A unified "Paid Media" tab is then a small variant of the per-platform view.

### Anomaly alerts via visual flows

Reuse the [Production Run Reminders](../workflows/production-run-reminders.md) pattern:

```
Cron daily 09:00 IST
  ↓
read_data: yesterday's ad_report_row for active accounts
  ↓
execute_code: classify (cost up >50% DoD? CTR drop >40% DoD? CVR drop?)
  ↓
bulk_trigger_workflow → emit-ad-anomaly-event (per (account, campaign, kind))
  ↓
event "ad.anomaly_detected" → existing WhatsApp / email dispatcher
```

Templates: one per anomaly kind (cost spike, conversion drop, account suspended). Same dedup-by-day strategy as the production-run reminders.

---

## Cross-cutting concerns

### Auth flow

Same shape as Merchant:

1. Admin enters `client_id` + `client_secret` per account (or reuses an org-default).
2. OAuth init → Google consent → callback stores encrypted `refresh_token`.
3. `getAuthedProvider(accountId)` checks expiry + refreshes; pattern lifted from `src/modules/google_merchant/service.ts:36-69`.

The **developer token** is a single org-level value (`GOOGLE_ADS_DEVELOPER_TOKEN` env). For multi-tenant deployments using their own dev token, allow per-account override in `api_config`.

### Account types: direct vs MCC-managed

- **Direct customer.** OAuth connects the customer account itself. No `login_customer_id` needed.
- **MCC-managed.** OAuth connects an MCC, then API calls set `login-customer-id` header to the MCC and target a specific child customer. Models support both; UI exposes "is this an MCC?" checkbox.

### Currency + time zone

Pull from the customer record on connect; store on the account row. Reports must respect the customer's time zone (Google reports in the customer's TZ, not server TZ).

### Rate limits

Google Ads API has per-developer-token quotas. Add a request-throttling layer in `GoogleAdsProvider` (token-bucket; see `src/modules/google_merchant/provider.ts` for an analogous pattern).

### Encryption

Reuse the encryption module patterns from Merchant — refresh tokens, client secrets must be encrypted at rest.

### Error surface

GAQL errors return rich `google_ads_failure` arrays. Persist them in the workflow execution record (visual-flow style) so admins can debug a failed write without diving into logs.

---

## Phasing summary

| Phase | Outcome | Depends on | T-shirt |
|---|---|---|---|
| 0. Click-id capture | gclid/fbclid/wbraid/gbraid landed on AnalyticsEvent + Conversion. Improves Meta attribution day one. | — | S |
| 1. Connect + read | See campaigns + reports inside JYT (extends `socials.AdAccount`/`AdCampaign` with platform discriminator) | — | L |
| 2. Conversions | Smart Bidding actually has data; subscribes to existing `Conversion` rows | 0, 1 | M |
| 3. Campaign create/edit | Run PMax + Shopping from JYT | 1, 2 | L |
| 4. Audiences + bidding | Closed-loop optimization, sourcing from `ad_planning.CustomerSegment` | 1, 2 | M |
| 5. Reports + alerts | Operators stop opening Google Ads UI; reuses `website-analytics-modal` charts | 1 | M |

Recommend **0 + 1 in parallel** (different parts of the codebase, no overlap), then **2** (which needs both), then **3** and **5** in parallel, then **4**. Phase 0 is independently shippable and improves Meta the day it lands — start there if Phase 1's external dependencies (dev-token approval) haven't cleared.

---

## Open questions

- **Dev token tier sequence.** Apply for Basic Access (2-day review, 15K ops/day) on day one — covers Phase 1 (read-only sync) and the early validation phase of Phase 2 comfortably. Apply for Standard only when projected daily conversion uploads + report queries push past 15K ops, which is well into Phase 2 production traffic. **Do not block Phase 1 on Standard approval.**
- **MCC vs per-customer OAuth.** Google requires an MCC for the dev-token application regardless. For runtime, recommend MCC-mediated for multi-account operators (single OAuth on the MCC + `login_customer_id` header per request to target a child); single-account operators can OAuth directly into the customer. Both code paths needed; default-mode driven by org config.
- **Conversion attribution model.** Last-click vs data-driven affects which conversions get credit. Phase 2 stores raw uploads; the model is an account-level setting we don't override. UI surfaces it for visibility only.
- **Storefront work for GCLID capture.** Phase 0 ships in `assets/analytics.js`. Coordinate with the storefront owner before merging — the change is small but lands on every page-load.
- **Library choice.** `google-ads-node` (official) vs `google-ads-api` (community). Official is recommended; community lib has nicer ergonomics but lags on new fields. Review at Phase 1 kickoff.
- **Merchant Center linkage.** PMax Retail requires the Merchant Center account to be linked to the Ads account (`MerchantCenterLink`). The link request is created from the Ads side and **must be approved from the Merchant side** — surface this gate in the campaign-creation wizard. The approval is a separate Merchant API write that pairs with the Phase 2 work in the [Google Merchant Roadmap](../integrations/google-merchant-roadmap.md).
- **Allowlist gates (read in advance).** The Merchant Phase 1b `triggeraction` allowlist is independent of any Google Ads gates but follows a similar form-based application pattern — track both submissions on the same project board so neither becomes the surprise blocker.

## References

- [Google Merchant Center Integration](../integrations/google-merchant.md) — current Merchant integration, source of OAuth + provider patterns to reuse.
- [Google Merchant Roadmap](../integrations/google-merchant-roadmap.md) — Merchant gaps; Phase 5 of that roadmap (reports) shares dashboard infra with Phase 5 here.
- [Meta Ads Integration Plan](./meta-ads-integration.md) — sister channel; reuse audience modeling + dashboard layouts.
