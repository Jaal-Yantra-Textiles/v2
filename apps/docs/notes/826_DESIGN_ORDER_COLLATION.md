# #826 — Collate designs as line items on one order (partner sees one order, many designs)

Grounded in the existing #342 orders-unification work (`ORDERS_UNIFICATION_342.md`,
`DESIGN-ORDER-ANALYSIS.md`). Decision layer: **Option A** (collate at the order;
per-design production runs stay per-design underneath).

## Two different "orders" exist today — don't conflate them
1. **Commissioning / sales order** — `createDraftOrderFromDesignsWorkflow` →
   customer cart with N design line items (design↔line-item link). This is *who
   pays*. Admin creates it (customer widget; now also the general Designs list —
   S1 below). Runs carry its id as `run.order_id` / projection `source_order_id`.
2. **Partner work-order** — `projectRunToUnifiedOrder`
   (`production-runs/dual-write-unified-run-order.ts`) mints ONE unified core
   order **per production_run** ("JYT commissions partner X to make design Y") —
   one line item per design — links the partner (D3 `partner↔order`) and links
   `order↔production_run` (D5, **1:1**, the kind=design discriminator). This is
   *what the partner's "Design Orders" panel actually shows.*

**The fragmentation** the user feels: N designs → N runs → **N work-orders**,
each with a single design line. Inventory already collates (one `inventory_order`
→ N `orderline`s → one unified order via `dual-write-unified-order.ts`; partner
renders `<InventoryOrderLines>`). Design orders never got the collated projection.

## Current partner render asymmetry (`order-detail.tsx`)
- inventory kind → `<InventoryOrderLines>` (one order, N lines) ✅
- design kind → resolves `production_run.design_id` → **one** design, single
  `WorkOrderSummarySection` ❌  (this is the gap)

## Recommendation (revised by the #342 review)
Collate at the **work-order projection layer**, mirroring the inventory dual-write
— NOT by separately surfacing the customer commissioning order. The projection
already creates a partner-linked, kind-discriminated order with design line
items; we make it hold **N lines (one per run)** instead of minting N orders.

- **Collation key:** `run.order_id` (already stamped; projection reads it as
  `source_order_id`). Sibling design runs sharing a source/commissioning order →
  ONE work-order with N line items. (So the user's "commissioning order" instinct
  = the *grouping key*, while the *anchor the partner sees* is the collated
  work-order projection.)
