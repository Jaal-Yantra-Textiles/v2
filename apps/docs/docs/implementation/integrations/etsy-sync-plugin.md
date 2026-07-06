---
title: "Etsy Sync — Workspace Plugin"
sidebar_label: "Etsy Sync (Plugin)"
sidebar_position: 0
---

# Etsy Sync — Workspace Plugin

_Last updated: 2026-07-06_

:::note Which Etsy integration is this?
This documents **`@jytextiles/medusa-plugin-etsy-sync`** — the current,
self-contained workspace plugin at `packages/medusa-plugin-etsy-sync`. It is
**not** the legacy in-backend `src/modules/etsysync` + `external_stores` module
described in _Etsy Sync_ / _Etsy Sync Complete_. New work happens in the plugin.
:::

Syncs Medusa products → a personal Etsy shop via the **Etsy Open API v3** using
**OAuth2 Authorization Code + PKCE**.

---

## Architecture

```
packages/medusa-plugin-etsy-sync/src/
  lib/
    etsy-client.ts        ← Etsy Open API v3 HTTP client (OAuth, listings, images, shop config)
    types.ts              ← shared types
  modules/etsy-sync/
    models/               ← account, settings, sync-record, sync-batch, webhook-event, order
    service.ts            ← EtsySyncService (MedusaService) — token lifecycle, settings, records
  workflows/
    sync-product-to-etsy.ts    ← single-product sync (resolve → prepare → sync listing → persist)
    sync-products-to-etsy.ts   ← bulk sync (long-running, background, rate-limited)
    ingest-etsy-order.ts       ← Etsy receipt → Medusa order (captured)
    refresh-etsy-token.ts
  subscribers/            ← product-status re-sync + Etsy order ingestion
  api/admin/etsy/          ← admin HTTP routes (see Reference below)
  api/webhooks/etsy/       ← inbound Etsy webhook receiver
  admin/                   ← settings page, sync-detail page, product widget
  jobs/
    refresh-etsy-token.ts    ← scheduled proactive token refresh
    reconcile-etsy-listings.ts ← 3-hourly listing lifecycle reconcile
```

Registered in `apps/backend/medusa-config.ts` as
`@jytextiles/medusa-plugin-etsy-sync`. Credentials come from env
(`ETSY_KEYSTRING`, `ETSY_SHARED_SECRET`, `ETSY_REDIRECT_URI`, `ETSY_SCOPE`,
`ETSY_WEBHOOK_SECRET`) —
the module reads `process.env.ETSY_*` first because a plugin-nested module does
**not** receive the plugin `options` object (Medusa passes the Awilix container
proxy as the 2nd constructor arg).

---

## OAuth (PKCE)

1. `POST /admin/etsy/auth/authorize` → generates a PKCE verifier/challenge,
   persists `{ state, code_verifier }` on settings, returns the Etsy authorize URL.
2. User authorizes on Etsy → redirected to the **admin SPA** route
   `/app/settings/oauth/etsy/callback` (no `/admin` prefix). The Etsy developer
   console callback URL **must** match `ETSY_REDIRECT_URI` exactly.
3. Callback page calls `POST /admin/etsy/auth/callback` with `{ code, state }`
   (guarded with a `useRef` against React StrictMode double-fire) → exchanges
   the code, resolves the shop, stores the account.

Access tokens live ~1h; refresh tokens ~90d and **rotate** on every refresh.
`EtsySyncService.ensureFreshToken()` refreshes proactively when < 5 min remain,
and a scheduled job (`jobs/refresh-etsy-token.ts`) keeps it warm.

---

## Publish readiness

Etsy only lets a physical listing go **active** when it has, in addition to
≥1 image: a **shipping profile**, a **return policy**, a **processing profile**
(readiness state), and a **taxonomy** (category). These are configured once as
sync defaults under **Settings → Etsy → Sync settings**.

`GET /admin/etsy/status` returns a `readiness` object
(`{ connected, shipping_profile, return_policy, readiness_state, taxonomy,
ready_to_publish }`) that both the settings page checklist and the product
widget surface.

