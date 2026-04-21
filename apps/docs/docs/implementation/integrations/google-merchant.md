---
title: "Google Merchant Center Integration"
sidebar_label: "Google Merchant"
sidebar_position: 2
---

# Google Merchant Center Integration

## Overview

Per-account OAuth integration with Google Merchant Center that lets admins configure their own OAuth credentials through the admin UI (no shared env vars), connect multiple Merchant Center accounts per store, sync products one-at-a-time or in bulk, auto-resync on product updates, and reconcile Medusa products with listings already in Google.

Uses the current **Merchant API** (`merchantapi.googleapis.com/products/v1beta`), not the legacy Content API.

---

## End-to-end workflow

```
┌──────────────────┐
│ 1. Google Cloud  │ Create OAuth client + enable Merchant API
│    Console       │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 2. Add Account   │ Enter client_id, client_secret, merchant_id,
│    in Admin UI   │ feed defaults (content_language, feed_label, currency)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 3. Connect       │ OAuth redirect → Google consent → callback
│    (OAuth)       │ stores encrypted refresh_token
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 4. Detect /      │ Pick an existing API data source, or auto-create
│    create data   │ one that matches feed_label + content_language
│    source        │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 5a. Import       │ (optional) Pull existing Google listings and
│     existing     │ link them to Medusa products by handle == offerId
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 5b. Sync         │ Single product (widget) or all products
│     products     │ (bulk job with progress)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 6. Stay in sync  │ product.updated subscriber auto-resyncs every
│                  │ linked account in the background
└──────────────────┘
```

---

## Setup

### 1. Google Cloud Console

1. Open https://console.cloud.google.com/apis/credentials and choose or create a project.
2. **Enable APIs**: search for and enable **Merchant API** (and **Content API for Shopping** if you need legacy access).
3. **OAuth consent screen**: configure it (Internal or External), scope `https://www.googleapis.com/auth/content`.
4. **Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URIs: `https://<your-admin-host>/app/settings/google-merchant/oauth-callback` (for local dev: `http://localhost:9000/app/settings/google-merchant/oauth-callback`).
5. Copy the **Client ID** and **Client Secret** — you'll paste them into the admin UI.
6. Note your **Merchant Center ID** from https://merchants.google.com (top-right).

### 2. Encryption key

Secrets at rest (`client_secret`, `refresh_token`, `access_token`) are encrypted via the `encryption` module. Ensure the key is set:

```bash
# .env
ENCRYPTION_KEY=$(openssl rand -base64 32)
```

### 3. Database migrations

Links and the Google Merchant module tables are created by Medusa's safe-links migration:

```bash
yarn medusa db:migrate --execute-safe-links
```

This creates:
- `google_merchant_account`
- `google_merchant_sync_job`
- `product_product_google_merchant_google_merchant_account` (link pivot with extra columns)

### 4. Add and connect an account in the admin UI

1. Go to **Settings → External Platforms**. The **Google Merchant Center** row is injected at the top of the table.
2. Click the row → **Add Account** in the drawer.
3. Fill in:
   - **Name** — internal label
   - **Merchant Center ID** — the numeric id from merchants.google.com
   - **OAuth Client ID / Secret** — from Google Cloud Console
   - **Redirect URI** — must match the one registered in Google Cloud Console exactly
   - **Storefront base URL** — used to build product landing URLs (e.g. `https://shop.example.com`)
   - **Content Language** / **Feed Label** / **Currency** — default feed metadata
4. Save → on the detail page click **Connect to Google**. You'll be redirected to Google, consent, then returned to the admin.
5. After returning, the status badge flips to **Connected**.

### 5. Detect or create a data source

Google requires an **API-input data source** for product uploads. A yellow banner on the detail page tells you when one isn't configured:

- Click **Detect or create** — the backend lists existing data sources, picks a matching one (API input, same `contentLanguage` and `feedLabel`), or auto-creates `Medusa API (<feed_label>/<content_language>)` if none exists.
- The selected data source is saved in `api_config.data_source_name` and used by all subsequent inserts.

### 6a. (Optional) Import existing Google listings

If you have products already live in Google Merchant (added manually or via another tool), click **Import from Google** on the account detail page. The backend:

