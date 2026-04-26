# Meta Ads Overview Drilldown

## What was added

### 1) Routed drilldown modals (Campaign / Ad Set / Ad)

From the Meta Ads Overview page, clicking a top entity row now opens a routed modal using `RouteFocusModal`.

- Campaign modal:
  - Route: `/meta-ads/overview/campaigns/:id`
  - Files:
    - `src/admin/routes/meta-ads/overview/campaigns/[id]/page.tsx`
    - `src/admin/routes/meta-ads/overview/campaigns/[id]/route.ts`

- Ad set modal:
  - Route: `/meta-ads/overview/adsets/:id`
  - Files:
    - `src/admin/routes/meta-ads/overview/adsets/[id]/page.tsx`
    - `src/admin/routes/meta-ads/overview/adsets/[id]/route.ts`

- Ad modal:
  - Route: `/meta-ads/overview/ads/:id`
  - Files:
    - `src/admin/routes/meta-ads/overview/ads/[id]/page.tsx`
    - `src/admin/routes/meta-ads/overview/ads/[id]/route.ts`

Each modal:
- Retrieves the selected entity by internal `id`.
- Derives the necessary Meta IDs and scope:
  - `platform_id`
  - `meta_account_id`
  - and the relevant object id (`meta_campaign_id` / `meta_adset_id` / `meta_ad_id`)
- Calls `useMetaAdsOverview` with:
  - `level` = `campaign` | `adset` | `ad`
  - `object_id` = the relevant Meta object id

### 2) Overview page grouping control (Campaigns / Ad Sets / Ads)

On the Meta Ads Overview page, the “Top …” section now includes a selector:

- Group: Campaigns
- Group: Ad Sets
- Group: Ads

Clicking a row navigates to the corresponding routed modal.

File:
- `src/admin/routes/meta-ads/overview/page.tsx`

### 3) Admin API endpoints for list + detail (ad sets, ads)

Added/extended endpoints to enable drilldown scoping context:

- List ad sets:
  - `GET /admin/meta-ads/adsets`
  - Supports `ad_account_id`, `campaign_id`, `limit`, `offset`
  - File: `src/api/admin/meta-ads/adsets/route.ts`

- Ad set detail:
  - `GET /admin/meta-ads/adsets/:id`
  - File: `src/api/admin/meta-ads/adsets/[id]/route.ts`

- List ads:
  - `GET /admin/meta-ads/ads`
  - Supports `ad_account_id`, `campaign_id`, `ad_set_id`, `limit`, `offset`
  - File: `src/api/admin/meta-ads/ads/route.ts`

- Ad detail:
  - `GET /admin/meta-ads/ads/:id`
  - File: `src/api/admin/meta-ads/ads/[id]/route.ts`

### 4) React Query hooks (admin)

Added hooks used by the overview grouping and drilldown pages:

- `useAdSets`, `useAdSet`
- `useAds`, `useAd`

File:
- `src/admin/hooks/api/meta-ads.ts`

Notes:
- `useAdSets` and `useAds` are guarded to only run when scoped by at least one of the supported filters.

### 5) UX improvement: toast feedback for overview refresh/sync

The Overview page now shows:

- A persistent loading toast while the overview request is in-flight.
- A success toast when the overview updates (including `data_source` if provided).
- An error toast if the request fails.
- A warning toast if persistence is enabled and the response reports persistence errors.

File:
- `src/admin/routes/meta-ads/overview/page.tsx`

## What is needed next

### 1) Remote ad creation UI

The Overview UI currently surfaces the capability flag:

- `overview.capabilities.remote_ad_creation.supported`

Next steps:
- Add a CTA (button) in the Overview UI and/or drilldown modals when supported.
- Implement a creation flow for:
  - Campaign
  - Ad set
  - Ad

This should likely be a routed modal (consistent with existing patterns), with:
- selection of target Ad Account
- validation of required fields
- server endpoint(s) that call the provider service to create remote objects
- persistence of the created objects in local DB

### 2) Add support for other ad providers (X, LinkedIn, etc.)

Recommended approach:
- Keep the Overview UI/provider-agnostic by:
  - scoping via `platform_id`
  - using a common “Ads provider” interface at the module/service level
- Implement provider-specific modules/services for:
  - X Ads (Twitter Ads)
  - LinkedIn Marketing

Each provider should expose consistent capabilities:
- list ad accounts
- list campaigns / ad sets / ads
- list insights with a normalized shape
- optional remote creation (campaign/adset/ad)

Then extend:
- `GET /admin/meta-ads/overview` into a more generic ads overview endpoint, or
- create parallel routes per provider (if required), while reusing the UI components.

### 3) Performance improvements (if needed)

Some list endpoints currently filter in-memory after retrieving larger sets.
If/when this becomes slow, extend the module service list methods to:
- filter by account/campaign at the DB query level
- paginate at DB level

## How to test

- Visit `Meta Ads > Overview`.
- Select a Meta platform and ad account.
- Use `Refresh: Force Meta` to see the sync toast.
- In “Top …” section, toggle grouping and click a row to open the routed modal.
