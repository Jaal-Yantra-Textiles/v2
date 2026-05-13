# Google Ads API — Basic Access Application

> Submission text for upgrading our Google Ads developer token from **Test access** to **Basic access** under our manager (MCC) account. Paste each section into the corresponding field on the Google Ads API Center application form. Attach the screenshots referenced in *Tool Mockups* as separate files.

## Company Name

Kind Health Tech SIA

## Business Model

Kind Health Tech SIA operates an e-commerce marketplace as a software platform. We own and run several consumer-facing storefronts on this platform, including:

- https://www.cicilabel.com
- https://sharlho.cicilabel.com
- https://www.perennial.to

All advertising activity is exclusively for products and brands inside our partner network — we do not run ads on behalf of third parties unrelated to our platform, and we do not resell API access to external advertisers.

## Tool Access and Use

The tool is used internally by two groups of users at Kind Health Tech SIA:

1. **Employees** — full-time staff who manage the marketplace and its merchandising.
2. **In-house ad managers** — staff who own campaign performance for our storefronts.

There is no third-party login to the tool. Access is gated by our internal admin authentication (Medusa Admin session + secret key).

Functionality available to authorized users:

- A **reporting dashboard** showing account, campaign, ad-group, ad, and time-series performance metrics pulled from the Google Ads API.
- A **PDF export** of any report view, suitable for internal review and record-keeping.

In addition to the human-facing dashboard, an **automated synchronization script** runs hourly. It is operated by Kind Health Tech SIA only and does not act on data outside our own customer accounts.

## Tool Design

The tool has two cooperating components:

### 1. Reporting pipeline (read path)

- A scheduled job calls the Google Ads API (`GoogleAdsService.searchStream` over GAQL) at most once per hour per managed customer ID (CID).
- The response is normalized and persisted to our PostgreSQL database in dedicated tables: `google_ads_customer`, `google_ads_campaign`, `google_ads_ad_group`, `google_ads_ad`, and `google_ads_insights`.
- `google_ads_insights` stores per-day rows segmented by entity (customer / campaign / ad group / ad), with optional device and network breakdowns. Re-sync of an existing window updates the existing row by composite key (`level`, `entity_id`, `date`, `device`, `network`), so we do not append duplicate rows.
- The UI reads exclusively from this local database, never directly from the Google Ads API. This keeps user-facing latency low and bounds our daily API call volume to the cost of refresh, not the cost of UI traffic.
- Users may select reporting **levels** (account / campaign / ad group / ad) and **time periods** (default 30 days; configurable from 1 to 365 days). PDF exports render server-side from the same database rows.

### 2. Inventory synchronization (write path)

- An hourly scheduled script reads inventory state from our internal SQL database (`stock_location` + `inventory_level` tables in our Medusa-based commerce backend).
- For each ad whose linked product transitions to out-of-stock, the script calls `AdGroupAdService.MutateAdGroupAds` to set the ad's status to `PAUSED`.
- When stock is replenished, the same script re-enables the ad via the same service.
- No other write operations are performed against the Google Ads API by this tool. We do not create campaigns, modify bids, change targeting, or upload conversions automatically.

### Rate-limiting and request budget

- Read path: one `searchStream` query per CID per resource (customer, campaign, ad group, ad, insights) per hour. With our current bound customer set this stays well under the published Basic access daily operation limit.
- Write path: `AdGroupAdService.MutateAdGroupAds` calls only when inventory state transitions; expected volume is low (tens of mutations per day in steady state, bursting during seasonal launches).

### Identity and authorization

- The tool authenticates to Google via OAuth 2.0 against a Workspace user authorized on our manager (MCC) account.
- The `login-customer-id` header is set per request from the bound child customer's discovered manager, so every API call is scoped to the correct MCC context.
- Developer token and OAuth refresh token are stored encrypted at rest (AES-GCM, key managed in our backend's `encryption` module).

## API Services Called

The tool uses only the services listed below. We are not requesting access to any other API surface.

| Service | Purpose | Direction |
|---|---|---|
| `CustomerService` / `GoogleAdsService` (GAQL `FROM customer`) | Pull account-level metadata and performance reports (descriptive name, currency, time zone, manager flag, plus aggregate metrics for the reporting dashboard). | Read |
| `GoogleAdsService.SearchStream` (GAQL `FROM campaign`, `FROM ad_group`, `FROM ad_group_ad`) | Pull campaign / ad group / ad performance data and creative metadata for the dashboard and PDF exports. | Read |
| `GoogleAdsService.SearchStream` with `segments.date` and (optionally) `segments.device` / `segments.ad_network_type` | Pull daily time-series data for trend charts and device/network breakdowns. | Read |
| `AdGroupAdService.MutateAdGroupAds` | Set an ad to `PAUSED` or back to `ENABLED` in response to local inventory state changes. | Write |

We do **not** plan to call any other service at this time. If our use case grows to require additional surfaces, we will submit a new application.

## Tool Mockups

The following screenshots are attached to this application (capture from the live admin dashboard at https://v3.jaalyantra.com/admin/ads with internal staff credentials):

1. **`mockup-ads-landing.png`** — Top-level `/admin/ads` page with the platform picker (Google Ads selected) and the in-page tab strip (Accounts · Campaigns · Ad groups · Ads · Insights).
2. **`mockup-ads-accounts-tab.png`** — Accounts tab showing customers synced from a connected MCC, with currency, status, and last-synced timestamp.
3. **`mockup-ads-campaigns-tab.png`** — Campaigns tab showing aggregated 30-day metrics (impressions, clicks, CTR, spend in account currency, conversions) with the account filter dropdown.
4. **`mockup-ads-insights-tab.png`** — Insights tab with the daily-trend line chart (impressions, clicks, spend) over a configurable date window, plus the daily breakdown table with CTR, avg CPC, avg CPM, conversions value, and device dimension.
5. **`mockup-ads-pdf-export.png`** — Example PDF report generated from the dashboard for internal review and record-keeping.

## Contact

- **Primary technical contact**: _(name + email — fill in before submitting)_
- **Manager account CID**: _(fill in before submitting)_
- **Developer token**: _(masked — Google Ads API Center will already have this on file)_
