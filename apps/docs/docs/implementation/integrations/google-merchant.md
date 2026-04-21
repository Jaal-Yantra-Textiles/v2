---
title: "Google Merchant Center Integration"
sidebar_label: "Google Merchant"
sidebar_position: 2
---

# Google Merchant Center Integration

## Overview

Per-account OAuth integration with Google Merchant Center that lets admins configure their own OAuth credentials through the External Platforms UI (no shared env vars), connect multiple Merchant Center accounts per store, and sync products one at a time from the product-detail page via a widget.

Uses the current **Merchant API** (`merchantapi.googleapis.com/products/v1beta`), not the legacy Content API.

Multi-account per store — mirrors the Etsy pattern but with credentials stored per account rather than globally.

---

## Architecture

### Module: `google_merchant`

**Location:** `src/modules/google_merchant/`

**Models:**

1. **`google_merchant_account`** — per-admin Merchant Center account + OAuth state
   - `name` — user-facing label
   - `merchant_id` — numeric Google Merchant Center ID
   - `client_id` — OAuth client ID (user-entered, plaintext; not secret)
   - `client_secret` — encrypted via AES-256-GCM (`encryption` module)
   - `redirect_uri` — must match Google Cloud Console exactly
   - `scope` — optional; defaults to `https://www.googleapis.com/auth/content`
   - `access_token` — short-lived, refreshed transparently
   - `refresh_token` — encrypted
   - `token_expires_at` — used to drive proactive refresh
   - `account_email` — fetched from `oauth2/v3/userinfo` after first OAuth success
   - `is_active` — flipped to `true` after successful OAuth
   - `api_config` (JSON) — feed defaults (`landing_url_base`, `content_language`, `feed_label`, `currency_code`), plus a short-lived `pending_oauth_state`

2. **`google_merchant_sync_job`** — placeholder model for future batch-sync workflow (unused today; reserved so the batch workflow can land without another migration).

**Module Constant:** `GOOGLE_MERCHANT_MODULE = "google_merchant"`

**Registered in:** `medusa-config.ts` → `./src/modules/google_merchant`

### Provider: `GoogleMerchantProvider`

**Location:** `src/modules/google_merchant/provider.ts`

Per-account provider (instantiated with credentials pulled from a `google_merchant_account` row) — **not** a singleton registered in a registry. This is the key deviation from the Etsy pattern, because each admin account uses its own OAuth client.

Capabilities:
- `getAuthorizationUrl(state, scope?)` — builds the `accounts.google.com/o/oauth2/v2/auth` URL with `access_type=offline` + `prompt=consent` so every fresh authorisation yields a refresh token.
- `exchangeCodeForToken(code)` — trades the authorisation code for access + refresh tokens.
- `refreshAccessToken(refreshToken)` — standard refresh flow.
- `getUserInfo(accessToken)` — pulls the authenticated Google account's email for display.
- `insertProduct(accessToken, merchantId, payload)` — Merchant API `productInputs:insert?dataSource=accounts/<mid>/dataSources/primary`.
- `deleteProduct(accessToken, productName)` — Merchant API delete by resource name.

---

## Module Link: Product ↔ Google Merchant Account

**Location:** `src/links/product-google-merchant-link.ts`

Pivot table: `product_product_google_merchant_google_merchant_account`.

**Extra columns track per-account sync state:**
- `google_product_id` — the offer ID we submitted
- `google_product_name` — the resource name returned by Merchant API (used for delete)
- `sync_status` — `pending` / `synced` / `failed` (defaults to `pending`)
- `last_synced_at`
- `sync_error`
- `metadata` (JSON)

Multiple accounts per product: the link is `isList: true` on the product side and `isList: false` on the account side.

---

## OAuth flow (per account, user-configured credentials)

