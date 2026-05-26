# FX Auto-Conversion — Implementation Guide

> Status: **SHIPPED** as of 2026-05-26. Companion to `FX_AUTO_CONVERSION.md` (the original design doc; some pieces evolved during build — this doc reflects what actually shipped).
> Owner: Saransh
> Last verified end-to-end: 2026-05-26 via `/tmp/jyt-ui-smoke-g4a/test-fx-e2e.js`

## What it does (one paragraph)

Partner sets ONE price per variant in their native currency (e.g. INR 1000). On save, the backend fans the price out to every other currency in the store's `supported_currencies` using FX rates from `open.er-api.com`. Each derived price gets a 1:1 link to an `fx_price_meta` row that marks it as auto-converted and stores the base currency, base amount, and FX rate used. A daily cron refreshes rates at 02:00 UTC and rewrites every auto-converted price at 02:05 UTC. Partners can edit any auto cell to override it (the override deletes the marker so daily re-rate leaves it alone) or toggle the whole feature off per store. When the storefront has no calculated price for the visitor's region, the product page shows a friendly contact form instead of a skeleton.

## Module + data model

### `apps/backend/src/modules/fx_rates/`

```
fx_rate {
  id                ULID
  base_currency     text
  quote_currency    text
  rate              bigNumber
  fetched_at        dateTime
  source            text         // e.g. "open.er-api.com"
  metadata          json?
  UNIQUE (base_currency, quote_currency) WHERE deleted_at IS NULL
}

fx_price_meta {
  id                ULID
  base_currency     text
  base_amount       bigNumber
  fx_rate           bigNumber
  source_price_id   text?        // partner's manual base price
  // standard Medusa: created_at, updated_at, deleted_at
}
```

### Medusa link — `apps/backend/src/links/price-fx-meta.ts`

```typescript
defineLink(
  PricingModule.linkable.price,
  { linkable: FxRatesModule.linkable.fxPriceMeta, field: "fx_price_meta" }
)
```

1:1. Row presence on `fx_price_meta` IS the "this price is auto-converted" discriminator — there's no separate boolean column. Strip-on-edit deletes the row + link; re-rate's `listFxPriceMetas()` simply doesn't see it any more.

**Why not `price.metadata`?** Medusa's `Price` model has no `metadata` column (verified against the dist `.d.ts` + live `\d price` schema). MikroORM silently drops unknown fields on writes. See `MEDUSA_PRICING_QUIRKS.md`.

## The flow

```
Partner saves variant price (e.g. INR 1000) in partner-UI
  → POST /partners/stores/:id/products/:pid/variants/batch
  → batchProductVariantsWorkflow (Medusa core) creates/updates the price
  → Same route handler then loops over each touched price and runs:
      fanoutPricesWorkflow({ source_price_id, store_id })
        1. Load source price + its fx_price_meta link
        2. Skip if source has fx_price_meta (recursion guard)
        3. Skip if store.metadata.fx_auto_convert === false
        4. Read store.supported_currencies
        5. For each non-source currency not already priced:
             rate = fxService.getRate(source.ccy, target)
             new_amount = round(source.amount * rate * 100) / 100
        6. pricingService.addPrices({ priceSetId, prices: [...] })
        7. For each new price: create FxPriceMeta + link
        8. Return summary { created_count, skipped_currencies, errors }
```

**Why not a subscriber?** Medusa's pricing module doesn't emit per-price events (no `pricing.price.created`). G3 originally tried this and silently never fired. Direct invocation from the partner route is the deterministic path. See `MEDUSA_PRICING_QUIRKS.md`.

## Daily flows (Visual Flow + cron)

Both seeded as draft visual flows; activate from admin after first run.

| Time (UTC) | Flow file (script) | Workflow |
|---|---|---|
| 02:00 | `seed-fx-refresh-flow.ts` | `refresh-fx-rates` — fetch open.er-api.com, upsert `fx_rate` |
| 02:05 | `seed-fx-rerate-flow.ts` | `rerate-auto-converted-prices` — walk every `fx_price_meta`, recompute amount with fresh rate, write back via `updatePriceSets` |

5-minute gap so the rate cache is fresh before re-rate runs. Keeping them as two flows means an operator can pause re-rate without losing the rate refresh, and failures surface in `visual_flow_execution` log independently.

## Partner UI

### Pricing grid badge

