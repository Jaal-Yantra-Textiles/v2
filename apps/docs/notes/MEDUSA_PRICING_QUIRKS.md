# Medusa Pricing Module — Quirks to Know

> Two non-obvious constraints in `@medusajs/pricing` that look like "I just need to..." but break silently. Both surfaced building FX auto-conversion in May 2026 (see `FX_IMPLEMENTATION_GUIDE.md` for the patterns we landed on).
> Verified against Medusa 2.15.x — re-verify if upgrading.

## 1. `Price` has no `metadata` column

Most Medusa entities have a `metadata` JSONB column for arbitrary key/value extension:

| Entity | Has `metadata`? |
|---|---|
| Region, Order, Product, Store, Customer, Cart, LineItem, etc. | ✅ Yes |
| **PriceList** | ✅ Yes |
| **Price** | ❌ No |

### How to verify

```bash
# 1. Inspect the dist .d.ts
cat node_modules/@medusajs/pricing/dist/models/price.d.ts | head -20

# 2. Confirm against the live DB schema
psql $DATABASE_URL -c "\d price"
# columns: id, title, price_set_id, currency_code, raw_amount, rules_count,
#   created_at, updated_at, deleted_at, price_list_id, amount,
#   min_quantity, max_quantity, raw_min_quantity, raw_max_quantity
```

### Failure mode

Pass `metadata: {...}` to `pricingService.addPrices` or `updatePriceSets`:

```typescript
await pricingService.addPrices({
  priceSetId,
  prices: [{
    amount: 12.00,
    currency_code: "usd",
    metadata: { is_auto_converted: true },  // ← silently dropped
  }],
})
```

MikroORM strips unknown fields before writing. **No error. No warning. Just gone.** Reads come back `undefined`.

### The pattern that works — link table

Create a JYT-side model in the relevant module, link it 1:1 to `PricingModule.linkable.price` via `defineLink`. **Row presence on the link IS the discriminator**; the model's columns hold per-price data.

```typescript
// apps/backend/src/modules/fx_rates/models/fx-price-meta.ts
export const FxPriceMeta = model.define("fx_price_meta", {
  id: model.id().primaryKey(),
  base_currency: model.text(),
  base_amount: model.bigNumber(),
  fx_rate: model.bigNumber(),
  source_price_id: model.text().nullable(),
})

// apps/backend/src/links/price-fx-meta.ts
export default defineLink(
  PricingModule.linkable.price,
  { linkable: FxRatesModule.linkable.fxPriceMeta, field: "fx_price_meta" }
)
```

Then query.graph naturally joins it:

```typescript
await query.graph({
  entity: "price",
  fields: ["id", "amount", "currency_code", "fx_price_meta.*"],
})
```

### Returning linked data from a partner/admin response

Medusa core's `remapVariantResponse` (in `@medusajs/medusa/dist/api/admin/products/helpers.js`) explicitly **strips** link rows when flattening `variant.price_set.prices` → `variant.prices`. Only an allow-list of native price columns survives.

Pattern: capture by `price.id` pre-remap, re-attach post-remap.

```typescript
// In your partner/admin GET route
const fxMetaByPriceId = new Map<string, any>()
for (const variant of product.variants || []) {
  for (const price of variant.price_set?.prices || []) {
    if (price.fx_price_meta) {
      fxMetaByPriceId.set(price.id, price.fx_price_meta)
    }
  }
}
const remapped = remapProductResponse(product)
for (const variant of remapped.variants || []) {
  for (const price of variant.prices || []) {
    const meta = fxMetaByPriceId.get(price.id)
    if (meta) price.fx_price_meta = meta
  }
}
```

`PriceList` has `metadata` — but it's shared across **all** prices in the list, so it's not a substitute for per-price data. Useful only when the metadata legitimately is a list-level attribute (e.g. "this whole list is a Black Friday promo").

---

## 2. Pricing module doesn't emit per-price events

There is **no** `pricing.price.created`, `pricing.price.updated`, or `pricing.price.deleted` event. The pricing module's `addPrices` / `updatePriceSets` methods carry the `@EmitEvents()` decorator, but no event names are actually emitted from them.

### How to verify

```bash
# Should return zero hits
grep -rn "price.created" node_modules/@medusajs/pricing
grep -rn "price.updated" node_modules/@medusajs/pricing
```

### Failure mode

```typescript
// apps/backend/src/subscribers/your-subscriber.ts
export const config: SubscriberConfig = {
  event: "pricing.price.created",  // ← never fires
}
```

Subscriber registers cleanly. Backend boots without errors. Test runs that invoke the workflow directly pass. Real partner save in prod silently does nothing. Easy to miss.

### What events DO exist

Per the official Medusa events reference:

- `product.created`, `product.updated`, `product.deleted` — emitted by `updateProductsWorkflow`, `batchProductsWorkflow`, `importProductsWorkflow`. Payload: `{ id }` (product id).
- Similar `product_variant.*`, `product_option.*`, etc.
- **No pricing-module-specific events.**

So `product.updated` fires when a partner's variants/batch update touches a product — including price changes. Payload is just the product id; subscriber would load the product and diff against a snapshot.

### The pattern that works — direct invocation

For paths we control (partner routes, admin routes, scripts), invoke the follow-up workflow inline from the route handler. Deterministic, no event-layer flakiness.

```typescript
// apps/backend/src/api/partners/.../variants/batch/route.ts
const { result } = await batchProductVariantsWorkflow(req.scope).run({ input })
// ... fetch the touched variants ...
for (const variant of [...created, ...updated]) {
  for (const price of variant.prices ?? []) {
    await fanoutPricesWorkflow(req.scope).run({
      input: { source_price_id: price.id, store_id: store.id },
    })
  }
}
```

Wrap the inner calls in `try/catch` (or `Promise.allSettled`) so a failure in one follow-up workflow doesn't tank the save.

### The pattern for paths we don't control

If a price-changing flow exists outside JYT's routes (e.g. a Medusa core admin endpoint we haven't shadowed), subscribe to `product.updated` and diff prices yourself. Heavier and slower than direct invocation, but it's the only event-driven option.

---

## 3. Bonus: `store.default_sales_channel_id` is a column, not a link

Tangential but related — surfaced during the same FX work.

`sales_channel ↔ store` is **not** a Medusa link. `store.default_sales_channel_id` is a plain column. So you can't ask `query.graph("sales_channel", fields: [..., "store_id"])` and expect a value — you have to query stores separately.

```typescript
// Wrong — sales_channels[].store_id is always undefined
const { data } = await query.graph({
  entity: "product_variant_price_set",
  fields: ["variant.product.sales_channels.store_id"],
})

// Right — two-step
const { data: variantLinks } = await query.graph({
  entity: "product_variant_price_set",
  fields: ["variant.product.sales_channels.id"],
})
const channelIds = variantLinks.flatMap(vl => vl.variant.product.sales_channels.map(sc => sc.id))
const { data: stores } = await query.graph({
  entity: "stores",
  filters: { default_sales_channel_id: channelIds },
  fields: ["id"],
})
```

---

## Lesson — always write at least one true e2e

Both pricing-module quirks above were masked through 6 PRs by tests that stubbed metadata client-side (Playwright `page.route()`) or invoked workflows directly (bypassed the subscriber). The bugs only surfaced when a Playwright e2e drove the real chain: partner save → backend route → fanout workflow → DB → UI fetch → UI render.

**Rule of thumb:** for any feature that depends on Medusa events, link traversal, or per-entity metadata, write at least one test that drives the actual chain end-to-end with no stubs. Slow tests catch real bugs.