1. Admin clicks **Add Account** and enters `name`, `merchant_id`, `client_id`, `client_secret`, `redirect_uri`, and feed defaults.
2. `POST /admin/google-merchant/accounts` encrypts the client secret and saves the row with `is_active: false`.
3. Admin clicks **Connect** → `GET /admin/google-merchant/accounts/:id/oauth-init` builds the Google authorization URL from the *account's* credentials, stashes a CSRF `state` into `api_config.pending_oauth_state`, and returns `{ location, state }`. The UI saves `google_merchant_oauth_account_id` + `google_merchant_oauth_state` to `localStorage` and redirects.
4. Google redirects to `/app/settings/google-merchant/oauth-callback?code=...&state=...`. The admin callback page validates the state against localStorage, then POSTs `{ code, state }` to `/admin/google-merchant/accounts/:id/oauth-callback`.
5. The backend re-loads the account, verifies `state` against the stored `pending_oauth_state`, exchanges the code, encrypts the refresh token, stores the access token + expiry, fetches `account_email`, clears `pending_oauth_state`, and flips `is_active: true`.

### Required Google Cloud Console setup

- OAuth 2.0 Client — type **Web application**.
- Authorized redirect URI must match the account's `redirect_uri` exactly, e.g. `https://<your-admin-host>/app/settings/google-merchant/oauth-callback`.
- Enable the **Merchant API** (and Content API for legacy support) on the project.

---

## Admin API routes

All under `/admin/google-merchant/`:

| Method | Path | Purpose |
|---|---|---|
| `GET`    | `/accounts` | list accounts (sanitised — no secrets) |
| `POST`   | `/accounts` | create account; encrypts `client_secret` |
| `GET`    | `/accounts/:id` | detail |
| `POST`   | `/accounts/:id` | update; re-encrypts `client_secret` if provided |
| `DELETE` | `/accounts/:id` | delete |
| `GET`    | `/accounts/:id/oauth-init` | start OAuth, returns `{ location, state }` |
| `POST`   | `/accounts/:id/oauth-callback` | exchange code, store tokens, verify state |
| `POST`   | `/accounts/:id/sync-product` | sync a single product (`{ product_id, content_language?, feed_label?, currency_code?, landing_url_base? }`) |
| `DELETE` | `/accounts/:id/products/:product_id` | unsync one product — deletes from Merchant API and dismisses the local link |
| `GET`    | `/product-sync-status?product_id=...` | per-account sync state for a product |

`sanitizeAccount()` (`accounts/helpers.ts`) strips `client_secret`, `refresh_token`, and `access_token` from every response and adds booleans `connected`, `has_client_secret`, `has_refresh_token` for the UI.

---

## Workflows

**Location:** `src/workflows/google_merchant/`

### `syncProductToGoogleWorkflow` (single-product sync)

Step: `syncProductToGoogleStep`
1. Load the account (404 if missing, 403 if no refresh token).
2. Decrypt `client_secret` + `refresh_token`. Instantiate a per-account `GoogleMerchantProvider`.
3. If the stored access token is missing or within 60s of expiring, refresh it and persist the new access token + expiry on the account row.
4. Fetch the product via `query.graph` (title, subtitle, description, handle, metadata, variants + prices, images).
5. Validate (title / handle / first-variant price / at least one image). On validation failure, upsert the link as `failed` with the error.
6. Map to Merchant API payload — `mapProductToGoogleMerchant()` builds `offerId` from handle (or ID), `link` from `landing_url_base + /products/handle`, picks a price in the requested currency (fallback to first price), converts `amount` to `amountMicros` (multiply by 10⁴), uses up to 10 additional images, derives availability from `inventory_quantity`.
7. Call `provider.insertProduct`. On success upsert the link as `synced` with `google_product_id` / `google_product_name` / `last_synced_at`; on failure upsert as `failed` and rethrow.

