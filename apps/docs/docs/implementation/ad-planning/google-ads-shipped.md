---
title: "Google Ads — What's Shipped (May 2026)"
sidebar_label: "Google Ads (Shipped)"
sidebar_position: 6
---

# Google Ads — What's Shipped (May 2026)

> Companion to [Google Ads Integration Plan (Proposal)](./google-ads-integration.md). The proposal lays out the full vision; this doc captures what's actually live in the codebase as of May 2026, across PRs #203 and #204.

The shipped slice covers the **read-side sync**, **write-side conversion upload**, and the **admin UIs** that operators need to configure and debug both. Campaign management (write-back to Google) and Search ads management are still in the proposal-only phase.

_Last updated: 2026-05-10_

---

## What you can do today

| Capability | Status | Where |
|---|---|---|
| OAuth-connect a Google account, pick services | ✅ shipped | GBM panel, RouteDrawer flow |
| Bind one or more Google Ads CIDs to a row | ✅ shipped | Per-service binding picker |
| Sync customers, campaigns, ad groups + 30d metrics | ✅ shipped | "Sync now" button + workflow |
| Auto-attribute conversions to synced campaigns | ✅ shipped | `resolveAttributionStep` in track-conversion |
| Push conversions to Google Ads via `uploadClickConversions` | ✅ shipped | `conversion.created` subscriber |
| Configure platform-level upload defaults from UI | ✅ shipped | Drawer at `[id]/google-ads-defaults` |
| Configure per-goal mapping overrides from UI | ✅ shipped | Goal detail → Google Ads mapping drawer |
| Inspect upload status + retry per conversion | ✅ shipped | Conversion detail page |
| Goals admin (CRUD + listing) | ✅ shipped | `/ad-planning/goals` |
| Manage campaigns (write-back to Google) | ❌ proposal | Phase 3 of `google-ads-integration.md` |
| Search Console / Business Profile insights | ❌ proposal | Out of scope; bindings exist, no readers |

---

## Architecture

### Data flow

```
                                  ┌─────────────────────┐
                                  │ Google Ads API (v24)│
                                  └──────┬──────────────┘
                                         │
                ┌────────────────────────┼────────────────────────────┐
                │                        │                            │
            sync flow              upload flow              live picker fetch
                │                        │                            │
                ▼                        ▼                            ▼
   syncGoogleAdsWorkflow     uploadGoogleAdsConversion       listConversionActions
        (per CID)            ConversionWorkflow              Workflow (per CID)
                │                        │                            │
                ▼                        ▼                            ▼
   GoogleAdsCustomer         conversion.metadata.            (in-memory only —
   GoogleAdsCampaign         google_ads_uploaded_at,         used to populate
   GoogleAdsAdGroup          *_customer_id,                  picker dropdowns)
                │            *_conversion_action,
                │            *_matched_goal_id
                │
                └─► resolveAttributionStep reads campaigns by utm_campaign
                    (campaign_id or name) when utm_source ∈ {google,
                    googleads, adwords, google_ads}
```

### Module placement

Google Ads data lives in the **socials** module alongside `SocialPlatform` and `SocialPlatformBinding`, not in a separate `google_ads` module. The 3 new tables sit parallel to the Meta-shaped ones (`AdAccount`, `AdCampaign`, etc.) — the proposal calls for unifying them with a `provider` discriminator, but that's a bigger refactor that wasn't in scope for this slice.

| Table | Purpose |
|---|---|
| `google_ads_customer` | One row per Google Ads CID we've synced. Indexed by `(platform_id, customer_id)`. |
| `google_ads_campaign` | Campaigns under a customer with 30d rolled-up metrics. |
| `google_ads_ad_group` | Ad groups under a campaign with 30d rolled-up metrics. |

`SocialPlatform` gained a `google_ads_customers: hasMany` back-relation. The `binding_id` on `google_ads_customer` is **text, not a FK** — bindings can be deleted independently and we don't want a cascade to wipe synced data.

Migration: `apps/backend/src/modules/socials/migrations/Migration20260509061454.ts`. Note: the auto-generator initially produced a 1.4k-line migration that touched unrelated tables (cart, customer, design, etc.) — the shipped migration is a hand-trimmed ~30-line version that only creates the new tables and FKs.

---

## Conversion upload — resolution chain

When the `conversion.created` subscriber fires, it dispatches the upload workflow if `platform === "google"` and the conversion has a click id (`gclid` / `gbraid` / `wbraid`). The upload step then resolves the target customer + conversion-action in this order:

**Customer ID:**

1. `conversion.metadata.google_ads_customer_id` (explicit override)
2. Matched `ConversionGoal.metadata.google_ads.customer_id` (per-goal override, sorted by priority desc)
3. The single `ads` binding on the resolved platform (if exactly one)
4. `platform.api_config.google_ads.default_customer_id`