1. Paginates `productInputs` from the Merchant API (up to ~12.5k products).
2. Matches each Google `offerId` against Medusa product `handle`.
3. Creates a link record for each match with `sync_status: "synced"` and `metadata.imported: true`.
4. Skips products that already have a link.
5. Returns counts: `google_total`, `matched`, `linked`, `skipped_existing_link`, `unmatched`.

> **Matching convention**: Medusa `product.handle` must equal Google `offerId`. If your existing listings use a different offer ID scheme, rename them in Google first, or wait for the custom-mapping feature.

### 6b. Sync products

Three paths, pick what fits:

**Single product (from the product detail page)**
The widget `product.details.side.after` shows one row per connected account with a **Sync** / **Re-sync** / **Remove** button. Uses `POST /admin/google-merchant/accounts/:id/sync-product`.

**All products (bulk)**
On the account detail page click **Sync All Products** → the backend creates a `google_merchant_sync_job` row and fires the workflow in the background. The **Sync History** section polls every 4s and shows status, progress, and counts.

**Auto-resync**
Every `product.updated` event triggers the `google-merchant-product-updated` subscriber, which resyncs the product to every linked account. No configuration — the subscriber only acts on products that already have a link.

---

## Architecture

### Module: `google_merchant`

**Location:** `src/modules/google_merchant/`

**Models:**

1. **`google_merchant_account`** — per-admin Merchant Center account + OAuth state.

   | Field | Type | Notes |
   |---|---|---|
   | `name` | text | user-facing label |
   | `merchant_id` | text | numeric Google MC id |
   | `client_id` | text | OAuth client id (not secret) |
   | `client_secret` | json | AES-256-GCM encrypted blob |
   | `redirect_uri` | text | must match Google Cloud Console |
   | `scope` | text? | default `https://www.googleapis.com/auth/content` |
   | `access_token` | text? | stores JSON-serialized encrypted blob |
   | `refresh_token` | json? | encrypted blob |
   | `token_expires_at` | datetime? | drives proactive refresh |
   | `account_email` | text? | fetched via `oauth2/v3/userinfo` |
   | `is_active` | boolean | flipped true after OAuth success |
   | `api_config` | json? | `data_source_name`, `landing_url_base`, `content_language`, `feed_label`, `currency_code`, `pending_oauth_state` |

2. **`google_merchant_sync_job`** — bulk sync progress.

   | Field | Type | Notes |
   |---|---|---|
   | `transaction_id` | text? | for future workflow integrations |
   | `account_id` | text | FK (string) |
   | `status` | enum | `pending`/`processing`/`completed`/`failed` |
   | `total_products` | number | set after listing products |
   | `synced_count` / `failed_count` | number | updated every 5 items |
   | `error_log` | json? | `{ product_id, error }[]` |
   | `started_at` / `completed_at` | datetime? |  |

**Module constant:** `GOOGLE_MERCHANT_MODULE = "google_merchant"`

**Registered in:** `medusa-config.ts` → `./src/modules/google_merchant`

### Provider: `GoogleMerchantProvider`

**Location:** `src/modules/google_merchant/provider.ts`

Per-account provider (instantiated with credentials from the account row) — **not** a singleton registry.

| Method | Purpose |
|---|---|
| `getAuthorizationUrl(state, scope?)` | build consent URL with `access_type=offline` + `prompt=consent` |
| `exchangeCodeForToken(code)` | auth code → access + refresh tokens |
| `refreshAccessToken(refreshToken)` | standard refresh flow |
| `getUserInfo(accessToken)` | pulls `email` for display |
| `insertProduct(accessToken, merchantId, payload, dataSourceName?)` | `productInputs:insert` — falls back to `accounts/:id/dataSources/primary` if no dataSourceName passed |
| `deleteProduct(accessToken, productName)` | delete by Merchant API resource name |
| `listDataSources(accessToken, merchantId)` | `datasources/v1beta` list |
| `createPrimaryApiDataSource(accessToken, merchantId, input)` | create an API-input primary data source |
| `listProductInputs(accessToken, merchantId, { pageToken, pageSize })` | paginate existing Google listings (import source) |

### Module link: Product ↔ Google Merchant Account

