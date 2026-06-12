# Orders Unification — #342 ([#24])

**Goal:** one order surface. Fold the two parallel partner work-order concepts —
`inventory_orders` (raw-material POs) and the design work-order (today:
`production_runs`) — onto Medusa's core `order` entity, discriminated by
`order.metadata.kind ∈ (design, inventory)`. Customer retail orders carry no
`kind`. Billing (#336), partner statements, FX/tax then act on ONE surface.

**Phases (task chain):**
- **T1 (this doc):** field mapping + gap decisions — DONE
- **T2:** thin shim PR — dual-write a unified `order` alongside one legacy create
- **T3:** partner-ui panels driven off `order.status` + `metadata.kind`; legacy routes become shims
- **T4:** backfill + quiet retirement

---

## 1. The actual landscape (corrects the roadmap's framing)

The roadmap text says partner-ui surfaces "design_orders and inventory_orders".
Reality after the v1 partner-design retirement (June 2026):

| Concept | Module | Partner routes | Already core order? |
|---|---|---|---|
| Customer retail orders | core `order` | `/partners/orders` (full mirror: fulfillments, edits, returns, claims, transfers) | **YES — already unified** |
| Raw-material POs | `src/modules/inventory_orders` (`InventoryOrder` + `InventoryOrderLine`) | `/partners/inventory-orders` (+ `/start`, `/complete`, `/submit-payment`) | No |
| Design work-orders | `src/modules/production_runs` (`ProductionRun`) | `/partners/production-runs` (+ accept/start/finish/complete/decline) | No (has nullable `order_id`/`order_line_item_id` pointing at core orders) |

**Key architectural decision (D1):** the unified `order` is the **commercial
artifact** (what's ordered, what's owed, to/from whom). `production_run` is the
**execution artifact** (dispatch state, snapshots, activity timeline, produced
/rejected quantities, consumption logs). We do NOT flatten production_run into
order — we give every work-order a core `order` spine and link the run to it
via the existing `production_run.order_id` column (today only set for
customer-purchase-driven runs; under unification it's always set, pointing at
the kind=design order). Same logic for inventory orders: the legacy row keeps
execution detail during transition; the core order carries commerce.

Rationale: production_run has ~15 execution-only fields (dispatch_state,
snapshot, depends_on_run_ids, lifecycle_transaction_id, activity log…) that
have no home on `order` and no consumer that needs them there. Billing and
statements need money + status + partner — exactly what `order` gives us.

## 2. Discriminator + partner association

- **D2 — kind:** `order.metadata.kind = "design" | "inventory"`. Metadata, not
  a column, for now (no migration; the roadmap allowed either). Revisit a typed
  column only if filtered queries on kind need an index in practice.
  Additional metadata keys are namespaced `jyt_*` where ambiguity is possible.
- **D3 — partner:** new link `partner ↔ order` (`src/links/partner-order.ts`,
  isList both sides, extra column `role` text nullable — mirrors how
  `partner-inventory-order` works today). This is THE scoping row partner-ui
  reads. Note: `/partners/orders` today scopes retail orders via sales-channel;
  work-orders get the explicit link instead (a partner can serve another
  partner's store, so channel scoping is wrong for work).

## 3. Field mapping — InventoryOrder → order (kind=inventory)

| Legacy field (`inventory_orders`) | Target | Notes / gaps |
|---|---|---|
| `id` (`inv_order_*`) | `order.metadata.legacy_id` | new order gets its own id; backfill keys on legacy_id for idempotency |
| `quantity` (float, order-level) | derived: Σ item quantities | keep `metadata.total_quantity` during dual-write for parity checks |
| `total_price` (bigNumber) | order totals via line items | core computes totals from items; parity-assert Σ(line price×qty) == legacy total at shim time |
| `status` (Pending/Processing/Shipped/Delivered/Cancelled/Partial) | split: see status map §5 | the 6-value enum conflates order-status and fulfillment-status |
| `expected_delivery_date` | `order.metadata.expected_delivery_date` | no core field |
| `order_date` | `order.metadata.order_date` | order.created_at ≠ commercial order date for backfilled rows |
| `shipping_address` (json) | `order.shipping_address` | core has a real address model — shim maps the json keys; non-conforming keys → metadata |
| `is_sample` | `order.metadata.is_sample` | |
| `metadata` | merged into `order.metadata` | legacy keys win on collision except `kind`/`legacy_id` |
| **OrderLine** `quantity` (float) | `order_line_item.quantity` | **GAP-1:** core quantity is BigNumber — decimals *should* work (raw-material kg). VERIFY in T2 shim; if integer-only, store float in `item.metadata.quantity_float` and round up on the core field |
| **OrderLine** `price` (bigNumber) | `order_line_item.unit_price` | flag whether legacy price is unit or line-total — service treats it as line contribution price×qty; shim must pass unit price |
| **OrderLine** `inventory_orders_id` | implicit (item belongs to order) | |
| **OrderLine** ↔ `inventory_item` link | `order_line_item.metadata.inventory_item_id` + keep link repointed later | core line items want `variant_id`; raw materials have none → `product_id`/`variant_id` null, `title` from inventory item |
| `partner_inventory_order` link | `partner_order` link (D3) | `assigned_at` data → link `metadata` |
| `inventory-orders-stock-locations` link (from/to flags) | `order.metadata.from_stock_location_id` / `to_stock_location_id` | the boolean-flag link shape is awkward; metadata is honest about it. Inventory-level updates on complete keep reading these |
| `inventory-orders-tasks`, `-internal-payments`, `-feedback`, `inbound-email-` links | unchanged in T2 (point at legacy row) | repoint in T4 via order_id once legacy row retires; tasks milestones (`partner-order-sent/received/shipped`) eventually collapse into fulfillment status |
| currency — **none exists** | `order.currency_code` | **GAP-2:** default to store currency (inr) + `metadata.currency_assumed: true`. FX work later re-rates from here |
| customer — none | `order.customer_id` null, `email` = partner admin email | **GAP-3:** verify core create accepts customer-less orders (draft order path does). The "customer" of a PO is JYT itself |
| region/sales channel — none | internal sales channel `"Partner Work Orders"` (create once, seed script) | keeps work-orders out of storefront analytics; gives core create the channel it wants |

## 4. Field mapping — ProductionRun → order (kind=design)

The order represents "JYT commissions partner X to produce design Y, qty N, at
cost C". One line item per design.

| Legacy field (`production_runs`) | Target | Notes |
|---|---|---|
| `id` | run keeps its id; run gains `order_id` → unified order; order gets `metadata.production_run_id` | bidirectional pointer |
| `design_id` | `order_line_item.metadata.design_id` + existing `design_order` link reused | the #29 link infra (linkDesignsToOrder) already handles design↔order pairs — same table, new producer |
| `partner_id` | `partner_order` link (D3) | `sub_partner_id` (outsourced) → second link row with `role: "sub_partner"` |
| `quantity` (float) | `order_line_item.quantity` | GAP-1 applies |
| `partner_cost_estimate` + `cost_type` (per_unit/total) | `unit_price` = per_unit ? estimate : estimate/quantity; `metadata.cost_type` preserved | **GAP-4:** `total` cost_type with odd quantities gives repeating-decimal unit prices; acceptable — totals parity-checked, original kept in metadata |
| `status` (7 values) | split: see status map §5 | |
| `run_type` (production/sample) | `order.metadata.run_type` | |
| `order_id`/`order_line_item_id` (customer purchase that spawned the run) | `order.metadata.source_order_id` / `source_line_item_id` | the unified work-order must NOT collide with the retail order pointer |
| execution fields (`dispatch_*`, `snapshot`, `captured_at`, `depends_on_run_ids`, `lifecycle_transaction_id`, `accepted_at`/`started_at`/`finished_at`…, `produced_quantity`, `rejected_quantity`, rejection/finish/completion notes, activity log) | **stay on production_run** (D1) | |
| `parent_run_id` / multi-partner assignment splits | one unified order per CHILD run (the partner-facing unit) | parent run = planning artifact, no order |
| money out (PaymentSubmission/Items) | unchanged; future statements join submissions ↔ orders via partner + design/task ids | out of #342 scope |

## 5. Status mapping (both kinds)

Core `order.status`: `draft | pending | completed | canceled | archived` (+
separate `fulfillment_status`, `payment_status`). The legacy enums conflate all
three; the work-progress dimension that doesn't fit goes to
`order.metadata.partner_status` — ONE shared vocabulary for both kinds:
`assigned → accepted → in_progress → finished → completed` (+ `declined`).
This is the field T3's unified panels key on, and it deliberately matches the
ProductionPolicyService transition vocabulary.

| Legacy | order.status | metadata.partner_status | fulfillment (if used) |
|---|---|---|---|
| inv `Pending` (unassigned) | `pending` | — | not_fulfilled |
| inv `Pending` (sent to partner) | `pending` | `assigned` | not_fulfilled |
| inv `Processing` | `pending` | `in_progress` | not_fulfilled |
| inv `Shipped` | `pending` | `finished` | shipped |
| inv `Partial` | `pending` | `completed` | partially_delivered |
| inv `Delivered` | `completed` | `completed` | delivered |
| inv `Cancelled` | `canceled` | — | — |
| run `draft`/`pending_review` | `draft` | — | |
| run `approved` | `pending` | — | |
| run `sent_to_partner` | `pending` | `assigned` | |
| run `in_progress` (accepted) | `pending` | `accepted`→`in_progress`→(`finished` after finish) | |
| run `completed` | `completed` | `completed` | |
| run `cancelled` | `canceled` | `declined` if partner-declined | |

Transitions remain owned by the existing workflows/ProductionPolicyService; in
T2 the shim only mirrors state, it never drives it.

## 6. What does NOT change in T2 (shim scope fence)

- No legacy table, route, workflow, or UI is removed or altered in behavior.
- Shim = a step appended to ONE legacy create path (recommend
  `createInventoryOrderWorkflow` — cleanest fit, real traffic, lines+money
  exercise GAP-1/2/3 immediately) that additionally creates the unified core
  order + partner link + metadata, and writes `unified_order_id` back onto the
  legacy row's metadata. Failure to dual-write must NOT fail the legacy create
  (log + activity row instead) — the projection is best-effort until T3.
- Status mirror: extend the existing update workflow(s) to PATCH the unified
  order's status/metadata.partner_status per §5. If that bloats the PR, defer
  mirror-on-update to early T3 and dual-write creates only.

## 7. Open questions for T2 (answer empirically in the shim)

1. **GAP-1:** does `order_line_item.quantity` accept decimals end-to-end
   (create → totals → admin UI render)? Test with 2.5.
2. **GAP-3:** minimal viable input for creating a core order with no customer —
   draft-order workflow vs `createOrdersWorkflow` directly; which keeps totals
   math + currency handling correct?
3. Does the admin orders list need a filter to HIDE kind!=null orders (so work
   orders don't pollute retail views)? Likely yes — small middleware/query
   tweak, do it in the same PR as the shim to avoid confusing ops.
4. Confirm `/partners/orders` channel-scoping does not accidentally expose
   kind'd orders to the wrong partner before the partner_order link ships.

---

## Handoff → next task (T2: thin shim PR)

*Updated 2026-06-12 after T1. Next session: read THIS file + `TaskList`; do not
rely on chat history.*

- **State:** mapping + decisions D1–D3 locked above; nothing implemented yet.
- **T2 deliverable:** one PR —
  1. `src/links/partner-order.ts` (D3),
  2. seed for "Partner Work Orders" sales channel,
  3. dual-write step appended to `createInventoryOrderWorkflow`
     (`src/workflows/inventory_orders/create-inventory-orders.ts`) creating the
     kind=inventory core order per §3 + §5, non-fatal on failure,
  4. integration test (shared suite): create inventory order → assert core
     order exists, kind, partner link, line items, totals parity, legacy row
     untouched; plus GAP-1 decimal-quantity probe and GAP-3 resolution,
  5. admin retail list filter from §7.3 if cheap, else note it here.
- **Key files discovered in T1** (saves re-exploration):
  - inventory module: `src/modules/inventory_orders/{models/order.ts, models/orderline.ts, service.ts, constants.ts}`
  - its workflows: `src/workflows/inventory_orders/*` (create, send-to-partner with await-steps, partner-complete, update)
  - production runs: `src/modules/production_runs/models/production-run.ts`, workflows under `src/workflows/production-runs/`, policy in `src/modules/production_policy/service.ts`
  - partner scoping today: `src/links/partner-inventory-order.ts`; partner routes `src/api/partners/inventory-orders/**`, `src/api/partners/production-runs/**`
  - design↔order link infra from #29: `src/workflows/designs/link-designs-to-order.ts`, `src/links/design-order-link.ts`
  - partner-ui app: `apps/partner-ui` — orders hooks `src/hooks/api/orders.tsx`, inventory-order hooks `src/hooks/api/partner-inventory-orders.tsx` (T3 material)
- **Gotchas to carry:** unscoped `workflow.run()` can't resolve "query" (always
  `(container)` scope); shared test suite truncates per test (create fixtures
  per-test); migrations adding columns must be hand-written ALTERs; CI may need
  `:any` on `container.resolve(...)`.
- **After T2:** update this Handoff section for T3, mark task #26 completed,
  user can `/clear`.
