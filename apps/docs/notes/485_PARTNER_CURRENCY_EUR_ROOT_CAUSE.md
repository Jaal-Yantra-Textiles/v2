# #485 — Partner UI shows EUR instead of store-default currency — Root Cause + Proposed Fix

**Status:** ROOT-CAUSED → **durable fix PARTIALLY SHIPPED** (daemon chunk 2/6).
Decision approved (Option B, durable). Shipped: `resolveStoreCurrency` helper +
`backfill-partner-order-currency` maintenance job (#457 pattern) + how-to doc
(`OPS_DATA_PLUMBING_HOWTO.md`). **Still TODO:** rewire the 8 `stores[0]` call
sites to `resolveStoreCurrency` (forward-fix; needs per-workflow integration
tests) + the Settings-route Ops console UI (Playwright-gated).
**Date:** 2026-06-18 (daemon chunk 1/6 analysis; chunk 2/6 partial build)
**Surfaces:** partner-ui inventory-orders money cells; design references / design→order money.

---

## TL;DR

The deployment is now **multi-store** (one platform store + one store per partner). Every
currency-resolution helper still assumes a **single** store and grabs `stores[0]`:

```ts
const { data: stores } = await query.graph({ entity: "store", fields: [...] })
const store = stores?.[0]                                   // ← arbitrary store
const currencyCode = store?.supported_currencies
  ?.find(c => c.is_default)?.currency_code ?? "inr"
```

On prod, `stores[0]` is the platform **"JYT Medu Store"**, whose default currency is **EUR**.
Every *partner* store defaults to **INR** (verified live, 2026-06-18 — see table below). So
partner work-orders and design→order amounts get stamped **EUR** (the platform store) instead
of the partner's own **INR**.

**This is a backend bug, NOT a partner-ui default.** The partner-ui money cells default to
`USD`/`INR` when `currency_code` is missing (`cell-renderers.tsx`, `table-display-utils.tsx`) —
they never default to EUR. The "EUR" is **real persisted data**: the unified order's
`currency_code` column is literally `"eur"`.

## Live evidence (prod `GET /admin/stores`, 2026-06-18)

| Store | default currency |
|---|---|
| **JYT Medu Store** (platform) | **eur** ✅ is_default |
| Parmar mukesh… / Saransh Sharma / Sharhlo / Perennial / Unique Pashmina / Aurum kashmir / Shramdaan / GOF / Ielocraft (partner stores) | **inr** |
| Woven Futures | aud |

`stores[0]` resolves to JYT Medu Store → EUR.

---

## Call sites with the fragile `stores[0]` pattern

Systemic — all assume a single store:

| File | What it stamps with EUR |
|---|---|
| `src/workflows/inventory_orders/dual-write-unified-order.ts:235-260` | unified order `currency_code` for **inventory orders** (the #485 inventory-orders surface) |
| `src/workflows/designs/create-draft-order-from-designs.ts:161-168` & `:258` | design→draft-order currency + FX base currency (the #485 **design references** surface) |
| `src/workflows/production-runs/dual-write-unified-run-order.ts:90` | unified run-order `currency_code` |
| `src/workflows/email/steps/resolve-partner-from-order.ts:78` | (email) |
| `src/api/store/custom/designs/[id]/estimate/route.ts:70`, `…/checkout/route.ts:90` | storefront design estimate/checkout |
| `src/modules/payu-payment/service.ts:85`, `src/api/partners/stores/[id]/products/quick/route.ts:32`, `src/scripts/seed-design-cart-links.ts:37` | misc |

## Surface-by-surface

### Inventory orders (partner-ui)
- partner-ui `order-detail.tsx` renders money with `order.currency_code` (the unified order's column);
  list cells use `row.currency_code || "USD"` (`cell-renderers.tsx:259/266`, `table-display-utils.tsx:124`).
- `order.currency_code` is stamped at **creation** by `dualWriteUnifiedOrderStep` from `stores[0]` = EUR.
- ⚠ **At inventory-order creation there is NO partner assigned** (partner is linked later via
  `send-to-partner.ts`; `POST /partners/inventory-orders` does not exist — inventory orders are
  created admin-side / by assignment). So the partner's store currency is *not knowable at creation*.

### Design references (partner-ui)
- `create-draft-order-from-designs.ts` resolves the base currency from `stores[0]` = EUR for both the
  draft-order currency and the FX-conversion base.
- Note: `design.cost_currency` (model col, nullable) is **never set** by `estimate-design-cost.ts`, so
  design *cost* cells render no currency (empty), not EUR. The EUR on design references comes from the
  **design→order** path, not `cost_currency`.

## Why partner-ui is not at fault
Grep of `apps/partner-ui/src` for EUR defaults: the only `|| "..."` currency fallbacks are `USD` or
`INR` (and a locale map for EU countries in store-creation). No render path defaults to EUR. EUR is
always real data flowing from the backend.

---

## Proposed fixes (needs a product decision FIRST)

**Decision needed:** what currency should a partner work-order / design reference be **denominated
and displayed** in — the **partner's own store currency (INR)**, or the platform base currency? And
the platform store default itself: should "JYT Medu Store" stay EUR, or become INR?

### Option A — Display in the partner's store currency (most likely intended)
The partner-ui already knows the partner's store (`useStore()` → `supported_currencies[is_default]` =
INR). Make the partner-ui money cells render the **partner store default currency** rather than the
persisted `order.currency_code`. Pros: pure display fix, no backfill, no data migration. Cons:
- partner-ui change → **Playwright-gated** (no headless verify in daemon).
- Amounts vs label semantics: line prices come from raw-material `unit_cost` / design estimates which
  carry their own `cost_currency`; relabeling without converting could misrepresent magnitude **iff**
  any amount was genuinely computed in EUR. In practice raw-material costs are entered in INR, so the
  amounts are already INR-magnitude and the EUR label is simply wrong → relabel is safe. **Verify on
  a sample order before shipping.**

### Option B — Stamp the correct currency at the backend (durable, but harder)
Resolve the **partner's store** currency at stamping time and persist it on `currency_code`.
- Inventory orders: cannot do it at creation (no partner). Would have to **re-stamp at
  `send-to-partner`** when the partner is first linked — changes an order's currency mid-life.
- Design→order: the partner *is* known on partner routes → thread the partner's store currency into
  `create-draft-order-from-designs` (it already accepts `input.currency_code`/`target_currency`).
- Requires a **backfill** (an #457-style guarded dry-run→apply maintenance job) to fix already-stamped
  EUR orders.

### Option C — Change the platform store default EUR→INR (data only, quickest mitigation)
`PUT /admin/store` set JYT Medu Store default → inr. Fixes all **new** stamps immediately; existing
EUR orders still need a backfill. Pure ops/data change, no code. **But** it conflates "platform base"
with "partner currency" — wrong if partners ever use non-INR (Woven Futures = AUD).

### Recommended path
1. **Confirm the decision** (likely: partner work-orders/design refs display in the partner's store
   currency; platform base store currency is a separate concern).
2. **Quick win:** Option A relabel in partner-ui, *after* visually confirming on a sample order that
   amounts are already INR-magnitude (Playwright + a real partner login).
3. **Durable:** add a `resolveStoreCurrency(container, { partnerId? })` helper that selects the
   partner's linked store (`partner.stores[is_default]`) when a partner is in context and the platform
   base store otherwise — replace all `stores[0]` call sites. Add an #457-style backfill job for
   existing `currency_code = 'eur'` unified orders that belong to INR partners.

## Verification
- Backend: unit-test the new `resolveStoreCurrency` helper (pure, `TEST_TYPE=unit`).
- partner-ui: Playwright against live `yarn dev`, partner login, open an inventory order + a design with
  references, assert currency label = partner store default; screenshot.
- Prod: `GET /admin/stores` already confirms partner stores = INR; spot-check a unified order's
  `currency_code` via admin API.

## Watch-outs
- Multi-store is the *new normal* (multi-tenant SaaS direction) — any `stores[0]` is now a latent bug.
- Existing inventory/run orders are already persisted with `currency_code='eur'`; a display-only fix
  (Option A) sidesteps the backfill; a backend re-stamp (Option B) requires it.
- Don't change the `seed.ts` EUR default expecting it to fix prod — seed only affects fresh DBs.