**Location:** `src/links/product-google-merchant-link.ts`

Pivot: `product_product_google_merchant_google_merchant_account`.

Extra columns:
- `google_product_id` — offerId we submitted
- `google_product_name` — Merchant API resource name (used for delete)
- `sync_status` — `pending` / `synced` / `failed`
- `last_synced_at`
- `sync_error`
- `metadata` (JSON) — `imported: true` when backfilled from Google

`isList: true` on product side, `isList: false` on account — multiple accounts per product.

---

## Admin API reference

All routes under `/admin/google-merchant/`. Authed via standard admin session/bearer.

### Accounts

| Method | Path | Purpose |
|---|---|---|
| `GET`    | `/accounts` | list accounts (sanitised — no secrets) |
| `POST`   | `/accounts` | create account; encrypts `client_secret` |
| `GET`    | `/accounts/:id` | detail |
| `POST`   | `/accounts/:id` | update; re-encrypts `client_secret` if provided |
| `DELETE` | `/accounts/:id` | delete |

### OAuth

| Method | Path | Purpose |
|---|---|---|
| `GET`    | `/accounts/:id/oauth-init` | start OAuth; returns `{ location, state }` |
| `POST`   | `/accounts/:id/oauth-callback` | exchange code, verify state, store encrypted tokens |

### Data source

| Method | Path | Purpose |
|---|---|---|
| `GET`    | `/accounts/:id/data-sources` | list Google data sources + currently selected |
| `POST`   | `/accounts/:id/data-sources` | `{ action: "detect" \| "create" \| "select", data_source_name?, display_name? }` |

### Sync — single

| Method | Path | Purpose |
|---|---|---|
| `POST`   | `/accounts/:id/sync-product` | `{ product_id, content_language?, feed_label?, currency_code?, landing_url_base? }` |
| `DELETE` | `/accounts/:id/products/:product_id` | unsync one product |
| `GET`    | `/product-sync-status?product_id=...` | per-account sync state for a product |

### Sync — bulk

| Method | Path | Purpose |
|---|---|---|
| `POST`   | `/accounts/:id/sync-all` | fire bulk sync; returns `202 { job }` with job id |
| `GET`    | `/accounts/:id/sync-jobs` | list jobs for an account (paginated) |
| `GET`    | `/sync-jobs/:id` | single job detail (for polling) |

### Import existing

| Method | Path | Purpose |
|---|---|---|
| `POST`   | `/accounts/:id/import` | `{ dry_run?: boolean }` — pull Google listings, link matching Medusa products |

`sanitizeAccount()` (`accounts/helpers.ts`) strips `client_secret`, `refresh_token`, and `access_token` from every response and adds booleans `connected`, `has_client_secret`, `has_refresh_token`.

---

## Workflows

**Location:** `src/workflows/google_merchant/`

### `syncProductToGoogleWorkflow` (single product)

Step: `syncProductToGoogleStep` (with **compensation**)

1. Load the account. 404 if missing, 403 if no refresh token, 400 if no `merchant_id`.
2. Decrypt `client_secret` + `refresh_token`. Instantiate `GoogleMerchantProvider`.
3. Decrypt stored `access_token`; if missing or within 60s of expiry, refresh and re-encrypt+store it.
4. Fetch the product via `query.graph` (title, handle, variants.prices, images, metadata).
5. Capture `priorLink` — used by compensation to restore state.
6. Validate (title / handle / first-variant price / at least one image). On failure, upsert link as `failed` and throw.
7. Map to Merchant API payload via `mapProductToGoogleMerchant()`:
   - `offerId` = `handle || id`
   - `link` = `${landing_url_base}/products/${handle}`
   - `amountMicros` = `amount × 10_000` (Medusa stores in cents)
   - availability from `inventory_quantity`
   - up to 10 `additionalImageLinks`
8. Call `provider.insertProduct(…, account.api_config.data_source_name)`. On success, upsert link `synced` with `google_product_id` / `google_product_name` / `last_synced_at`. On failure, upsert `failed` and rethrow.

**Compensation** (runs if a later workflow step fails):
- Refresh token, call `provider.deleteProduct` to undo the Google-side insert.
- If a prior link existed, merge-restore it; otherwise dismiss the link entirely.