- `apps/partner-ui/src/components/common/fx-auto-badge/fx-auto-badge.tsx` — small "FX" chip + Tooltip showing "Auto-converted from {base_amount} {BASE_CCY} at {rate} {QUOTE}/{BASE}. Edit to override."
- `apps/partner-ui/src/components/data-grid/helpers/create-data-grid-price-columns.tsx` — generic `getCellDecorator` slot (not FX-specific) lets any caller overlay arbitrary ReactNodes on price cells. Uses `z-[3]` to sit above the cell-edit overlay.
- `apps/partner-ui/src/routes/products/product-prices/pricing-edit.tsx` — builds `variantIdx → currency|region_id → FxPriceMetadata` from loaded `price.fx_price_meta`. Passes to the form, which wires it through to the decorator.

### Backend response shape

`/partners/stores/:id/products/:pid` GET pulls `variants.price_set.prices.fx_price_meta.*` via the link. Medusa's `remapVariantResponse` flattens `price_set.prices` → `variant.prices` but drops link rows on the way; the partner route captures fx_price_meta by `price.id` pre-remap and re-attaches post-remap.

### Strip-on-edit

When the partner edits a previously auto-converted cell to a different value:
- `pricing-edit.tsx` snapshots `(id, amount, hasFxMeta)` per cell at load
- On submit, collects price ids where `hasFxMeta && amount changed`
- After the variants/batch save succeeds, fires `DELETE /partners/stores/:id/prices/:priceId/fx-meta` in parallel via `Promise.allSettled` (fire-and-forget — a failed strip never blocks the form's success path; the next save would retry).
- Backend endpoint validates partner store scoping (price → product → sales_channel → store via `stores WHERE default_sales_channel_id IN (channelIds)` since sales_channel ↔ store is NOT a link), dismisses the link + deletes the meta row.

### Store-level toggle

- `apps/partner-ui/src/routes/store/store-detail/components/store-fx-section/store-fx-section.tsx` — "Auto-convert prices across regions" Switch, default ON, persists to `store.metadata.fx_auto_convert` via existing `useUpdateStore`.
- Backend check: workflow short-circuits when `store.metadata.fx_auto_convert === false`.

## Storefront fallback

- `apps/storefront-starter/src/modules/products/components/region-not-served-fallback/index.tsx` — heading + 3-field form (name, email, optional message), `data-testid="region-not-served-fallback"`.
- `ProductActions` detects `hasAnyPrice` (any variant has `calculated_price.calculated_amount != null`). When false, swaps the price + add-to-cart UI for the fallback. Gallery, title, description stay visible above.
- Backend endpoint: `POST /store/contact-region-request` resolves partner store from publishable key, creates a feed-channel Medusa notification → shows up in partner's admin Activity feed.

## File map

### Backend
```
apps/backend/src/
  modules/fx_rates/
    index.ts                                # Module export
    service.ts                              # MedusaService({ FxRate, FxPriceMeta })
    models/
      fx-rate.ts
      fx-price-meta.ts
    providers/
      types.ts                              # FxProvider interface
      open-er-api-provider.ts               # Default impl
    migrations/
      Migration20260525112809.ts            # fx_rate table
      Migration20260526052102.ts            # fx_price_meta table

  links/
    price-fx-meta.ts                        # 1:1 link

  workflows/fx/
    refresh-fx-rates.ts                     # thin wrapper around service
    fanout-prices.ts                        # fanout-prices-from-source
    rerate-auto-converted-prices.ts         # daily re-rate

  subscribers/                              # No FX subscriber — see MEDUSA_PRICING_QUIRKS.md

  api/
    partners/stores/[id]/
      products/[productId]/
        route.ts                            # GET: attaches fx_price_meta to flattened prices
        variants/batch/route.ts             # POST: invokes fanoutPricesWorkflow per touched price
      prices/[priceId]/fx-meta/
        route.ts                            # DELETE: strip-on-edit endpoint
    store/contact-region-request/
      route.ts                              # Storefront fallback POST

  scripts/
    seed-initial-fx-rates.ts                # One-shot to populate fx_rate
    seed-fx-refresh-flow.ts                 # Visual flow for daily refresh
    seed-fx-rerate-flow.ts                  # Visual flow for daily re-rate
```

### Partner UI
```
apps/partner-ui/src/
  components/common/fx-auto-badge/
    fx-auto-badge.tsx                       # Badge + tooltip
  components/data-grid/helpers/
    create-data-grid-price-columns.tsx      # getCellDecorator slot
  routes/products/
    common/variant-pricing-form.tsx         # Wires decorator
    product-prices/pricing-edit.tsx         # Builds fxAutoMetadata + strip-on-edit
  routes/store/store-detail/components/
    store-fx-section/                       # Settings toggle
```

### Storefront
```
apps/storefront-starter/src/modules/products/components/
  region-not-served-fallback/index.tsx
  product-actions/index.tsx                 # Conditional fallback render
```

## Operational runbook

### One-time prod setup (already done as of 2026-05-26)

```bash
# 1. Populate fx_rate cache with current rates (166 currencies via open.er-api.com)
FOLLOW=0 ./deploy/aws/scripts/run-backfill.sh seed-initial-fx-rates

# 2. Create the daily refresh visual flow (draft, then activate in admin)
FOLLOW=0 ./deploy/aws/scripts/run-backfill.sh seed-fx-refresh-flow

# 3. Create the daily re-rate visual flow (draft, then activate in admin)
FOLLOW=0 ./deploy/aws/scripts/run-backfill.sh seed-fx-rerate-flow
```

Then open `/app/visual-flows` in admin, flip both flows from `draft` → `active`.

### Verify fanout end-to-end

```bash
# Local
psql $DATABASE_URL -c "SELECT COUNT(*) FROM fx_rate;"            # > 0
psql $DATABASE_URL -c "SELECT COUNT(*) FROM fx_price_meta;"      # populates as partners save prices
psql $DATABASE_URL -c "SELECT COUNT(*) FROM pricing_price_fx_rates_fx_price_meta;"  # link rows

# Or run the e2e (requires backend on :9000 + partner-ui on :5173 + seeded fx_rate)
PARTNER_UI_URL=http://localhost:5173 BACKEND_URL=http://localhost:9000 \
  PARTNER_EMAIL=testing@testing.com PARTNER_PASSWORD=1234 \
  node ~/Developer/jyt/.claude/skills/playwright-skill/run.js /tmp/jyt-ui-smoke-g4a/test-fx-e2e.js
```

### Adding a new FX provider

1. Implement `FxProvider` interface in `apps/backend/src/modules/fx_rates/providers/`
2. Inject via `fxService.setProvider(yourProvider)` — typically in app startup or a config script
3. Verify `getRate()` works for your provider's base currency (the workflow auto-handles cross-rate math)

### What re-rate touches / doesn't

| Row type | Re-rated daily? |
|---|---|
| Partner's manual base price (e.g. INR) | No — no fx_price_meta link |
| Auto-converted derived price (e.g. USD/EUR) | Yes — listFxPriceMetas walks it |
| Partner-edited override of a previously auto price | No — strip-on-edit deleted the marker |
| Orphan fx_price_meta (price was deleted but meta wasn't cleaned) | Skipped (counted in `output.skipped`); future compaction can prune |

## PR history

| PR | Scope |
|---|---|
| #263 G1 | `fx_rates` module + open.er-api.com provider + seed-initial-fx-rates script |
| #264 G2 | `refresh-fx-rates` workflow + daily visual flow |
| #265 G3 | `fanout-prices` workflow + (since-removed) subscriber attempt |
| #266 | prod config fx_rates registration fix |
| #267 | medusa-config dev/prod parity check script + CI |
| #268 G4a | Partner-UI FX badge |
| #269 | `fx_price_meta` link table — replaces the broken `price.metadata` design |
| #270 G4b | Strip-on-edit endpoint + store FX toggle UI |
| #271 | Fix: real fanout trigger (direct invocation), badge rendering, DELETE auth, store derivation |
| #272 G5 | `rerate-auto-converted-prices` workflow + daily visual flow |
| #273 H | Storefront `RegionNotServedFallback` + `/store/contact-region-request` |

## Out of scope (intentionally deferred)

- **Per-product base-currency override** — every variant uses the partner's store's default currency as base. No partner has asked.
- **Hourly re-rate** — daily is fine at our currency mix (<0.5% intraday drift typical for INR/USD/EUR).
- **Paid FX provider** — swap-in via the `FxProvider` interface; defer until we have FX-sensitive partners.
- **Per-partner manual rate override** — "treat INR→EUR as 0.013 for my store only" — no demand yet.
- **Re-fanout on FX move > threshold** — replace auto-converted prices when rate moves > X% intraday. Daily re-rate is sufficient for v1.
- **Orphan `fx_price_meta` compaction** — re-rate skips them; harmless drift until we add a cleanup pass.
- **Email-to-partner forwarding for region requests** — feed-only in v1. Add via existing notification provider system once partners opt in.