- **Link change:** `order↔production_run` 1:1 → **1:many** (order side lists
  runs). The partner list discriminator already tolerates arrays
  (`resolvePartnerWorkOrderIdsStep`'s `linked()` checks `Array.isArray || .id`).
  Detail route (`use-order-kind.ts`, `legacyId = production_run id`) assumes 1:1
  and MUST be revisited — this is the main #342 invariant touched.
- **Per-line status:** each design line ↔ its run (`run.order_line_item_id`,
  already exists) → line shows that run's status. Denormalize
  `design_name`/`design_status`/`sequence` onto the design↔order link (extraColumns,
  mirrors #817 S2) for self-describing display.

## Slices
- **S1 — admin curate (DONE, this session):** "Create Order" command on the
  general Designs list (`admin/routes/designs/page.tsx`) — multi-select → reuse
  `DesignOrderPreviewDrawer` + `/admin/customers/:id/design-order[/preview]`.
  Auto-resolves customer from the design↔customer link (enriched onto
  `GET /admin/designs` response); single-customer required (picker deferred).
  Creates the **commissioning order** (layer 1). Backend already `design_ids[]`.
- **S2 — model:** extraColumns on `design-order-link` (`design_name`,
  `design_status`, `sequence`, nullable `quantity`) + migration; populate on
  create/convert fan-out.
- **S3a — collated projection:** batch `projectRunToUnifiedOrder` — N runs sharing
  `order_id` → one unified work-order with N design line items (mirror inventory
  dual-write). Requires `order↔production_run` 1:many + detail-route de-1:1.
- **S3b — partner view:** `<DesignOrderLines>` (mirror `inventory-order-lines.tsx`)
  rendering one line per design w/ per-run status; partner Design Orders list =
  one row per collated order.
- **Bug #8 (prereq for runs off a design order):** `order-placed.ts:48-53` skips
  run creation for design line items (`product_id` null → `continue`). Resolve
  `design_id` from the design↔line-item link + fan out one run per design line
  (`order_line_item_id` already the run key).

## DECISION (2026-07-01, user): anchor = collated work-order projection.
Collate at `projectRunToUnifiedOrder`; grouping key `run.order_id`; order↔run
1:1 → 1:many; de-1:1 the partner detail route. NOT the customer commissioning
order (would duplicate order surfaces for the partner).

### Simplification this unlocks — S2 (extraColumns) is likely UNNEEDED
Under the work-order anchor the design lines ARE the collated order's core
**line items** (one per design, created by the projection from `run.snapshot`),
joined to their run via `order_line_item_id`. So per-line display/status rides on
the order line items + run join — exactly like inventory uses `inventory_order_line`,
not a denormalized link. => We do NOT denormalize onto `design-order-link`;
instead ensure the projection stamps design identity (name/status) onto each line
item it creates (it already sets title from `run.snapshot.design.name`). Revised
slices below drop S2.

### CORRECTION (2026-07-01): "Bug #8" is INTENTIONAL, not a bug
`convert-design-order.ts:169-179` builds **title-only** order line items (no
`product_id`) *specifically* so `order-placed.ts` does NOT auto-spawn runs for a
customer design order (draft order, `no_notification`). The order line items DO
inherit `metadata.design_id` + `source_cart_line_item_id` from the cart line
items (draft workflow stamps `metadata.design_id` at create). So run creation for
design orders is a DELIBERATE explicit admin step, not order-placed.
=> Collation entry point is an **explicit "send design order to production"
fan-out**, NOT an order-placed change. Runs today (admin `/designs/:id/
production-runs`) do NOT carry the commissioning `order_id`, so there's no group
key yet — the fan-out must stamp it.

### Revised build order
1. **Fan-out-runs-for-design-order** (new workflow + admin action): given a
   commissioning order, create one production_run per design line item, each
   stamped `order_id`=commissioning order + `order_line_item_id`=that line +
   `design_id` (from line `metadata.design_id`). This gives the collation its
   `run.order_id` group key while respecting the deliberate no-auto-run design.
2. **S3a — collated projection:** batch `projectRunToUnifiedOrder` so N runs
   sharing `order_id` → ONE unified work-order with N line items; `order↔run`
   1:many; idempotent on the collated order. Mirror `dual-write-unified-order.ts`.
3. **S3b — partner render:** de-1:1 `use-order-kind.ts` (order → runs plural);
   `<DesignOrderLines>` (mirror `<InventoryOrderLines>`), one line per design w/
   per-run status; partner Design Orders list = one row per collated order.
4. Admin collated detail (Bug #9 / #15) — cart/order-level view + mixed-status.

## Key files
- projection: `src/workflows/production-runs/dual-write-unified-run-order.ts`
  (`projectRunToUnifiedOrder`, `dualWriteChildRunOrdersStep`, `linkPartnerToOrder`)
- inventory template: `src/workflows/inventory_orders/dual-write-unified-order.ts`
- partner list scoping: `src/workflows/orders/list-partner-orders.ts`
  (`resolvePartnerWorkOrderIdsStep`)
- partner detail + kind: `apps/partner-ui/src/routes/orders/order-detail/order-detail.tsx`
  + `use-order-kind.ts`; render `components/work-orders/inventory-order-lines.tsx`
- run fan-out gate (Bug #8): `src/subscribers/order-placed.ts`
- links: `order-production-run.ts` (D5 1:1), `design-order-link.ts`,
  `design-line-item-link.ts`, `design-customer-link.ts`, partner↔order (D3)

---

## Session 2026-07-01b — command bar, no-customer produce, design↔partner fix

### Shipped (PR #828, branch `feat/826-design-order-collation`)
- **Compact command bar** (`src/admin/routes/designs/page.tsx`): the Designs
  list command bar now renders each action as just its shortcut-letter badge
  (`<CommandBar.Command label="" shortcut="x">`) wrapped in a `<Tooltip>` that
  reveals the full label on hover. Custom `<CommandBar>` (from `@medusajs/ui`)
  replaces `<DataTable.CommandBar>`; `CommandBar.Command` registers its OWN
  keydown, so `commands` was dropped from `useDataTable` to avoid double
  registration. `useCommands` now returns plain `{label,shortcut,action}` (no
  `createDataTableCommandHelper`).
- **"Send to Production" (no customer)** — collate N selected designs into ONE
  partner work-order WITHOUT a commissioning order / sale ("just make these"):
  - `collateRunsIntoWorkOrder(container, runs, {sourceOrderId})` — extracted
    shared core from `projectDesignOrderToUnifiedOrder` (region/channel + one
    line per run + order↔run 1:many + design↔order + partner↔order + aggregate
    status). Both the commissioning path and the no-customer path call it.
  - `produceDesignsAsWorkOrder(container, design_ids, partner_id)`
    (`src/workflows/designs/produce-designs-as-work-order.ts`): one run/design
    (born `sent_to_partner`, `skip_unified_projection`, NO `order_id`) → collate.
    `source_order_id` on the collated order is `null` for this path.
  - `POST /admin/designs/produce {design_ids, partner_id}` → `{design_production}`.
  - `SendToProductionDrawer` partner picker (mirrors `BulkLinkPartnerDrawer`);
    "Send to Production" command (shortcut `g`) on the designs list.
  - Test: `integration-tests/http/designs-produce-no-customer.spec.ts`.
- **Fix "design-details shows nothing found"** — root cause: `GET
  /partners/designs/:id` (`src/api/partners/designs/[designId]/route.ts:157`)
  scopes on the **design_partner** link and 404s ("Design not found for this
  partner") when absent. The produce paths created design↔order + partner↔order
  but never design↔partner. `collateRunsIntoWorkOrder` now creates a
  design↔partner link per (design, committed-partner) pair (best-effort,
  idempotent). Test asserts every produced design is assigned.

### NEXT SESSION — capture the collated lifecycle in the ONE order space
Two UI features remain (both partner-ui, some admin), grounded here so a clean
session can start immediately:

1. **Per-design details navigation (finish the "nothing found" UX).** The
   collated order (`order-detail.tsx`) shows N `<DesignOrderLines>` cards but
   only ONE top "Design details" link, and `OrderDesignDetails`
   (`routes/orders/order-design-details/order-design-details.tsx`) resolves the
   design via `order.metadata.legacy_id` = **runs[0].id only** → always the
   first design. Plan:
   - Make each `<DesignOrderLines>` card link to its OWN design, e.g.
     `/orders/:id/design-details/:designId` (design_id is on
     `line.metadata.design_id`; run id on `line.metadata.production_run_id`).
   - `OrderDesignDetails`: read the `:designId` route param when present and
     resolve THAT design (fall back to legacy_id for legacy single-design
     orders). Register the nested route in `get-partner-route.map.tsx`.
   - Now that design↔partner links exist, each design resolves (no more 404).

2. **Manage all production runs' lifecycle from the collated order space** (the
   user's core ask). Today the collated `<DesignOrderLines>` shows qty/amount
   only — no run status, no lifecycle actions. The single-design order uses
   `<ProductionRunCard>` (accept/start/finish/complete + consumption). Plan:
   - The collated order has `order.production_runs` (1:many) — one run per
     design line (`line.metadata.production_run_id` ↔ run). Fetch the runs for
     the order and join to lines by `production_run_id`.
   - Per design card: show the run's `partner_status` badge + inline lifecycle
     actions (reuse the partner run mutation hooks used by `ProductionRunCard`;
     `usePartnerProductionRun` per run, or a batch fetch). So a partner can drive
     accept→start→finish→complete for EVERY design of the collated order from
     one screen — the "same place where the collated designs lifecycle is
     captured".
   - Order-level roll-up already exists: `aggregatePartnerStatus`/
     `aggregateCoreStatus` (least-advanced). On each per-run lifecycle
     transition, re-aggregate onto the collated order — see the OPEN follow-up:
     `mirrorRunStatusToUnifiedOrder` currently writes the collated order's status
     from a SINGLE run; it must aggregate across all the order's runs (noted in
     commit `2ee9ff7f1`). This is the backend piece that makes the collated
     lifecycle correct as individual runs advance.
   - Admin mirror: the collated work-order detail should likewise list per-design
     run status/actions (admin already has the produce button on the design
     order; extend to show/advance the resulting runs).

### Key files (this session + next)
- shared collate core: `src/workflows/production-runs/dual-write-unified-run-order.ts`
  (`collateRunsIntoWorkOrder`, `projectDesignOrderToUnifiedOrder`,
  `mirrorRunStatusToUnifiedOrder` ← aggregation TODO)
- no-customer produce: `src/workflows/designs/produce-designs-as-work-order.ts`
  + `src/api/admin/designs/produce/route.ts`
- commissioning produce: `src/workflows/designs/create-runs-for-design-order.ts`
  + `src/api/admin/orders/[id]/design/produce/route.ts`
- designs list UI: `src/admin/routes/designs/page.tsx` +
  `src/admin/components/designs/send-to-production-drawer.tsx`
- partner collated render: `apps/partner-ui/src/routes/orders/order-detail/order-detail.tsx`
  + `components/work-orders/design-order-lines.tsx`
  + `routes/orders/order-design-details/order-design-details.tsx` (per-design TODO)
- partner run lifecycle card (reuse): `apps/partner-ui/src/components/work-orders/production-run-card.tsx`
- partner design scoping (404 cause): `src/api/partners/designs/[designId]/route.ts:157`
