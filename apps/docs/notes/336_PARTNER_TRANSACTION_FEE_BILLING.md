# #336 — Per-order transaction fee billing per partner (build-ready design)

> Roadmap [#4] / issue **#336**. Analysis chunk 7/10 (2026-06-19). No code yet —
> this decomposes the feature into clean, independently-shippable `apps/backend`
> slices and surfaces the ONE product decision that blocks slice 0.
>
> **Why analysis, not build:** the queue's clean veins (data-plumbing ranked
> candidates #4/#6, #337 design mutations) are all decision-bearing; #336 is the
> highest-value remaining roadmap item ("precondition for admin-side billing,
> partner statements, single audit surface" — #403) and had no grounding doc.

## What the feature is

Charge each partner a **platform transaction fee** per order they fulfil, so JYT
can bill partners for orders flowing through their storefronts. Today there is
**no fee/commission/payout model anywhere** — only payment *reporting* of money
already moved (`payment_reports`, `payment_submissions`, `internal_payments`).

## Existing subsystem this builds on (verified paths, chunk 7)

- **Partner↔order link:** `src/links/partner-order.ts` — D3 M:N `partner ↔ order`
  (added by #342, list on both sides; a partner can serve another partner's store
  so this is the authoritative scoping for work-orders). **This is the join we read
  to know "which partner owes a fee for this order."**
- **Order lifecycle subscriber (the accrual hook):** `src/subscribers/order-placed.ts`
  listens to `order.placed` and ALREADY resolves the partner + creates the
  production run + links the design order. Fee accrual slots in here (or a sibling
  subscriber on the same event). `order-canceled.ts` / `order-fullfilled.ts` exist
  for compensation. **No `payment.captured` subscriber exists today.**
- **Per-partner config precedent:** `src/modules/partner-payment-config/models/partner-payment-config.ts`
  (`partner_id, provider_id, is_active, credentials(json), metadata`) — the exact
  pattern to mirror for a per-partner fee-rate config (one row per partner).
- **Partner model:** `src/modules/partner/models/partner.ts` — **no** rate/fee/
  commission field today. Don't bloat it; use a sibling config model.
- **Read/aggregation surfaces already present:** `src/api/admin/payment_reports/by-partner/route.ts`
  (per-partner money rollup), `/admin/payments/partners/[id]`, partner
  `/partners/[id]/payments`. A fee statement mirrors these envelopes.
- **Ops registry (for the historical backfill slice):** `src/api/admin/ops/maintenance-jobs/registry.ts`.

## ⛔ The ONE product decision that blocks slice 0 (needs Saransh)

The data model can't be locked until the **fee schedule** is chosen. Frame:

1. **Fee basis** — (a) flat % of order total *(recommended — simplest, matches
   "transaction fee")*, (b) flat amount per order, (c) tiered/volume, (d) per-line.
   → store enough columns to express (a)+(b) now; defer (c)/(d).
2. **Rate source** — (a) **platform-global default** via env/setting *(recommended
   v1)*, (b) **per-partner override** (mirror `partner-payment-config`), (c) both
   (per-partner row falls back to platform default). → design supports (c); v1 can
   ship with only the default populated.
3. **Accrual timing** — (a) at **`order.placed`** *(recommended — the existing
   subscriber already has the partner + total; deterministic)*, (b) at fulfilment,
   (c) at payment capture (no subscriber exists → more work). → reverse/waive on
   `order.canceled`.
4. **Currency** — accrue in the **order's currency** (post-#485 the order carries
   the partner-store currency); store `currency_code` on the fee row. No FX in v1.

**Recommended defaults (so a single 👍 unblocks the build):** flat % of order
total, platform-global default rate (env `PLATFORM_TX_FEE_BPS`, e.g. 200 = 2.00%)
with an optional per-partner override row, accrue at `order.placed`, order currency,
waive on cancel.

## Build slices (each = one PR, independently shippable)

**Slice 0 — `partner_billing` module + `partner_fee` model + migration** (additive,
zero behaviour change; buildable the moment the decision lands).
`model.define("partner_fee", { id, partner_id, order_id, order_total(bigNumber),
currency_code, fee_basis(enum: percentage|flat), fee_rate(int bps or amount),
fee_amount(bigNumber), status(enum: accrued|invoiced|waived|reversed), accrued_at,
metadata })`. Hand-write `add column if not exists`-style migration (create-if-not-
exists hazard memory). Pure unit on `computeFee(orderTotal, basis, rate)` helper.

**Slice 1 — fee-rate resolution** `resolvePartnerFeeRate(container,{partnerId})`:
read optional per-partner override (new `partner_fee_config` model mirroring
`partner-payment-config`, or reuse metadata) → fall back to platform default
(env/setting). Pure unit (override > default > 0). Mirrors `resolveStoreCurrency`
(#485, `src/.../resolve-store-currency`) as the "resolve-with-fallback" template.

**Slice 2 — accrual subscriber** on `order.placed`: resolve partner via
`partner-order` link → `computeFee` → persist a `partner_fee` row (idempotent on
order_id; skip if already accrued). Per-file integration spec (place an order →
assert one accrued fee row). Guard: only work-order/partner-linked orders accrue.

**Slice 3 — compensation** on `order.canceled`: flip the order's `partner_fee` to
`reversed` (or delete). Per-file integration.

**Slice 4 — read API** `GET /admin/partners/[id]/fees` (+ partner
`GET /partners/[id]/fees` statement, `assertPartnerOwns` scoped). Mirror the
`payment_reports/by-partner` envelope (period filter, totals, by_status). Aggregate
helper pure-unit.

**Slice 5 — ops data-plumbing job** `backfill-partner-order-fees` (registry-only,
dry-run→apply): accrue fees for historical placed orders that predate slice 2.
Mirrors the merged #457/#508 job pattern exactly (`registry.ts` append + own
`__tests__/<id>.unit.spec.ts`). This is the clean "catch up history" tail.

Slices 0–1 are decision-light once the schedule is chosen; 2–3 carry the only real
behaviour change; 4–5 are pure additive read/backfill. Each ships green per-file.

## Watch-outs

- `bigNumber` for all money fields (Medusa money convention), not float.
- `order.placed` fires for **retail** orders too — gate accrual to partner-linked /
  work-order orders or you'll bill the platform's own store.
- Idempotency: the subscriber can re-fire; key the fee row on `order_id` and skip if
  one exists (mirror order-placed's existing production-run idempotency).
- Post-#485 currency: read the order's `currency_code`, do NOT grab `stores[0]`.
- `container.resolve(...)` annotate `:any` (TS18046 prod-build trap).
