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

### Revised build order
1. **Bug #8** — `order-placed.ts:48-53`: fan out one production_run per design
   line item (resolve `design_id` from design↔line-item link; `order_line_item_id`
   already the run key; stamp `order_id`). Prereq: runs must exist per design line.
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