**Link writes** use a **create-first** pattern:
- `readExistingLink()` checks for a prior row.
- No prior → atomic `remoteLink.create`.
- Prior exists → merge new fields with old, then `dismiss` + `create`.

### `bulkSyncProductsToGoogleWorkflow`

Step: `bulkSyncProductsToGoogleStep`

1. Mark job `processing`, stamp `started_at`.
2. Load products (`product_ids` filter optional — otherwise all products).
3. Refresh access token once for the whole batch.
4. Iterate products → map → `insertProduct` → upsert link → push any failure into `error_log`.
5. Report progress to the `google_merchant_sync_job` row every 5 items.
6. Finalise: `completed` if any success, `failed` if all failed.

Returns `{ job_id, total, synced, failed }`. The route fires the workflow fire-and-forget; clients poll `GET /sync-jobs/:id`.

### `importExistingProductsFromGoogleWorkflow`

Step: `importExistingProductsFromGoogleStep`

1. Authenticate and refresh the token.
2. Paginate `productInputs` (pageSize 250, max 50 pages ≈ 12.5k products).
3. Resolve `handle → product_id` for any matching offerIds.
4. Skip products that already have a link for this account.
5. For each match (unless `dry_run`): `remoteLink.create` with `sync_status: "synced"` and `metadata.imported: true`.
6. Return `{ google_total, matched, linked, skipped_existing_link, unmatched }`.

### `unsyncProductFromGoogleWorkflow`

Step: `unsyncProductFromGoogleStep`

1. Load the account.
2. Look up the link to pull `google_product_name`.
3. If present and the account is authenticated: refresh token → `provider.deleteProduct`.
4. `remoteLink.dismiss` the link. Google delete failure is logged but doesn't block local dismissal.

---

## Subscribers

### `google-merchant-product-updated`

**Location:** `src/subscribers/google-merchant-product-updated.ts`

Listens on `product.updated`. For each Google Merchant link on the product, fires `syncProductToGoogleWorkflow` (fire-and-forget). Unlinked products are ignored — this doesn't auto-sync products that have never been explicitly synced.

---

## Admin UI

### External Platforms entry (`routes/settings/external-platforms/page.tsx`)
Google Merchant appears as a virtual row at the top of the External Platforms table. Clicking it opens a drawer with:
- Account list + connection status
- **Add Account** (navigates to create)
- Per-account row → navigates to detail
- **Back to External Platforms** (close)

### Account management (`routes/settings/google-merchant/`)

- `page.tsx` — list view with connection badges.
- `create/page.tsx` — full OAuth-credential + feed-defaults form.
- `[id]/page.tsx` — detail with:
  - **Connect / Reconnect / Edit / Delete** buttons
  - **Import from Google** — pulls existing listings into links
  - **Sync All Products** — starts a bulk job
  - **Data source banner** — shown when `data_source_name` is missing
  - **Sync History** — live-polling list of recent bulk sync jobs with progress + status
  - **Edit drawer** — update display fields and feed config without breaking OAuth
- `oauth-callback/page.tsx` — spinner + status text during the round-trip; toasts on error.

### Product-detail widget (`widgets/product-google-merchant.tsx`)

`defineWidgetConfig({ zone: "product.details.side.after" })`.

Per connected account: status badge, last-synced timestamp, offer id, truncated error tooltip, **Sync** / **Re-sync** / **Remove** buttons.

### Hooks (`hooks/api/google-merchant.ts`)

React Query wrappers for every route, including:
- `useInitiateGoogleMerchantOAuth` — handles `oauth-init` + localStorage stash + redirect
- `useSyncProductToGoogleMerchant` / `useUnsyncProductFromGoogleMerchant`
- `useBulkSyncGoogleMerchant` + `useGoogleMerchantSyncJobs` (supports `refetchIntervalMs` for live progress)
- `useGoogleMerchantDataSources` + `useGoogleMerchantDataSourceAction`
- `useImportExistingGoogleProducts`

---

## Security

