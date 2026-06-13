# Orders Unification — #342 ([#24])

**Goal:** one order surface. Fold the two parallel partner work-order concepts —
`inventory_orders` (raw-material POs) and the design work-order (today:
`production_runs`) — onto Medusa's core `order` entity, discriminated by
`order.metadata.kind ∈ (design, inventory)`. Customer retail orders carry no
`kind`. Billing (#336), partner statements, FX/tax then act on ONE surface.

**Phases (task chain):**
- **T1 (this doc):** field mapping + gap decisions — DONE
- **T2:** thin shim PR — dual-write a unified `order` alongside one legacy create — DONE (#387)
- **T3:** partner-ui panels driven off `order.status` + kind; legacy routes become shims — IN PROGRESS (T3.1 #389, T3.2 #391 done)
- **T4:** backfill + quiet retirement

---

## ⚡ Active work breakdown — D5 link refactor + remaining T3/T4 (chunks)

> **HOW TO RECALL AFTER A CONTEXT CLEAR:** read this section. It is the durable
> copy of the chunk plan (the in-session task tracker does NOT survive `/clear`).
> Each chunk = one PR with its own test. Update the checkboxes as PRs merge.
> Last updated 2026-06-13.

**D5 (decided 2026-06-13) — link-based discrimination supersedes `metadata.kind`.**
Per [[feedback_no_critical_data_in_metadata]], stop using `order.metadata.kind`
and the `metadata.unified_order_id` backref (load-bearing, blob-replace-prone)
as the discriminator/pointer. Instead:
- Two new module links carry the relationship AND discriminate kind:
  `order ↔ production_run` (kind=design), `order ↔ inventory_order` (kind=inventory).
  Neither link → retail. (NOT the `design ↔ order` link — that one is shared with
  retail: `order-placed.ts` runs `linkDesignsToOrder` on every purchase.)
- The links are declared `filterable: ["id"]` so the **Index Module** (already
  enabled, `index_engine: true` in medusa-config) ingests them and `query.index`
  can filter on link existence — including the retail anti-join
  (`{ production_run: { id: null }, inventory_order: { id: null } }`). This is
  why **no denormalized `kind` column is needed.**
- **Split read paths:** `query.index` for list filtering (eventually consistent,
  fine for UI lists); `query.graph` link-resolution for transactional reads
  inside workflows (authoritative). Never use `query.index` for mirror-step
  correctness.
- **NOT solved by links:** `partner_status` stays in metadata (read-modify-write
  on every transition) → still needs the locking front (Chunks 7–8). `legacy_id`
  also survives until T4 decides idempotency-on-link.

**Dependency graph:**
```
1 (D5-1 links) ──┬─> 2 (D5-2 write links) ─> 3 (D5-3 read via link) ─┐
                 └─> 4 (T3.3 admin filter) ─> 5 (T3.4 panels)        ├─> 6 (cleanup) ─┐
7 (H1 locking) ─> 8 (H2 redis provider) ────────────────────────────┴────────────────┴─> 9 (T4)
```

**PR grouping (ship relevant chunks together — each chunk = one commit in the PR):**
| PR | Chunks | Theme | Status |
|---|---|---|---|
| **PR-A** | 1 + 2 + 3 | D5 link adoption: define → write → read (avoid a half-state on main where links exist but are unused) | **MERGED — PR #392** (2026-06-13, merge `c4d03469a`; auto-deploys to prod) |
| **PR-B** | 4 + 5 | Unified surfacing: admin retail filter + partner panels | **IN PROGRESS** on `feat/342-pr-b-unified-surfacing` — Chunk 4 done (committed), Chunk 5 next |
| **PR-C** | 6 | Metadata-write cleanup (after A + B prove links are the sole path) | not started |
| **PR-D** | 7 + 8 | Concurrency hardening: locking + Redis provider (parallel track, independent of A–C) | not started |
| **PR-E** | 9 | T4 backfill + retirement (own planning pass) | not started |

- [x] **Chunk 1 (D5-1)** — Define `filterable` links + ingest. New
  `src/links/order-production-run.ts` + `order-inventory-order.ts`, execution
  side `filterable: ["id"]`, order side `isList:false`. **DONE** — committed on
  branch `feat/342-d5-1-filterable-order-execution-links` (commit 1051daf95),
  part of PR-A. Verified: `db:migrate --execute-safe-links` created both link
  tables; a `query.index` probe accepted all three filter shapes
  (`production_run.id $ne null`, `inventory_order.id $ne null`, both-null retail
  anti-join), 0 rows as expected. Relation keys pinned via `field` to
  `production_run` / `inventory_order`. Shipped in PR #392 (PR-A).
  *(blocked by: none)*
- [x] **Chunk 2 (D5-2)** — Dual-write creates the links *in addition to* current
  metadata (transitional, nothing removed). Idempotency guard = link existence.
  Update both unification specs to assert the link. **DONE** (uncommitted on
  branch `feat/342-d5-1-filterable-order-execution-links`, part of PR-A).
  - Both projections now `remoteLink.create` the execution link right after the
    unified order is created, best-effort (`.catch` → `[orders-unification]`
    warn) so a link failure never loses the metadata backref legacy reads still
    need. Link keys: `{ [Modules.ORDER]: { order_id }, [<MODULE>]: {
    production_runs_id | inventory_orders_id } }`.
    - design: `dual-write-unified-run-order.ts` `projectRunToUnifiedOrder`
      (one `remoteLink` now shared by the execution + design↔order links).
    - inventory: `dual-write-unified-order.ts` `dualWriteUnifiedOrderStep`.
  - **Idempotency guard switched to link existence** in `projectRunToUnifiedOrder`
    (the only re-entrant path — create + per-child approve). Resolves the link
    FORWARD via `query.graph` (`entity:"production_runs", fields:["id","order.id"]`)
    and falls back to `metadata.unified_order_id` so pre-D5-2 (link-less) runs
    aren't re-projected into a duplicate. Inventory create path is single-shot
    (fresh order per legacy create) → no guard needed.
  - Specs assert the forward link resolves: inventory create test, design create
    test, and the approve/child-run test (each child links distinctly, parent
    still points at its superseded order — proves the guard didn't reuse the
    parent's order). Both specs green (5 + 5).
  - **⚠️ LINK NAMING FINDING (empirically nailed down 2026-06-13 — supersedes an
    earlier wrong "forward only" note):** these are **managed** links (pivot
    table), so they are **fully bidirectional** in `query.graph`. Verified with a
    real linked row reading BOTH directions:
    - **forward** (legacy row → order): `production_runs.order` /
      `inventory_orders.order` → the unified order. Authoritative.
    - **reverse** (order → legacy row): `order.production_runs` /
      `order.inventory_orders` → the run/inventory row. **Note the auto-derived
      PLURAL accessor** (`production_runs`, not `production_run`).
    - The `field: "production_run"` pin on the run side ONLY adds the singular
      alias to the **Index Module** — it does NOT rename `query.graph`'s reverse
      accessor. So: `query.index` (order side) accepts BOTH `production_run` and
      `production_runs` for the retail anti-join; `query.graph` reverse needs the
      PLURAL. (An earlier probe guessed `order.production_run` for query.graph,
      got "Entity 'Order' does not have property 'production_run'", and wrongly
      concluded the link was one-way. It is not.)
    - This is NOT a read-only-link situation: read-only links
      (`defineLink(..., { readOnly: true })`, e.g. the built-in OrderLineItem→
      Product) ARE uni-directional and need a separate inverse definition. Ours
      are stored/managed — bidirectional, no inverse needed.
    - **Implications:** Chunk 3 reads resolve `.order` **forward** from the legacy
      row (id already in hand — cleanest). Chunk 4's admin retail LIST filter
      stays on `query.index` (eventual-consistency-tolerant, and the null
      anti-join is its job); reverse `query.graph` selection also works if a
      transactional reverse read is ever needed. `production_runs.order_id` is a
      plain column (not a relation), so `.order` unambiguously resolves the new
      link. *(blocked by: none now)*
- [x] **Chunk 3 (D5-3)** — Switch transactional reads from
  `metadata.unified_order_id` → `query.graph` link resolution in the mirror
  steps, partner-link steps, admin cancel route, task-updated subscriber. After
  this, the backref is no longer the PRIMARY read. **DONE** (uncommitted on
  branch `feat/342-d5-1-filterable-order-execution-links`, part of PR-A).
  - New shared helper `resolveUnifiedOrderIdByLink(container, entity, legacyId)`
    in `inventory_orders/dual-write-unified-order.ts`: resolves forward
    (`<entity>.order` via `query.graph`) → unified order id, falling back to the
    legacy `metadata.unified_order_id` backref ONLY for pre-D5-2 link-less rows
    (that fallback retires with T4/Chunk 9 link backfill; Chunk 6 then stops
    writing the backref). Used by entity `"inventory_orders"` and
    `"production_runs"` — managed links are bidirectional so forward `.order`
    works for both (Chunk 2 finding).
  - **5 read sites switched** (all best-effort, inside the swallow-and-warn
    boundary): inventory `mirrorPartnerLinkOnUnifiedOrderStep` +
    `mirrorUnifiedOrderStatusStep` (the latter fetches `status` and `order.id`
    in one `query.graph`); run `mirrorRunStatusToUnifiedOrder`,
    `dualWriteChildRunOrdersStep` (parent order id), and
    `mirrorRunPartnerLinkOnUnifiedOrderStep`. The admin cancel route + the
    `production-run-task-updated` subscriber inherit the switch via the shared
    `mirrorRunStatusToUnifiedOrder` helper — no separate edit needed.
  - The Chunk 2 idempotency guard in `projectRunToUnifiedOrder` was ALREADY
    link-first (line ~193) — left as-is.
  - **Still WRITTEN, not yet removed:** both projections still write the
    `metadata.unified_order_id` backref (Chunk 6 removes the writes once A+B
    prove links are the sole path).
  - Tests: each spec gains a "resolves via the link, not the metadata backref"
    case that POISONS `metadata.unified_order_id` with a bogus order id, leaves
    the link intact, triggers a mirror (inventory: admin status PUT; run: admin
    cancel route), and asserts the REAL unified order still mirrors — provable
    only via the link. Both specs green (6 + 6). *(blocked by: none)*
- [x] **Chunk 4 (T3.3)** — Admin retail list filter: `GET /admin/orders` defaults
  to retail and hides work-orders; opt-in `?kind=` surfaces them. **DONE**
  (committed on `feat/342-pr-b-unified-surfacing`, part of PR-B).
  - **Mechanism — route override, not middleware.** New
    `src/api/admin/orders/route.ts` GET overrides the core list handler
    (verified: `routes-loader.js` keeps a `[matcher][method]` map, last-registered
    wins, and project `src/api` is scanned after core — so ours takes precedence).
    Core's `validateAndTransformQuery` middleware still runs, so `req.queryConfig`
    + `req.filterableFields` are populated; the handler runs last (ordering-proof).
    It translates `?kind=` into an `id` constraint and hands otherwise-untouched
    variables to the SAME `getOrdersListWorkflow` — totals, pagination, q-search,
    every existing filter intact, zero handler-body drift.
  - **`?kind=` validator** (`src/api/admin/orders/validators.ts`): zod enum
    `retail|design|inventory|all`, parsed IN the handler (not a second
    validate-middleware — core already validates the route, and `kind` is not a
    filterable order field so it must be stripped before the workflow).
    Unset → `retail`. `all` → no link filter (pre-D5 behaviour).
  - **Work-order id set via `query.graph`, NOT the index `$ne: null`.** Only the
    `id: null` retail anti-join was verified in D5-1; `$ne: null` on a link join
    is unverified. So we resolve the "has-link" ids by the authoritative forward
    join (`production_runs.order.id` / `inventory_orders.order.id`, paged 1000s),
    same shape as `resolveUnifiedOrderIdByLink`, incl. the transitional
    `metadata.unified_order_id` fallback for pre-D5-2 link-less rows. Then inject
    `id:{$nin}` (retail) / `id:{$in}` (design|inventory), `$and`-merged with any
    caller-supplied `id`. query.graph is authoritative (vs the eventually-
    consistent index), which a list tolerates.
  - **Known scale limit (accepted, revisit later):** the injected id array is
    unbounded (all work-orders for retail; all of a kind otherwise) → a large
    `IN`/`NOT IN` at scale. Fine for an early-stage admin-only list.
  - Tests: `integration-tests/http/orders-unification-admin-list-filter.spec.ts`
    — stands up a retail order (`createOrderWorkflow`) + an inventory work-order +
    a design work-order, asserts by SPECIFIC id (shared-DB-robust) that default
    hides work-orders, each `?kind=` surfaces its own, `?kind=all` shows all.
    4/4 green. *(blocked by: none — PR-A merged)*
- [ ] **Chunk 5 (T3.4)** — Partner-ui unified panels keyed on kind (which link is
  present) + `partner_status`. Hook: `apps/partner-ui/src/hooks/api/orders.tsx`.
  Skeletons, `--ui-*` tokens, partner API mirrors admin. *(blocked by: 4)*
- [ ] **Chunk 6 (D5-cleanup)** — Stop WRITING `metadata.kind` + `unified_order_id`;
  trim them from `PROTECTED_UNIFICATION_METADATA_KEYS` + the partner PATCH route.
  `partner_status` stays. *(blocked by: 3, 4)*
- [ ] **Chunk 7 (H1)** — Locking on the dual-write/mirror read-modify-write
  (`partner_status` race), key = unified order id, ALL writers share it, inside
  the swallow-and-warn boundary. Pattern: `complete-production-run.ts`.
  *(blocked by: none — parallel to the link work)*
- [ ] **Chunk 8 (H2)** — Register `@medusajs/locking-redis` in medusa-config
  (prod env-gated, in-memory fallback for dev). Must precede scaling >1 backend
  instance. *(blocked by: 7)*
- [ ] **Chunk 9 (T4)** — Backfill historicals (idempotent on link), repoint §4
  deviation + ancillary links, legacy routes → shims, quiet retirement. Needs
  its own planning pass. *(blocked by: 3, 6, 7)*

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
`assigned → accepted → in_progress → finished → completed` (+ `declined`,
+ `partial` — partially-delivered work that is still open, between
`in_progress` and `finished`; decided 2026-06-12, needed for order-line
delivery). This is the field T3's unified panels key on, and it deliberately
matches the ProductionPolicyService transition vocabulary.

| Legacy | order.status | metadata.partner_status | fulfillment (if used) |
|---|---|---|---|
| inv `Pending` (unassigned) | `pending` | — | not_fulfilled |
| inv `Pending` (sent to partner) | `pending` | `assigned` | not_fulfilled |
| inv `Processing` | `pending` | `in_progress` | not_fulfilled |
| inv `Shipped` | `pending` | `finished` | shipped |
| inv `Partial` | `pending` | `partial` | partially_delivered |
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

## 7. Open questions for T2 — ANSWERED (T2 shim, 2026-06-12)

1. **GAP-1 RESOLVED:** `order_line_item.quantity` accepts decimals end-to-end
   through `createOrderWorkflow` → totals math (2.5 × 40 = 100 verified by
   integration test). No `quantity_float` fallback needed. Admin UI render
   still unverified — check in T3.
2. **GAP-3 RESOLVED:** `createOrderWorkflow` (core-flows) directly, omitting
   BOTH `customer_id` and `email`. `findOrCreateCustomerStep` then resolves no
   customer and the order is created customer-less. Do NOT pass an email — it
   find-or-creates a guest customer row. Totals/currency handling correct
   (items are custom lines with explicit `unit_price`; no variant_id means
   inventory confirmation is skipped).
3. **DEFERRED to T3:** admin retail list still shows kind'd orders. Mitigated
   meanwhile by the "Partner Work Orders" sales channel (filterable in admin
   UI). Needs a middleware/query tweak on GET /admin/orders.
4. **OK:** unified work-orders live on the internal "Partner Work Orders"
   channel, which no partner store includes — channel-scoped `/partners/orders`
   cannot leak them.

---

## Handoff → next task (T3 continues: admin retail list filter + partner panels)

*Updated 2026-06-13 after T3.2 design-side dual-write (PR:
feat/342-t3-design-dual-write). Next session: read THIS file; do not rely on
chat history.*

- **State after T3.2:** dual-write + status mirror LIVE for production runs
  (kind=design), mirroring the T2 inventory recipe (§4 + §5). Both legacy
  surfaces (inventory orders, production runs) now project + maintain a unified
  core order.
  - `apps/backend/src/workflows/production-runs/dual-write-unified-run-order.ts`
    — the design-side counterpart to `inventory_orders/dual-write-unified-order.ts`.
    Exports two plain async helpers (`projectRunToUnifiedOrder`,
    `mirrorRunStatusToUnifiedOrder`) so routes + subscribers can reuse them
    without composing workflows, plus four workflow steps wrapping them. It
    reuses T2's `PARTNER_WORK_ORDERS_CHANNEL` constant + region/currency
    fallback recipe. Same best-effort contract (`[orders-unification]` warn,
    never fails the legacy path).
  - **Wiring** (one projection on create, mirror on every transition):
    - `create-production-run.ts` → `dualWriteUnifiedRunOrderStep` (admin
      top-level runs + partner self-serve runs, born `in_progress`).
    - `approve-production-run.ts` → `dualWriteChildRunOrdersStep`: §4 says the
      CHILD run is the partner-facing unit, so on a split each child gets its
      own order and the parent's create-time order is **canceled + stamped
      `metadata.superseded_by_run_ids`**. `mirrorRunStatusToUnifiedOrder` then
      permanently skips superseded orders. **Gotcha fixed in this PR:**
      `approveProductionRunStep` copied the parent run's `metadata` onto each
      child verbatim, including the create-step's `unified_order_id` backref —
      so the projection's idempotency guard reused the parent's order for every
      child. Now strips `unified_order_id` from inherited child metadata.
    - `send-production-run-to-production.ts` →
      `mirrorRunPartnerLinkOnUnifiedOrderStep` (D3 partner↔order link +
      `partner_status: "assigned"`; outsourced runs also link `sub_partner_id`
      with `role: "sub_partner"`).
    - accept / start / finish / complete / decline workflows →
      `mirrorUnifiedRunOrderStatusStep`. Decline passes `declined: true` (the
      ONLY cancel that carries `partner_status: "declined"`; admin cancel
      leaves it untouched per §5).
    - Non-workflow mutators also mirror: admin cancel route
      (`production-runs/[id]/cancel/route.ts`, covers run + children + parent)
      and the `production-run-task-updated` subscriber's auto-complete.
  - **§5 run mapping** lives in `RUN_TO_CORE_STATUS` + `deriveRunPartnerStatus`.
    The legacy enum collapses accepted/started/finished into one `in_progress`
    value, so `deriveRunPartnerStatus` disambiguates via lifecycle timestamps
    (`finished_at` → finished, `started_at` → in_progress, `accepted_at` →
    accepted). `draft`/`pending_review`/`approved` carry no `partner_status`.
  - **DEVIATION from §4:** the unified order id is stored on
    `run.metadata.unified_order_id`, NOT `run.order_id`. That column still
    means "the customer retail order that spawned the run" and is read by
    `stockFinishedGoodsStep` (reservations) + run provenance — repointing it is
    a T4 concern. The `order.metadata.source_order_id` carries the retail
    pointer on the unified side.
  - Test: `integration-tests/http/orders-unification-design-dual-write.spec.ts`
    (5 tests: create projection + design link, approve→child-orders +
    supersede + full partner lifecycle accept→complete, partner decline,
    admin cancel, non-fatality without region). Regression-checked the
    lifecycle / multi-partner / cross-ordering / design-status specs.
- **T3.2 scope notes / still open:**
  - WhatsApp run handlers (`workflows/whatsapp/*`) mutate run status directly
    and are NOT mirrored yet (out of scope; low traffic). Same for
    `recreate-production-run`.
  - No cost re-sync: the unified order's line `unit_price` is set at create
    time from `partner_cost_estimate` (0 until an admin sets it). When the
    partner reports cost at `/complete`, the run's cost updates but the order
    line is not re-priced — billing (#336) should read cost from the run or we
    add a price-sync in T4.
  - No compensation on `dualWriteUnifiedRunOrderStep` (mirrors T2): a rolled-back
    run-create can leave an orphan kind=design order (harmless, invisible to
    retail; T4 backfill dedups on `metadata.legacy_id`).
- **TRACKED TASK — metadata-as-critical-data audit (added 2026-06-13):**
  The unification leans on JSON `metadata` for load-bearing, frequently-mutated
  fields. Medusa's `update*` **replaces the whole metadata blob** — any writer
  that doesn't read-then-spread silently drops keys, and concurrent transitions
  race on the blob with no atomic merge. This is a footgun for critical state;
  audit and harden before T4 retirement.
  - **Keys a wrong update would corrupt:**
    - unified `order.metadata`: `kind`, `legacy_id`, `partner_status`,
      `source_order_id`/`source_line_item_id`, `superseded_by_run_ids`,
      `currency_assumed`, `to_/from_stock_location_id`.
    - legacy backrefs: `inventory_orders.metadata.unified_order_id`,
      `production_runs.metadata.unified_order_id` (the run↔order pointer this
      whole shim depends on — see the §4 deviation note above).
  - **Audit steps:**
    1. Grep every writer of those entities' metadata across `src/` and verify
       each does read-then-spread, not blind replace. The dual-write steps
       already re-read first (`patchUnifiedOrder` + the mirror steps); the
       legacy-row backref writers also spread `...(row.metadata ?? {})`.
    2. ~~**KNOWN HIT to fix:** `src/api/partners/orders/[id]/route.ts:52` does
       `updateOrders(req.params.id, req.body)` — a partner PATCH carrying a
       `metadata` field REPLACES the whole blob, wiping `kind`/`legacy_id`/
       `partner_status` off a unified work-order.~~ **FIXED (2026-06-13, on PR
       #391).** The POST handler now (a) whitelists the body to admin's
       `AdminUpdateOrder` fields (`email`, `shipping_address`, `billing_address`,
       `locale`, `metadata`) so a partner can't move `status`/`customer_id`/
       `sales_channel_id`, and (b) read-then-merges `metadata`, then force-restores
       the new exported `PROTECTED_UNIFICATION_METADATA_KEYS` (in
       `workflows/inventory_orders/dual-write-unified-order.ts`) from the existing
       order so partner input can never overwrite or drop them. Those keys are
       system-owned: they're set once at projection and `partner_status` only
       moves via the lifecycle mirror steps — never a direct PATCH. Test:
       `partner-orders-api.spec.ts` "merges metadata and protects unification keys".
    3. **Concurrency hazard:** the mirror steps are read-modify-write; two
       near-simultaneous transitions (e.g. partner `/complete` + the
       `production-run-task-updated` auto-complete) can lose a `partner_status`
       write. **DIRECTION (2026-06-13): use Medusa's Locking Module** to
       serialize the read-modify-write on a per-order key, rather than promoting
       to a typed column just for atomicity (item 4 still stands for indexing).
       Docs: https://docs.medusajs.com/learn/fundamentals/workflows/locks
       - **Workflow-level (preferred):** wrap each mirror step between
         `acquireLockStep({ key: <unified_order_id>, timeout: 2, ttl: 10 })` and
         `releaseLockStep({ key })`. Compensation auto-releases on error. The
         lock key must be the unified order id so every writer of that order's
         metadata contends on the same key. Note our mirrors run as
         best-effort steps appended to legacy workflows — acquire must NOT fail
         the legacy path, so keep the lock inside the swallow-and-warn boundary
         (acquire with a short timeout, on timeout log `[orders-unification]`
         and skip the mirror, never throw up into the legacy run).
       - **Step-level alt:** `container.resolve("locking").acquire(orderId,
         { expire: 10 })` / `.release(orderId)` inside the helper. Do NOT mix
         the two styles in one workflow execution (deadlock risk per docs).
       - The non-workflow writers (admin cancel route, the task-updated
         subscriber) must take the SAME lock — a lock only one writer respects
         is useless.
    3a. **INFRA TASK — enable the Redis locking provider in prod (added
       2026-06-13).** The default in-memory locking provider is single-process
       only, so item 3's lock is a no-op across instances. Prod already has a
       working Redis instance, so before (or alongside) shipping the locks:
       register the Redis locking provider in `medusa-config` for prod.
       Docs: https://docs.medusajs.com/resources/infrastructure-modules/locking/redis
       - Add the `@medusajs/locking-redis` provider to the Locking Module's
         `providers` in `medusa-config.ts`, pointing at the prod Redis URL
         (reuse the existing Redis connection / env var; do NOT hardcode).
         Make it the default provider so `acquireLockStep` uses Redis.
       - Keep in-memory as the fallback for local/dev (no Redis needed there);
         gate the Redis provider on the prod env var being present.
       - Today prod runs ONE Fargate task (can't autoscale yet — see
         reference_aws_ecs_medusa_gotchas), so in-memory is technically safe
         *now*, but wiring Redis is the correct fix and unblocks scaling out.
         This must land before we run >1 backend instance.
    4. **Promote the highest-risk keys to typed columns** (the D2 "revisit if
       needed" trigger): `kind` (filtered by the admin-list work, item 3 below)
       and `partner_status` (written on every transition, read by panels) are
       the strongest candidates. `legacy_id` + the `unified_order_id` backrefs
       are write-once (lower mutation risk) but are the backfill/idempotency
       anchor — a real indexed column is safer than a JSON key for T4 dedup.
- **Remaining T3 deliverable(s)** (suggested order):
  1. ~~status mirror per §5~~ — DONE (T3.1),
  2. ~~design-side dual-write for production runs~~ — DONE (T3.2, see above),
  3. admin retail list filter (§7.3 — still open): GET /admin/orders shows
     kind'd work-orders; needs a middleware/query tweak to exclude
     `metadata.kind` unless asked,
  4. partner-ui panels keyed on `order.metadata.kind` + `partner_status`
     (hooks: `apps/partner-ui/src/hooks/api/orders.tsx`),
  5. legacy routes become shims.

- **State after T3.1:** status mirror LIVE for inventory orders — every legacy
  status change now PATCHes the unified order per §5.
  - `mirrorUnifiedOrderStatusStep` (in `dual-write-unified-order.ts`) is
    appended to BOTH update workflows: `update-inventory-order.ts` (singular —
    partner start route, partner-complete's `updateOrderOnCompletionStep`,
    and its rollback compensation) and `update-inventory-orders.ts` (plural —
    admin PUT + order-lines routes). It re-reads the legacy row from DB (not
    workflow input), so compensations mirror correctly too. Same best-effort
    contract (`[orders-unification]` warn, never fails the legacy path).
  - §5 mapping note: Pending and Cancelled deliberately leave
    `metadata.partner_status` untouched ("assigned" is stamped by
    send-to-partner; the §5 table defines no value for either). DECIDED
    2026-06-12: the vocabulary gained `partial` (legacy `Partial` →
    `partner_status: "partial"`, not `completed`) — order-line delivery
    needs the distinction; T3 panels must render it.
  - Tests: `orders-unification-dual-write.spec.ts` now 5 tests — adds admin
    status mirror (Processing → in_progress, Cancelled → canceled),
    non-fatality of updates without a unified order, and the full partner
    lifecycle (start → in_progress, partial delivery → Partial/partial,
    remainder → Shipped/finished) folded into the send-to-partner test.
  - **BUG discovered + FIXED (same PR):** GAP-1's cousin —
    `line_fulfillment.quantity_delta` was an INTEGER column
    (`src/modules/fullfilled_orders/`), silently rounding decimal partial
    deliveries (1.5 kg → 2) so the remainder tripped the over-delivery guard.
    Now `model.float()` + `Migration20260612202252` (ALTER to `real`,
    matching `inventory_order_line.quantity`). NOTE: `medusa db:generate`
    emitted the useless `create table if not exists` form again — the ALTER
    was hand-written into the generated file, per the standing migration
    hazard. The lifecycle test's decimal partial (1.5 of 2.5) is the
    regression guard.
- **State after T2:** dual-write shim LIVE for inventory orders.
  - `apps/backend/src/links/partner-order.ts` — D3 link (partner ↔ core
    order, isList both sides). Query rows via the link's `entryPoint`.
  - `apps/backend/src/workflows/inventory_orders/dual-write-unified-order.ts`
    — `dualWriteUnifiedOrderStep` (appended to `createInventoryOrderWorkflow`)
    + `mirrorPartnerLinkOnUnifiedOrderStep` (appended to
    `sendInventoryOrderToPartnerWorkflow`, sets link + `partner_status:
    "assigned"`). Both best-effort: swallow errors, `logger.warn` with
    `[orders-unification]` prefix. Legacy row gets
    `metadata.unified_order_id` backref.
  - "Partner Work Orders" sales channel is lazily ensured by the step (NOT a
    seed script — fresh envs need no coordination).
  - Currency = store default currency (NOT hardcoded inr) +
    `metadata.currency_assumed: true`.
  - Test: `integration-tests/http/orders-unification-dual-write.spec.ts`
    (3 tests: full projection incl. GAP-1/GAP-3, non-fatality without region,
    partner link on send).
- **T2 scope notes:** No compensation on the dual-write step: if a later
  legacy step rolls the create back, an orphan kind'd order may remain
  (harmless, invisible to retail; T4 backfill dedups on `metadata.legacy_id`).
  Legacy DELETE (`delete-inventory-order.ts`) does not mirror — a deleted
  legacy row leaves its unified order behind (decide cancel-vs-orphan when
  touching that path).
- **Remaining T3 deliverable(s)** (suggested order):
  1. ~~status mirror per §5~~ — DONE (T3.1, see above),
  2. same dual-write for production runs (kind=design, §4) on the run-create
     path — mirror T2's recipe: project on create, link partner on
     send/assign, mirror status on the run lifecycle transitions
     (ProductionPolicyService vocabulary already matches §5),
  3. admin retail list filter (§7.3 — still open),
  4. partner-ui panels keyed on `order.metadata.kind` + `partner_status`
     (hooks: `apps/partner-ui/src/hooks/api/orders.tsx`),
  5. legacy routes become shims.
- **Gotchas to carry:** test store default currency is eur (don't assert inr);
  task-template create 404s if `category` names a non-existent category;
  shared test suite truncates per test (create fixtures per-test); CI may need
  `:any` on `container.resolve(...)`; `createOrderWorkflow` requires a region
  to exist (step skips with warn if none); partner routes need a FRESH login
  token after `POST /partners` (stale token → auth context misses the
  partner); both update workflow files export a step named
  `update-inventory-order-step` — disambiguate by file when grepping.