**Conversion action (resource name):**

1. `conversion.metadata.google_ads_conversion_action`
2. Matched `ConversionGoal.metadata.google_ads.conversion_action`
3. `platform.api_config.google_ads.default_conversion_action`

**Platform ID** (resolved by the subscriber, not the upload step):

1. `conversion.metadata.google_ads_platform_id`
2. Single eligible google-category platform (developer token + at least one upload default configured)

If any of customer/action can't be resolved, the step records the skip reason on `conversion.metadata.google_ads_upload_skip_reason` and exits successfully. The subscriber is therefore **idempotent and silent on misconfiguration** — non-Google or non-click-tagged conversions don't fail loudly.

Goal matching mirrors the existing `updateGoalsStep` filter: `goal_type = conversion.conversion_type`, `is_active = true`, `website_id`, sorted by `priority desc`. Only goals with `metadata.google_ads.{customer_id, conversion_action}` set are considered for the override — goals without that block are still counted but don't drive the upload.

---

## Attribution reader

`resolveAttributionStep` in `apps/backend/src/workflows/ad-planning/conversions/track-conversion.ts` consults synced Google Ads campaigns when:

- The session has no existing resolved `CampaignAttribution`
- `utm_source` is one of: `google`, `googleads`, `adwords`, `google_ads` (case-insensitive, hyphens/spaces normalized to underscores)
- `utm_campaign` matches a synced `GoogleAdsCampaign` by `campaign_id` (auto-tagging case) **or** by case-insensitive `name` (manual tagging case)

When matched, the conversion gets `platform: "google"` and `ad_campaign_id` set to the Google numeric campaign id. This is the first reader of the synced data — without it the `google_ads_campaign` rows are write-only.

---

## Admin UI surfaces

### GBM panel (`/admin/external-platforms/[id]`)

Refactored from a 700-line column into a read-only summary plus 4 RouteDrawer flows:

- **Connect** (`[id]/google-connect`) — service checkboxes + Connect with Google
- **Edit credentials** (`[id]/google-credentials`) — client_id, client_secret, developer_token
- **Bind \<service\>** (`[id]/google-bind/[service]`) — resource picker per service
- **Edit upload defaults** (`[id]/google-ads-defaults`) — CID picker (synced rows) + conversion-action picker (live GAQL fetch) + validate-only toggle

The "Google Ads data" section appears once at least one `ads` binding exists. It shows synced customers with sync status / last_synced_at / sync_error inline; each customer expands to show campaigns with 30d metrics. Header has "Sync now" + "Edit defaults" plus a status badge ("Upload defaults configured" green / "Upload defaults not set" orange / "Dry run" if `validate_only`).

### Conversion detail (`/ad-planning/conversions/[id]`)

Single-column page with five sections:

1. **General** — type, value, currency, attribution model + weight, order/person/visitor links
2. **Attribution** — ad_campaign_id / ad_set_id / ad_id (renders only when present)
3. **UTM** — source/medium/campaign/term/content
4. **Google Ads upload** (only shown for `platform: "google"` or any `google_ads_*` metadata key)
   - Status badge: uploaded / error / skipped / pending
   - Customer ID, conversion_action, matched_goal_id, click_id
   - Partial failure JSON (when present)
   - Error / skip reason rendering
   - **Retry upload** button → `POST /admin/ad-planning/conversions/:id/google-upload`
5. **Raw metadata JSON**

The conversions list's Type badge is now a link into the detail page.

### Goals admin (`/ad-planning/goals`)

Built from scratch — backend endpoints existed, no UI did. Pages:

- List with type filter, priority/status/conversions count columns, "Mapped" badge per row
- Create page using shared `GoalForm`
- Detail with general / counters / conditions / Google Ads mapping sections
- Edit drawer (`[id]/edit`)
- Google Ads mapping drawer (`[id]/google-ads-mapping`) with three pickers — platform, CID, conversion-action — that auto-select the single eligible google platform when only one exists

The mapping form saves to `goal.metadata.google_ads.{customer_id, conversion_action}` — **no `platform_id`** stored, since the customer_id and conversion_action resource_name uniquely identify the target (a CID is bound to exactly one platform).

---

## Backend surface map

### Workflows

| Workflow | Purpose |
|---|---|
| `syncGoogleAdsWorkflow` | Refresh token → per-CID GAQL pull customers + campaigns + ad_groups → upsert |
| `uploadGoogleAdsConversionWorkflow` | Refresh token → resolve customer + conversion_action → call `customers/{cid}/conversionUploads:uploadClickConversions` → stamp result on conversion metadata |
| `listGoogleAdsConversionActionsWorkflow` | Refresh token → GAQL `FROM conversion_action` for one CID — backs the picker dropdowns |