**Behaviour:** readiness gaps never block a sync. The workflow always creates
the listing (as a **draft** if it can't publish) and returns warnings
explaining what's missing. The product widget shows a "readiness incomplete —
will still sync as draft" notice before you sync.

---

## Pricing (important)

Etsy prices the listing in the **shop's own currency**. Medusa v2 stores the
money amount as a **whole decimal in each price's currency** — `120.00` means
`120.00 EUR`, **not** minor units. The sync therefore:

- picks the min price **whose `currency_code` matches the shop currency**
  (falling back to all prices only if none match), and
- passes the amount through **as-is** (no `/100`).

> Historical bug: an earlier version divided by 100, which turned a €120 product
> into a €1.20 Etsy draft. Fixed in `sync-product-to-etsy.ts`.

---

## Single-product sync

`POST /admin/etsy/sync/product/:id` runs `syncProductToEtsyWorkflow`:

1. **resolve config** — fresh token, shop id, shop currency, settings.
2. **prepare** — map the Medusa product → `CreateListingInput` (title, description,
   currency-correct price, quantity, tags, defaults), and resolve any existing
   listing id from the product↔account link.
3. **sync listing** — create draft (or update existing), upload each image, then
   PATCH `state=active` **iff** the product is published, readiness is met, and
   there's ≥1 image. Otherwise it stays a draft with warnings.
4. **persist** — write a sync record and upsert the product↔account link.

**Draft URLs:** a draft listing has no public `url` (Etsy only mints one when a
listing goes active). The workflow falls back to the Shop Manager edit URL —
`https://www.etsy.com/your/shops/me/tools/listings/{listing_id}` — so the admin
always has a working link ("Open draft in Etsy →").

### Product widget

`src/admin/widgets/etsy-product-widget.tsx` (zone `product.details.side.before`)
uses React Query to **fetch and persist** per-product state
(`GET /admin/etsy/status/product/:id`), so the sync status survives navigating
away and back. After a sync it invalidates that query, so a draft→active
transition is reflected live. It also shows global connection + readiness.

---

## Bulk sync — long-running background workflow

Personal Etsy apps are capped at **~5 requests/sec** (and 10k/day), and each
product fans out to several calls (create + N image uploads + publish). Bulk
sync therefore runs as a **long-running, background** workflow
(`sync-products-to-etsy.ts`), modeled on `send-blog-subscribers`:

- **`openBatchStep`** (inline) — creates an `etsy_sync_batch` row stamped with
  the workflow `transactionId` and returns its `batch_id` immediately.
- **`processBatchStep`** — marked `.config({ async: true, backgroundExecution: true })`
  so the HTTP request returns at once while processing continues in the engine.
  It syncs products sequentially with an **adaptive backoff** (600 ms base,
  halving on success, doubling up to 10 s when a `429` bubbles up past the
  client's own retry-after handling), and persists progress every 5 products.

```
POST /admin/etsy/sync/bulk        { product_ids: [...] }  → 202 { batch_id, status }
GET  /admin/etsy/sync/bulk/:id    → { batch, progress: { total, done, pct, finished } }
```

The client polls the batch endpoint for live progress.

---

## Keeping listing status fresh

The draft→active transition is driven **by us** (the sync workflow PATCHes
`state=active`), and Etsy has **no listing-status webhook**, so freshness is
handled internally:

- **`product.updated` subscriber** (`subscribers/etsy-product-status-sync.ts`) —
  when an **already-linked** product's Medusa status changes (compared against
  `product_status` stored on the link metadata) **and** `follow_product_status`
  is on, it re-runs the sync so the Etsy listing follows. Guarded hard because
  `product.updated` is high-frequency — it never fires for unlinked products or
  unchanged status, so it doesn't burn the quota. The sync doesn't mutate the
  product, so there's no loop.
- **Widget auto-refresh** — the product widget polls its per-product status
  every 10 s while a listing is `draft`/`pending`, so a publish shows up live.
- **Listing lifecycle reconcile job** (`jobs/reconcile-etsy-listings.ts`, every
  3 h) — Etsy sends no listing webhook, so we shadow it: re-read the current
  `state` of each tracked listing (`getListing`; a `404` = deleted), and on any
  change record the transition and emit **`etsy.listing.<state>`**
  (`etsy.listing.sold_out`, `etsy.listing.expired`, `etsy.listing.deleted`, …)
  for subscribers / visual flows. Paced under the qps cap and capped at 200
  listings/run.

## Webhooks (inbound orders)

Etsy Open API v3 **does** support outbound webhooks (Svix-delivered, GA), but
only for **order** events — there is no listing/inventory topic:

| Topic | When |
|-------|------|
| `order.paid` | order receives payment |
| `order.canceled` | seller initiates a cancelation |
| `order.shipped` | shipping info created |
| `order.delivered` | order marked delivered |

`POST /webhooks/etsy` receives them:

1. **Verifies the Svix HMAC-SHA256 signature** (`lib/webhook.ts`) over
   `webhook-id . webhook-timestamp . rawBody` using the base64-decoded
   `ETSY_WEBHOOK_SECRET`, plus a ±5 min timestamp replay guard. Raw body is
   available because `middlewares.ts` sets `preserveRawBody` for `/webhooks/etsy`.
2. **Records the delivery idempotently** in `etsy_webhook_event` (unique
   `webhook_id` — Etsy retries with exponential backoff).
3. **Best-effort** fetches the `resource_url` (authenticated) and re-emits a
   Medusa event **`etsy.<event_type>`** (`etsy.order.paid`, …) so subscribers or
   visual flows can act on it, then returns `200`.

**Setup:** register the endpoint URL in Etsy's Webhooks Portal ("Manage your
apps"), copy the signing secret into `ETSY_WEBHOOK_SECRET`.

### Order ingestion (Etsy order → Medusa order)

A subscriber on `etsy.order.paid` (`subscribers/etsy-order-ingest.ts`) creates a
**completed, payment-captured** Medusa order from the Etsy receipt:

- `mapReceiptToOrder` (pure, tested) → custom line items (title / qty /
  whole-currency `unit_price`, no variant binding), shipping address, currency,
  total.
- `ingestEtsyOrderWorkflow` resolves the region (by shop currency) + default
  sales channel, runs `createOrderWorkflow`, then
  `createOrderPaymentCollectionWorkflow` + `markPaymentCollectionAsPaid`
  (payment_status = captured). Order tagged `metadata.source = "etsy"`.
- **Customer:** Etsy doesn't expose the buyer email, so the guest customer uses
  a synthetic, non-deliverable `etsy+{receipt_id}@marketplace.invalid` (real
  `buyer_email` used if ever present). The buyer name goes on the shipping address.
- **Idempotent** on `receipt_id` via the `etsy_order` table — retries and the
  later shipped/delivered events for the same receipt never double-create.
- **Kill switch:** `ETSY_INGEST_ORDERS=false` disables order creation while still
  recording webhook deliveries.

> Not yet wired: reacting to `order.shipped` / `order.delivered` / `order.canceled`
> to update the created order's status, and inventory decrement. The `etsy.order.*`
> events are emitted, so these are subscriber add-ons.

## Error handling

- The client (`etsy-client.ts`) surfaces the **full Etsy error detail** — it
  reads `error_description` / `error` / `message` / `errors[]` / bare-string /
  JSON body, so a 400 is never the opaque `"Etsy API error 400"`.
- `EtsySyncService.toMedusaError()` maps `EtsyApiError`/`Error` → `MedusaError`
  with the right status (invalid_grant→INVALID_DATA, no-shop→NOT_FOUND,
  401/403→NOT_ALLOWED, 400/422→INVALID_DATA) so the HTTP layer returns a
  meaningful status instead of a generic 500.
- `429` is retried inside the client using `retry-after`; the bulk workflow
  widens its inter-product gap on top of that.

---

## Admin API reference

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/admin/etsy/auth/authorize` | Start OAuth (returns authorize URL) |
| POST | `/admin/etsy/auth/callback` | Complete OAuth (`{ code, state }`) |
| POST | `/admin/etsy/auth/disconnect` | Disconnect the shop |
| GET  | `/admin/etsy/status` | Connection + publish readiness |
| GET  | `/admin/etsy/status/product/:id` | Latest sync state for one product |
| GET/POST | `/admin/etsy/settings` | Read / save sync defaults |
| POST | `/admin/etsy/sync/product/:id` | Sync one product |
| POST | `/admin/etsy/sync/bulk` | Start a background bulk sync (→ `batch_id`) |
| GET  | `/admin/etsy/sync/bulk/:id` | Poll bulk-batch progress |
| GET/POST | `/admin/etsy/syncs`, `/admin/etsy/syncs/:id` | List / view / retry sync records |
| GET | `/admin/etsy/shipping-profiles` | Shop shipping profiles |
| GET | `/admin/etsy/return-policies` | Shop return policies |
| GET | `/admin/etsy/readiness-states` | Shop processing profiles |
| GET | `/admin/etsy/taxonomy` | Seller taxonomy nodes |
| POST | `/webhooks/etsy` | Inbound Etsy order webhooks (Svix-verified) |

---

## Local development

```bash
# rebuild the plugin after src edits (NOT hot-reloaded into .medusa/server)
cd packages/medusa-plugin-etsy-sync && pnpm build

# unit tests
npx jest --no-cache
```

> `pnpm install` mid-session corrupts jest's swc cache → run `jest --no-cache`.