- **AES-256-GCM** encryption (`encryption` module) for `client_secret`, `refresh_token`, and `access_token`. Each value uses a unique IV + auth tag.
- `access_token` is stored as a JSON-serialized encrypted blob in a text column. The sync step is tolerant of legacy plaintext rows to avoid a data migration.
- All responses run through `sanitizeAccount()` — secrets never leave the backend.
- OAuth state is stored on the account row (`api_config.pending_oauth_state`) **and** in `localStorage`. The callback verifies both.
- Refresh token requested with `prompt=consent` + `access_type=offline` so every fresh consent yields a refresh token.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| OAuth callback toasts "state mismatch" | `localStorage` cleared between init and callback | Retry the Connect flow from the detail page |
| `insertProduct` returns 404 dataSource | `data_source_name` not set / points to a deleted DS | Click **Detect or create** on the account page |
| Bulk sync reports all failures with `landing_url_base not configured` | Storefront URL missing | Set it in **Edit → Storefront base URL** or `STORE_URL` env |
| Import reports many `unmatched` | Google `offerId` differs from Medusa `handle` | Rename offerIds in Google to match handles |
| `product.updated` isn't re-syncing | Product has no existing link | First sync triggers from the widget or bulk sync |
| 403 after months of activity | Google revoked the refresh token | Click **Reconnect** to run OAuth again |

---

## What's implemented vs. deferred

**Implemented**
- Per-account OAuth with user-configured `client_id` / `client_secret`
- Single-product sync with automatic token refresh
- Bulk sync workflow with `google_merchant_sync_job` progress tracking and live polling UI
- Import existing Google listings and link them to Medusa products by handle
- Data source detection and auto-create (no more hardcoded `dataSources/primary`)
- Auto-resync via `product.updated` subscriber
- Unsync (delete from Merchant API + dismiss link) with step compensation
- Per-account sync status in the product widget
- Multi-account per store
- Encrypted `client_secret`, `refresh_token`, and `access_token`
- Admin UI: External Platforms row drawer, account management, edit drawer, OAuth callback loader, detail page actions

**Deferred**
- `product.created` auto-sync (requires a "default sync targets" config to avoid spam)
- Integration test coverage
- Custom offerId ↔ handle mapping (needed when Google listings use non-handle offerIds)
- Scheduled status pulls (`productStatuses`) to catch Google-side disapprovals
- Feed-level config UI (multiple feed labels / languages per account)

---

## File map

```
src/
├── modules/google_merchant/
│   ├── index.ts
│   ├── service.ts
│   ├── provider.ts
│   ├── models/
│   │   ├── google_merchant_account.ts
│   │   └── google_merchant_sync_job.ts
│   └── migrations/
├── links/product-google-merchant-link.ts
├── workflows/google_merchant/
│   ├── index.ts
│   ├── workflows/
│   │   ├── sync-product-to-google.ts
│   │   ├── unsync-product-from-google.ts
│   │   ├── bulk-sync-products-to-google.ts
│   │   └── import-existing-products-from-google.ts
│   └── steps/
│       ├── map-product-to-google.ts
│       ├── sync-product-to-google.ts            # with compensation
│       ├── unsync-product-from-google.ts
│       ├── bulk-sync-products-to-google.ts
│       └── import-existing-products-from-google.ts
├── subscribers/google-merchant-product-updated.ts
├── api/admin/google-merchant/
│   ├── accounts/route.ts
│   ├── accounts/helpers.ts
│   ├── accounts/[id]/route.ts
│   ├── accounts/[id]/oauth-init/route.ts
│   ├── accounts/[id]/oauth-callback/route.ts
│   ├── accounts/[id]/sync-product/route.ts
│   ├── accounts/[id]/sync-all/route.ts
│   ├── accounts/[id]/sync-jobs/route.ts
│   ├── accounts/[id]/import/route.ts
│   ├── accounts/[id]/data-sources/route.ts
│   ├── accounts/[id]/products/[product_id]/route.ts
│   ├── sync-jobs/[id]/route.ts
│   └── product-sync-status/route.ts
└── admin/
    ├── hooks/api/google-merchant.ts
    ├── widgets/product-google-merchant.tsx
    └── routes/settings/google-merchant/
        ├── page.tsx
        ├── create/page.tsx
        ├── [id]/page.tsx                        # edit + bulk + import + data-source + sync history
        └── oauth-callback/page.tsx              # spinner + status
```
