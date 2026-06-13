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
       - **PROVIDER CAVEAT:** the default in-memory locking provider is
         single-process only. Prod is currently one Fargate task (can't
         autoscale yet — see reference_aws_ecs_medusa_gotchas), so it's safe for
         now, but the moment we run >1 backend instance we MUST configure the
         Redis locking provider or the lock is a no-op across instances. The
         non-workflow writers (admin cancel route, the task-updated subscriber)
         must take the SAME lock — a lock only one writer respects is useless.
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