All three compose `refreshGoogleTokenStep` first (a no-op when the token has buffer headroom), reusing the OAuth pattern from the original GBM PR.

### Admin endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/admin/social-platforms/:id/google/ads/customers` | List synced GoogleAdsCustomer rows |
| `GET` | `/admin/social-platforms/:id/google/ads/campaigns?customer_id=…` | List synced campaigns (filtered by CID or all) |
| `GET` | `/admin/social-platforms/:id/google/ads/conversion-actions?customer_id=…` | Live GAQL fetch for picker |
| `POST` | `/admin/social-platforms/:id/google/ads/sync` | Trigger sync workflow |
| `POST` | `/admin/ad-planning/conversions/:id/google-upload` | Manually retry upload |

### Subscriber

`apps/backend/src/subscribers/google-ads/conversion-created.ts` — fires on `conversion.created` (auto-emitted by Medusa when `createConversions` runs). Filters: `platform === "google"` AND has click id. Resolves platform, dispatches upload workflow.

---

## Operator setup

### Prerequisites

- Google Ads developer token (request via your Google Ads Manager account → API Center)
- A Google Cloud OAuth client (Web application) with `https://your-domain/admin/social-platforms/.../google/oauth-callback` as the redirect URI
- `GOOGLE_REDIRECT_URI` env var set on the backend
- The **Google Ads API** enabled in the GCP project
- OAuth consent screen scopes include `https://www.googleapis.com/auth/adwords`

### One-time per platform row

1. Create a Google-category external platform
2. Edit credentials → paste client_id, client_secret, developer_token
3. Connect with Google → tick the services you want (must include Google Ads)
4. Bind at least one Google Ads CID via the Bind drawer
5. Sync now → confirm customers + campaigns populate
6. Edit upload defaults → pick CID + conversion-action (or leave blank to require per-goal mapping)
7. (Optional) Toggle validate-only for dry-run mode while wiring up

### Per goal (optional override)

In `/ad-planning/goals/[id]` → Google Ads mapping → pick platform + CID + conversion-action. Saves to `goal.metadata.google_ads.*` and overrides the platform default.

---

## Known gaps + next steps

| Gap | Impact | Where to start |
|---|---|---|
| Goal-type ↔ conversion-type enum mismatch | `lead_form` (goal) vs `lead_form_submission` (conversion), `page_view` vs `page_engagement`, etc. — `updateGoalsStep` and `resolveGoalMapping` both miss these. Pre-existing ad-planning bug. | Add a normalization map in `track-conversion.ts:updateGoalsStep` |
| No goal-side `platform_id` storage | Per-goal mapping can't target a specific google platform when multiple exist with overlapping CID names | Add `goal.metadata.google_ads.platform_id`, plumb through `resolveGoalMapping` |
| No tests for the new workflows | Sync + upload workflows are uncovered | Standalone integration tests under `integration-tests/http/google-ads-*.spec.ts` |
| Search Console / Business Profile readers | Bindings can be created but no data flows | Out of scope until there's a consumer |
| Campaign management (write-back) | Operators still create/edit campaigns in Google's UI | Phase 3 of [proposal](./google-ads-integration.md#phase-3--campaign-management-write-surface) |
| Per-binding "default Ads CID" toggle | Operators with multiple CIDs must edit upload defaults manually | Add a small inline action on the binding card |

---

## Test plan (manual)

A reproducible end-to-end smoke test, useful when verifying a deployment:

1. `pnpm exec medusa db:migrate` — confirms `google_ads_*` tables exist
2. Create a google-category platform, save credentials, connect, bind at least one Ads CID
3. Click "Sync now" → expect `{ customers_synced: ≥1, campaigns_synced: ≥0 }` and the Google Ads data section populates
4. Edit upload defaults → pick CID + conversion-action → save → status badge flips to "Upload defaults configured" (green)
5. POST a test conversion via `/web/ad-planning/track-conversion` with `utm_source=google`, `utm_campaign=<a synced campaign name>`, and `metadata.gclid=<a real gclid>`
6. Visit the conversion in `/ad-planning/conversions/[id]` → the Google Ads upload section reads `uploaded` (or `skipped` with a clear reason)
7. If upload error → use Retry upload → confirm metadata updates without re-creating the conversion
8. Create a goal at `/ad-planning/goals/create`, configure its mapping, fire a conversion that matches the goal, confirm `metadata.google_ads_matched_goal_id` records the goal id

---

## Related documents

- [Google Ads Integration Plan (Proposal)](./google-ads-integration.md) — the full vision, including unshipped Phase 3 (campaign management) and Phase 4 (Search ads)
- [Meta Ads Integration](./meta-ads-integration.md) — sister integration that this work mirrors structurally
- [Ad Planning Module](./module.md) — base architecture this slice extends