Link updates use the `remoteLink.dismiss → remoteLink.create` pattern (Medusa links don't expose a direct update for extra columns).

### `unsyncProductFromGoogleWorkflow`

Step: `unsyncProductFromGoogleStep`
1. Load the account.
2. Look up the existing link to pull `google_product_name`.
3. If a Google product exists and the account is authenticated: refresh token → `provider.deleteProduct`.
4. Dismiss the local link. If the Google delete fails, log a warning and still dismiss (never leave the UI stuck on stale local state).

---

## Admin UI

All paths relative to `src/admin/`:

### Accounts management (`routes/settings/google-merchant/`)
- `page.tsx` — list view with per-row status badge (**Connected** / **Not connected**).
- `create/page.tsx` — form for account creation with OAuth credentials + feed defaults.
- `[id]/page.tsx` — detail with Connect/Reconnect/Delete actions.
- `oauth-callback/page.tsx` — handles Google's redirect: verifies state, POSTs to the callback endpoint, toasts, navigates back to detail.

### Entry point (`routes/settings/external-platforms/page.tsx`)
A transparent **Google Merchant** button in the External Platforms list header routes users to `/settings/google-merchant`. The sidebar route also exposes it at the top level (`defineRouteConfig` → `Google Merchant`).

### Product-detail widget (`widgets/product-google-merchant.tsx`)
`defineWidgetConfig({ zone: "product.details.side.after" })`.

Reads from `useGoogleMerchantAccounts` + `useProductGoogleMerchantStatus`.

For each connected account:
- Status badge (`Synced` / `Pending` / `Failed` / `Not synced`) with colour coding.
- Last-synced timestamp, Google offer ID, and truncated error tooltip (only when `failed`).
- **Sync** / **Re-sync** button (label flips based on whether a `google_product_id` exists).
- **Remove** button — only shown when the product has been synced; calls the unsync endpoint.

### Admin hooks (`hooks/api/google-merchant.ts`)
React Query wrappers for every route, plus:
- `useInitiateGoogleMerchantOAuth` — handles the `GET /oauth-init` call and the localStorage stash + redirect.
- `useSyncProductToGoogleMerchant` / `useUnsyncProductFromGoogleMerchant` — invalidate `productStatus` query on success.

---

## Security

- **AES-256-GCM** encryption (`encryption` module) for `client_secret` and `refresh_token`. Each value uses a unique IV and auth tag, so re-encrypting the same plaintext produces different ciphertexts.
- All responses run through `sanitizeAccount()` — secrets never leave the backend.
- OAuth state stored in `api_config.pending_oauth_state` AND in `localStorage`; the callback endpoint verifies both sides.
- Google's refresh token is requested with `prompt=consent` + `access_type=offline` to guarantee we get one on first consent.

---

## What's implemented vs. deferred

**Implemented**
- Per-account OAuth with user-configured `client_id` / `client_secret`
- Single-product sync with automatic token refresh
- Unsync (delete from Merchant Center + dismiss link)
- Per-account sync status exposed to the widget (`sync_status`, `google_product_id`, `last_synced_at`, `sync_error`)
- Multi-account per store
- Encrypted secret storage
- Admin UI for account management, OAuth initiation/callback, and product-detail actions

**Deferred (future rounds)**
- Multi-product batch sync workflow (the Etsy two-phase pattern: create job → pending links → confirmation → background sync). The `google_merchant_sync_job` model is already migrated.
- Auto-sync subscriber on product create/update
- Periodic status pulls from Merchant API (current flow doesn't poll `productStatuses`)
- Feed-level config UI (multiple feed labels / languages per account)
- Test coverage (no integration tests yet for this module)

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
│   │   └── unsync-product-from-google.ts
│   └── steps/
│       ├── map-product-to-google.ts
│       ├── sync-product-to-google.ts
│       └── unsync-product-from-google.ts
├── api/admin/google-merchant/
│   ├── accounts/route.ts
│   ├── accounts/helpers.ts
│   ├── accounts/[id]/route.ts
│   ├── accounts/[id]/oauth-init/route.ts
│   ├── accounts/[id]/oauth-callback/route.ts
│   ├── accounts/[id]/sync-product/route.ts
│   ├── accounts/[id]/products/[product_id]/route.ts
│   └── product-sync-status/route.ts
└── admin/
    ├── hooks/api/google-merchant.ts
    ├── widgets/product-google-merchant.tsx
    └── routes/settings/google-merchant/
        ├── page.tsx
        ├── create/page.tsx
        ├── [id]/page.tsx
        └── oauth-callback/page.tsx
```
