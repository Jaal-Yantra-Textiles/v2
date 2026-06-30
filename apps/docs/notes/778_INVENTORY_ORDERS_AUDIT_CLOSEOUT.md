# Inventory Orders, hardened — closing out the #778 audit

_2026-06-30_

Inventory orders are the backbone of how JYT turns raw materials into finished
stock: an admin (or a visual flow) creates an order, a partner is assigned,
they start it, deliver against it — fully or partially — and stock lands in the
right location. Issue **#778** was a top-to-bottom audit of that subsystem. It
surfaced 12+ findings across security, data integrity, money, observability and
API correctness, grouped into five child issues (#780–#784).

Groups 1 and 2 (the IDOR + stock/cancel correctness fixes) shipped earlier. This
note covers the closeout wave that finished **groups 3, 4 and 5** in one sitting.

## What shipped

### 💰 Money & status model (#783)

- **`Partial` status is real now (H8).** The DB and the system already produced
  `Partial` orders on short fulfillments, but the status was missing from the
  shared constants, the API filter, and the admin status dropdown — so you could
  never *find* a partial order. `constants.ts` is now the single source of truth
  (with a derived "input" list so `Partial` stays system-set only), and the admin
  filter shows it.

- **Per-unit price, consistently (H9).** `orderline.price` is the price of **one
  unit**. The admin UI, validators and cost-reads always treated it that way —
  but the order-total fallback summed raw prices and the unified-order dual-write
  *divided by quantity*, under-pricing every multi-unit line on the unified
  order. Both are fixed; a new `sumLineTotals` helper makes `total = Σ(price ×
  qty)` and is unit-tested with an explicit "don't treat price as a line total"
  guard. Orders also carry a real **`currency_code`** now (default `inr`) instead
  of the dual-write guessing.

  ```ts
  // before: unit_price = quantity > 0 ? lineTotal / quantity : lineTotal  ❌
  // after:  unit_price = line.price                                        ✅ (price is per-unit)
  ```

- **One source of truth for partner status (H3).** "Has the partner started?"
  lived in three places that could drift — the order `status` column, an
  `metadata.partner_status` copy, and a task-derived value. The metadata copy was
  a redundant duplicate (written in lockstep with `status`, read only by a guard
  that already had an equivalent `status` check). It's gone; `status` is
  canonical.

### 🔭 Observability (#782)

- **A real activity/timeline log (H4).** New `inventory_order_activity` table +
  recorder subscriber, mirroring what production runs already had. Every status
  transition, partner assignment, and rollback is now a first-class, queryable
  row — no more stuffing history into `metadata`.

  ```http
  GET /admin/inventory-orders/:id/activities
  → { "activities": [ { "kind": "status_changed",
                        "summary": "Status changed: Processing → Shipped",
                        "occurred_at": "..." }, ... ] }
  ```

- **Overdue reminders (H5).** A daily job nudges open orders past their
  `expected_delivery_date`, idempotent via the activity log (one nudge per
  cooldown window) and emitting an event that downstream notifications / visual
  flows can act on.

- **The await timeout actually applies now (H12).** The 23-day partner
  start/complete await timeout was computed but never wired into the async steps —
  a stuck order could wait forever. Now it's applied, mirroring production runs.

### 🧱 API correctness, hygiene & cleanup (#784)

- **Honest HTTP status codes (H10).** Partner routes blanket-`500`'d even for
  business errors and one leaked internal error text; admin routes ignored their
  validated body and returned a mis-shaped payload. They now surface the real
  `MedusaError` (→ proper `400/403/404`), read `validatedBody`, and wrap
  responses as `{ inventoryOrder }`.

- **Data-layer hardening.** Indexes on the columns the lists filter & sort by
  (`status`, `is_sample`, `order_date`, `expected_delivery_date`) and `>= 0`
  CHECK constraints on quantity/price — defence in depth behind the validators.

- **Cleanup.** Removed dead debug steps, an ineffective `try/catch`, stray
  `console.log`s, a `intialData` typo, and rewrote stale API docs that referenced
  fields (`supplier_id`, `items[].sku`, `action:"remove"`) that never existed.

## The shipping log

| PR | Finding | Summary |
|----|---------|---------|
| #807 | 783 · H8 | `Partial` status synced across constants/validators/admin filter |
| #808 | 784 | Debug logs, dead steps & stale API docs removed |
| #809 | 784 · H10 | Proper error codes + validatedBody + response shape |
| #810 | 782 · H12 | Wire the dead await timeout into the async steps |
| #811 | 784 | DB indexes + quantity/price CHECK constraints |
| #812 | 782 · H4 | Activity/timeline log (model + recorder + read route) |
| #813 | 783 · H9 | Per-unit price semantics + `currency_code` |
| #814 | 783 · H3 | Single source of truth for partner status |
| #815 | 782 · H5 | Overdue inventory-order reminders |

Every PR shipped with unit tests (the pure helpers — status constants,
`sumLineTotals`, the activity mapping, the overdue selector — are all covered)
and a clean type-check, and auto-deployed to prod on merge.

## What's intentionally left

- **#782 H6** — a RAG/search index for inventory orders (heavier; deferred).
- **#784 admin UI polish** — column sorting, server-side partner pagination,
  bulk actions / export (Playwright-gated; deferred).
- **#780 group 1** — the remaining defense-in-depth (idempotency keys, admin
  RBAC) beyond the C1 IDOR fix.

These are tracked on their issues; the correctness, money and observability core
of the audit is done.
