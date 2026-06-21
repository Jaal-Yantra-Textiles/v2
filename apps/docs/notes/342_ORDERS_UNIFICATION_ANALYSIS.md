# Orders Unification — Surface Analysis for #342

## Purpose

The orders-unification work (#342) folds two legacy partner work-order concepts — raw-material purchase orders (`inventory_orders`) and design work-orders (`production_runs`) — onto Medusa's core `order` entity. A new `unified_order_status` sidecar module carries the load-bearing `partner_status` that partner panels key on. Customer retail orders remain untouched (they are already core `order` rows). The discriminator is **link existence** (D5): an order linked to a `production_run` is kind=design, linked to an `inventory_order` is kind=inventory, neither = retail.

---

## The three order surfaces

### 1. unified_order_status — typed sidecar

**Module:** `apps/backend/src/modules/unified_order_status/index.ts`
**Service:** `apps/backend/src/modules/unified_order_status/service.ts` — extends `MedusaService({ UnifiedOrderStatus })`, auto-generates CRUD.
**Model:** `apps/backend/src/modules/unified_order_status/models/unified-order-status.ts`

```ts
// line 20–31
model.define("unified_order_status", {
  id: model.id({ prefix: "uos" }).primaryKey(),
  partner_status: model.enum([
    "assigned", "accepted", "in_progress", "finished",
    "partial", "completed", "declined"
  ]),
})
```

**Migration:** `apps/backend/src/modules/unified_order_status/migrations/Migration20260614184932.ts` — creates table with partner_status check constraint.

**What it represents:** A 1:1 sidecar row per unified order that holds the partner-facing work-progress status. Row presence means "this order has reached a partner-tracked state." Promoted off `order.metadata.partner_status` (PR-H / Chunk 9b-contract) to avoid the read-modify-write race that metadata wholesale-replacement caused — a single-column upsert (`setUnifiedOrderPartnerStatus`) has no lost-update hazard.

### 2. inventory_orders — raw-material POs

**Module:** `apps/backend/src/modules/inventory_orders/index.ts` — exports constant `ORDER_INVENTORY_MODULE = "inventory_orders"`.
**Service:** `apps/backend/src/modules/inventory_orders/service.ts` — extends `MedusaService({ InventoryOrder, OrderLine })`. Adds `createInvWithLines` (validates line input, creates order + lines, collects per-line errors) and aliases `listInventoryOrderLines` / `listAndCountInventoryOrderLines`.
**Model — `InventoryOrder`:** `apps/backend/src/modules/inventory_orders/models/order.ts` — table `inventory_orders`, id prefix `inv_order`, fields `quantity` (float), `total_price` (bigNumber), `status` (enum: Pending/Processing/Shipped/Delivered/Cancelled/Partial, default Pending), `expected_delivery_date` (nullable), `order_date` (nullable), `metadata` (json, nullable), `shipping_address` (json, nullable), `is_sample` (boolean, default false). `hasMany` -> `OrderLine`. Cascades delete to orderlines.
**Model — `OrderLine`:** `apps/backend/src/modules/inventory_orders/models/orderline.ts` — table `inventory_order_line`, fields `quantity` (float), `price` (bigNumber), `metadata` (json, nullable). `belongsTo` -> `InventoryOrder`.
**Constants:** `apps/backend/src/modules/inventory_orders/constants.ts` — exports 5 statuses (`INVENTORY_ORDER_STATUS`: Pending/Processing/Shipped/Delivered/Cancelled). Note: the model's enum has **6** values (including "Partial"); the constants file omits it.
**Migration:** `apps/backend/src/modules/inventory_orders/migrations/Migration20250416111440.ts` (initial), `Migration20250416111849.ts`, `Migration20250509141001.ts`, `Migration20250611132802.ts`, `Migration20250810071843.ts`, `Migration20250821160909.ts`, `Migration20250821160920.ts`, `Migration20260305151334.ts` — 8 migrations total.

**What it represents:** A raw-material purchase order sent to a partner supplier. The legacy surface before #342 was a standalone CRUD (`/admin/inventory-orders`, `/partners/inventory-orders`). Under #342, each inventory_order gets a unified core `order` row linked 1:1 via the `order-inventory-order` link (D5). The legacy entity still tracks execution detail (stock locations, tasks, payments, feedback, line fulfillments).

### 3. fullfilled_orders — line-level fulfillment events

**Module:** `apps/backend/src/modules/fullfilled_orders/index.ts` — exports constant `FULLFILLED_ORDERS_MODULE = "fullfilled_orders"`.
**Service:** `apps/backend/src/modules/fullfilled_orders/service.ts` — extends `MedusaService({ Line_fulfillment })`. Wraps `listLine_fulfillments` as `listLineFulfillments`.
**Model:** `apps/backend/src/modules/fullfilled_orders/models/line_fulfillment.ts` — table `line_fulfillment`, fields `id`, `quantity_delta` (float — deliveries are in raw-material units (kg), must accept decimals — the integer column silently rounded 1.5 → 2, fixed per the model comment), `event_type` (enum: sent/shipped/received/adjust/correction), `transaction_id` (text), `notes` (text, nullable), `metadata` (json).
**Migration:** `apps/backend/src/modules/fullfilled_orders/migrations/Migration20250810060405.ts`, `Migration20260304163723.ts`, `Migration20260612202252.ts` — 3 migrations.

**What it represents:** Atomic fulfillment events at the line level — tracks individual shipment/receipt/adjustment/correction transactions for inventory order lines. Does NOT link to the core Medusa `Order` entity at all. Links only within the inventory-order sub-domain via two links: one to `OrderLine` and one to `InventoryOrder`.

---

## How each links to the core Medusa Order entity

### Links that connect directly to OrderModule.order

Each uses `defineLink` from `@medusajs/framework/utils` and is a **managed** (pivot-table) link so they are fully bidirectional in `query.graph`.

| Link file | From | To | Cardinality | Role |
|---|---|---|---|---|
| `apps/backend/src/links/order-unified-status.ts` | `OrderModule.linkable.order` | `UnifiedOrderStatusModule.linkable.unifiedOrderStatus` | 1:1, `filterable: ["id"]`, `field: "unified_order_status"` | Chunk 9b sidecar — promotes `partner_status` off metadata |
| `apps/backend/src/links/order-inventory-order.ts` | `OrderModule.linkable.order` | `InventoryOrderModule.linkable.inventoryOrders` | 1:1, `filterable: ["id"]`, `field: "inventory_order"` | D5 discriminator for kind=inventory + pointer replacing `metadata.unified_order_id` |
| `apps/backend/src/links/order-production-run.ts` | `OrderModule.linkable.order` | `ProductionRunsModule.linkable.productionRuns` | 1:1, `filterable: ["id"]`, `field: "production_run"` | D5 discriminator for kind=design + pointer |
| `apps/backend/src/links/partner-order.ts` | `PartnerModule.linkable.partner` (`isList: true`) | `OrderModule.linkable.order` (`isList: true`) | M:N | D3 partner-scoping for work-orders |
| `apps/backend/src/links/design-order-link.ts` | `DesignModule.linkable.design` (`isList: true`) | `OrderModule.linkable.order` (`isList: true`) | M:N | Design-to-order trace, shared with retail (NOT a kind discriminator) |
| `apps/backend/src/links/partner-inventory-order.ts` | `PartnerModule.linkable.partner` | `InventoryOrderModule.linkable.inventoryOrders` (`isList: true`, `field: 'inventory_orders'`) | M:N | Legacy partner→inventory-order scoping (does NOT involve core Order) |
| `apps/backend/src/links/conversion-order-link.ts` | `Modules.ORDER` primaryKey `id` | `AdPlanningModule.linkable.conversion.id` primaryKey `order_id` | M:N, `readOnly: true` | Read-only attribution link |

### Link directionality finding (empirically verified in code)

Per the comments in `apps/backend/src/links/order-inventory-order.ts` lines 18–31 and `apps/backend/src/links/order-production-run.ts` lines 23–40:
- **Forward** (legacy→core): `<entity>.order` — e.g. `inventory_orders.order`, `production_runs.order` → the unified order. **Authoritative for transactional reads.**
- **Reverse** (core→legacy): `order.inventory_orders`, `order.production_runs` — **auto-derived PLURAL** accessor names. The Index Module alias (`field: "inventory_order"` or `field: "production_run"`) does NOT rename the `query.graph` reverse accessor.
- Read-only links (`conversion-order-link.ts`) are UNI-directional — need a separate inverse definition.

### Inventory-order sub-domain links (NO direct OrderModule.order link)

These link `InventoryOrdersModule` and `FullfilledOrdersModule` to each other and to other modules, but do NOT touch the core Order entity:

| Link file | From | To |
|---|---|---|
| `apps/backend/src/links/fullfilled-orders-order-lines.ts` | `InventoryOrdersModule.linkable.inventoryOrderLine` (isList) | `FullfilledOrdersModule.linkable.lineFulfillment` (isList) |
| `apps/backend/src/links/fullfilled-orders-orders.ts` | `InventoryOrdersModule.linkable.inventoryOrders` (isList) | `FullfilledOrdersModule.linkable.lineFulfillment` (isList) |
| `apps/backend/src/links/inventory-orders-inventory-items.ts` | `InventoryOrdersModule.linkable.inventoryOrderLine` (isList) | `InventoryModule.linkable.inventoryItem` (isList) |
| `apps/backend/src/links/inventory-orders-stock-locations.ts` | `InventoryOrdersModule.linkable.inventoryOrders` (isList) | `StockLocationModule.linkable.stockLocation` (isList) — has extra columns `from_location`/`to_location` |
| `apps/backend/src/links/inventory-orders-tasks.ts` | `InventoryOrdersModule.linkable.inventoryOrders` (isList) | `TasksModule.linkable.task` (isList, field: 'tasks') |
| `apps/backend/src/links/inventory-orders-internal-payments.ts` | `InventoryOrdersModule.linkable.inventoryOrders` | `InternalPaymentModule.linkable.internalPayments` (isList) |
| `apps/backend/src/links/inventory-order-feedback.ts` | `InventoryOrderModule.linkable.inventoryOrders` (isList, filterable: id/status/order_number) | `FeedbackModule.linkable.feedback` (isList, filterable: id/rating/status/submitted_at) |
| `apps/backend/src/links/inbound-email-inventory-order.ts` | `InboundEmailModule.linkable.inboundEmail` (isList) | `InventoryOrdersModule.linkable.inventoryOrders` (isList) |

---

## Partner-ui order read routes

All routes are under `apps/backend/src/api/partners/`. The partner-ui frontend (`apps/partner-ui/`) calls these via React Query hooks in `apps/partner-ui/src/hooks/api/orders.tsx` and `apps/partner-ui/src/hooks/api/partner-inventory-orders.tsx`.

### Standard order routes (`/partners/orders/...`)

Each is guarded by `validatePartnerOrderOwnership` (`apps/backend/src/api/partners/helpers.ts` lines 212–254) which checks retail via sales channel and work via the D3 partner↔order link.

| Method | Route | File | What it does |
|---|---|---|---|
| GET | `/partners/orders` | `apps/backend/src/api/partners/orders/route.ts` | Lists orders for the authenticated partner. `?kind=` discriminator (`retail`/`design`/`inventory`/`all`, default `retail`). Delegates to `listPartnerOrdersWorkflow` (`apps/backend/src/workflows/orders/list-partner-orders.ts`). `DEFAULT_FIELDS` includes `unified_order_status.partner_status`. Note: uses `relation.*` not `*relation` syntax per comment lines 7–20. |
| GET | `/partners/orders/:id` | `apps/backend/src/api/partners/orders/[id]/route.ts` | Order detail (lines 64–87: attaches `production_runs`, `inventory_orders`, `unified_order_status` via a second `query.graph` call after `getOrderDetailWorkflow` because the admin field set doesn't know about custom links). |
| POST | `/partners/orders/:id` | same file lines 89–135 | PATCH — whitelisted fields only (`email`, `shipping_address`, `billing_address`, `locale`, `metadata`). Metadata is read-then-merged with `PROTECTED_UNIFICATION_METADATA_KEYS` force-restored. |
| POST | `/partners/orders/:id/cancel` | `.../cancel/route.ts` | Cancels via `cancelOrderWorkflow` |
| POST | `/partners/orders/:id/fulfillments` | `.../fulfillments/route.ts` | Creates fulfillment via `createOrderFulfillmentWorkflow` |
| POST | `/partners/orders/:id/fulfillments/:fulfillmentId/cancel` | `.../cancel/route.ts` | Cancels fulfillment via `cancelOrderFulfillmentWorkflow` |
| POST | `/partners/orders/:id/fulfillments/:fulfillmentId/shipment` | `.../shipment/route.ts` | Creates shipment via `createOrderShipmentWorkflow` |
| POST | `/partners/orders/:id/fulfillments/:fulfillmentId/mark-as-delivered` | `.../mark-as-delivered/route.ts` | Marks delivered via `markOrderFulfillmentAsDeliveredWorkflow` |
| GET | `/partners/orders/:id/fulfillments/:fulfillmentId/label` | `.../label/route.ts` | Fetches shipping label (carrier provider `getLabel()`) |
| GET | `/partners/orders/:id/fulfillments/:fulfillmentId/tracking` | `.../tracking/route.ts` | Fetches tracking via carrier `track()` |
| POST | `/partners/orders/:id/fulfillments/:fulfillmentId/pickup` | `.../pickup/route.ts` | Schedules pickup via carrier `schedulePickup()` |
| GET | `/partners/orders/:id/shipping-options` | `.../shipping-options/route.ts` | Lists shipping options |
| GET | `/partners/orders/:id/preview` | `.../preview/route.ts` | Order edit preview |
| GET | `/partners/orders/:id/line-items` | `.../line-items/route.ts` | Line items with variant/product |
| GET | `/partners/orders/:id/changes` | `.../changes/route.ts` | Order changes (edits, claims, exchanges, returns, transfers) |
| POST | `/partners/orders/:id/changes/:changeId` | `.../changes/[changeId]/route.ts` | Update change |
| POST | `/partners/orders/changes/:orderChangeId` | `apps/backend/src/api/partners/orders/changes/[orderChangeId]/route.ts` | Update change by ID (alternative path) |
| POST | `/partners/orders/:id/transfer` | `.../transfer/route.ts` | Request transfer |
| POST | `/partners/orders/:id/transfer/cancel` | `.../transfer/cancel/route.ts` | Cancel transfer request |
| POST | `/partners/orders/:id/credit-lines` | `.../credit-lines/route.ts` | Create credit line |

### Inventory order routes (`/partners/inventory-orders/...`)

These operate on the legacy `InventoryOrder` entity directly. They do NOT go through `validatePartnerOrderOwnership` — they use `getPartnerFromAuthContext` + check the `partner-inventory-order` link.

| Method | Route | File | What it does |
|---|---|---|---|
| GET | `/partners/inventory-orders` | `apps/backend/src/api/partners/inventory-orders/route.ts` | Lists inventory orders for partner via `query.graph` on `partner-inventory-order` link entry point (`InventoryOrderPartnerLink.entryPoint`). Derives `partner_status` from workflow tasks (`sent/received/shipped`). Status and `q` filtering applied in-app via `applyInventoryOrderListFilters` (`apps/backend/src/api/partners/inventory-orders/list-filters.ts`). NOTE: pagination MUST happen after in-app filters — paginating in `query.graph` slices before filters, giving wrong page/count (#484). |
| GET | `/partners/inventory-orders/:orderId` | `apps/backend/src/api/partners/inventory-orders/[orderId]/route.ts` | Detail with `unified_order_id` derived from `inventory_orders.order.id` forward link (lines 244–246). Includes order lines, stock locations, tasks, inventory items, raw materials, line fulfillments, internal payments. Derives partner status from workflow tasks. |
| POST | `/partners/inventory-orders/:orderId/start` | `.../start/route.ts` | Validates Pending → Processing, runs `updateInventoryOrderWorkflow`, completes `partner-order-received` task. |
| POST | `/partners/inventory-orders/:orderId/complete` | `.../complete/route.ts` | Delegates to `partnerCompleteInventoryOrderWorkflow`. |
| POST | `/partners/inventory-orders/:orderId/submit-payment` | `.../submit-payment/route.ts` | Runs `createPaymentAndLinkWorkflow`. |

### Validators and helpers

- `apps/backend/src/api/partners/orders/validators.ts` — Zod schema for `?kind=` (`retail`/`design`/`inventory`/`all`).
- `apps/backend/src/api/partners/inventory-orders/list-filters.ts` — Pure function `applyInventoryOrderListFilters` for in-app status + free-text filtering and pagination.
- `apps/backend/src/api/partners/helpers.ts` — Exports: `refetchPartner`, `getPartnerFromAuthContext`, `validatePartnerStoreAccess`, `getPartnerStore`, `tryGetPartnerStore`, `tryGetPartnerSalesChannelId`, `validatePartnerEntityOwnership`, `validatePartnerOrderOwnership` (dual-scope: retail via sales channel, work via D3 link), `validatePartnerOrderEntityOwnership`, `scopeAndAggregateVariantInventory`, `ensureInventoryLevelsForVariants`, `getPartnerSalesChannelId`.

### AuthenticatedMedusaRequest pattern

All partner routes use `req.auth_context.actor_id` to identify the partner. The route `${orderId}/route.ts` detail route (lines 64–87) uses a bare `try/catch` that swallows `query.graph` failures (lines 82–84: `// leave the order as-is; the UI falls back to retail rendering`).

---

## State / status model

### The unified_order_status vocabulary

Defined at `apps/backend/src/modules/unified_order_status/models/unified-order-status.ts` line 23–29:
`assigned` → `accepted` → `in_progress` → `finished` → `partial` → `completed` → `declined`

This 7-value enum is the shared vocabulary the T3 partner panels key on.

### Inventory order → core order status mapping (kind=inventory)

Defined in `apps/backend/src/workflows/inventory_orders/dual-write-unified-order.ts`:

**`LEGACY_TO_CORE_STATUS`** (lines 41–48):
| Legacy status | core order.status |
|---|---|
| Pending | pending |
| Processing | pending |
| Shipped | pending |
| Partial | pending |
| Delivered | completed |
| Cancelled | canceled |

**`LEGACY_TO_PARTNER_STATUS`** (lines 56–61):
| Legacy status | unified_order_status.partner_status |
|---|---|
| Processing | in_progress |
| Shipped | finished |
| Partial | partial |
| Delivered | completed |

Pending and Cancelled are absent on purpose: "assigned" is stamped by send-to-partner, and the §5 table defines no partner_status for either.

### Production run → core order status mapping (kind=design)

Defined in `apps/backend/src/workflows/production-runs/dual-write-unified-run-order.ts`:

**`RUN_TO_CORE_STATUS`** (lines 35–43):
| Run status | core order.status |
|---|---|
| draft | draft |
| pending_review | draft |
| approved | pending |
| sent_to_partner | pending |
| in_progress | pending |
| completed | completed |
| cancelled | canceled |

**`deriveRunPartnerStatus`** (lines 52–73) — derives partner_status from run lifecycle timestamps:
| Run status + lifecycle | partner_status |
|---|---|
| sent_to_partner | assigned |
| in_progress + finished_at | finished |
| in_progress + started_at | in_progress |
| in_progress + accepted_at | accepted |
| in_progress (self-serve, no timestamps) | in_progress |
| completed | completed |
| cancelled (if declined opt) | declined |
| cancelled (admin) | undefined (no-op) |

### Write sites for partner_status

All 5 write sites use `setUnifiedOrderPartnerStatus` (`apps/backend/src/workflows/inventory_orders/dual-write-unified-order.ts` lines 154–183):
1. `mirrorPartnerLinkOnUnifiedOrderStep` at line 411 — writes `"assigned"` on send-to-partner for inventory
2. `mirrorUnifiedOrderStatusStep` at line 472 — mirrors legacy status transitions
3. `projectRunToUnifiedOrder` at line 341 — writes on create for design runs already in a partner-tracked state
4. `mirrorRunStatusToUnifiedOrder` at line 423 — mirrors run lifecycle transitions
5. `mirrorRunPartnerLinkOnUnifiedOrderStep` at line 536 — writes `"assigned"` on send-to-partner for design

The `setUnifiedOrderPartnerStatus` helper (lines 154–183):
1. Resolves the sidecar row via `query.graph` on `order.unified_order_status.id`
2. If exists, calls `service.updateUnifiedOrderStatuses([{ id, partner_status }])`
3. If not, creates via `service.createUnifiedOrderStatuses` then `remoteLink.create` to link to the order

### Invariant: partial delivery tracking

The `fullfilled_orders` module tracks line-level fulfillment events via `Line_fulfillment` with `event_type` enum and `quantity_delta` (float). The inventory order `status` includes "Partial" which maps to `partner_status = "partial"`. The `quantity_delta` is float because "deliveries are in raw-material units (kg)" per the model comment at `apps/backend/src/modules/fullfilled_orders/models/line_fulfillment.ts` line 6.

---

## Gotchas / invariants

1. **`query.graph` reverse accessors are PLURAL, not singular.** Managed links are bidirectional, but `query.graph` reverse accessors auto-derive as PLURAL (`order.inventory_orders`, `order.production_runs`). The `field: "inventory_order"` pin only affects the Index Module's singular alias, NOT `query.graph`. Using the singular form in `query.graph` gives "Entity 'Order' does not have property 'production_run'". Verified at `apps/backend/src/links/order-production-run.ts` lines 23–30 and `apps/backend/src/links/order-inventory-order.ts` lines 18–31.

2. **Forward link resolution is authoritative for transactional reads.** `query.graph` on `<entity>.order` is synchronous/authoritative. `query.index` is eventually consistent and must never be used for mirror-step correctness. Documented at `apps/backend/src/links/order-production-run.ts` lines 20–22 and `apps/backend/src/links/order-inventory-order.ts` lines 15–16.

3. **Metadata is REPLACED wholesale by `updateOrders`, not merged.** The partner PATCH route at `apps/backend/src/api/partners/orders/[id]/route.ts` lines 110–129 performs an explicit read-then-merge to preserve keys, and `PROTECTED_UNIFICATION_METADATA_KEYS` (defined at `apps/backend/src/workflows/inventory_orders/dual-write-unified-order.ts` lines 28–36) are force-restored so partner input can never overwrite them. This is why `partner_status` was promoted off metadata onto the typed sidecar column (PR-H).

4. **`DEFAULT_FIELDS` in the partner orders list route uses `relation.*` not `*relation` syntax.** The `GET /partners/orders` route at `apps/backend/src/api/partners/orders/route.ts` lines 21–38 explicitly documents (in comments lines 7–20) that `*relation` syntax only works via the admin middleware's `validateAndTransformQuery` which the partner route does NOT run. Without `relation.*` form, `customer`, `sales_channel`, `shipping_address` come back null.

5. **Pagination on inventory-orders list MUST happen after in-app filters.** `query.graph` cannot filter on linked-module columns, so status/`q` are matched in-app. Paginating in `query.graph` slices before filters, returning wrong page count (the #484 bug). Documented at `apps/backend/src/api/partners/inventory-orders/route.ts` lines 174–178 and `apps/backend/src/api/partners/inventory-orders/list-filters.ts` lines 7–12.

6. **`validatePartnerOrderOwnership` dual-scope.** Both scopes must pass for access: retail via sales channel (`order.sales_channel_id === store.default_sales_channel_id`), work via D3 partner↔order link existence. If either matches, access is granted. At `apps/backend/src/api/partners/helpers.ts` lines 212–254.

7. **The `design ↔ order` link is NOT a kind discriminator.** It is shared with retail purchases (`order-placed.ts` runs `linkDesignsToOrder` on every purchase). Only the `order ↔ production_run` and `order ↔ inventory_order` links are discriminators. Documented at `apps/backend/src/links/order-production-run.ts` lines 12–14.

8. **`partner-inventory-order` link binds the partner directly to the inventory order (NOT via the unified core order).** Defined at `apps/backend/src/links/partner-inventory-order.ts`. This is the legacy scoping mechanism. The D3 `partner-order.ts` link (at `apps/backend/src/links/partner-order.ts`) is the unification-era scoping to core Order. Both coexist during transition.

9. **Inventory order model enum has 6 values; constants define 5.** The model at `apps/backend/src/modules/inventory_orders/models/order.ts` lines 8–14 includes "Partial" in the enum, but `apps/backend/src/modules/inventory_orders/constants.ts` defines only `["Pending", "Processing", "Shipped", "Delivered", "Cancelled"]` — "Partial" is missing from the constants.

10. **`quantity_delta` is float, not integer.** The `Line_fulfillment` model at `apps/backend/src/modules/fullfilled_orders/models/line_fulfillment.ts` line 7 is `model.float()` because raw-material quantities (kg) need decimals. The comment notes that an integer column silently rounded 1.5→2 (#342).

11. **Order detail route attaches execution links via a second `query.graph` call,** NOT through the `getOrderDetailWorkflow` fields. At `apps/backend/src/api/partners/orders/[id]/route.ts` lines 64–87: after the workflow resolves, the route makes a separate `query.graph` on `orders` entity requesting `production_runs.id`, `inventory_orders.id`, `unified_order_status.partner_status`. The `getOrderDetailWorkflow`'s field set is the admin order query config which doesn't expand custom links. The second call is best-effort — caught (line 82) so a graph hiccup doesn't break the route.

12. **`setUnifiedOrderPartnerStatus` has a first-write race that is a non-issue in practice.** The create path projection and the single send-to-partner mirror establish the sidecar row before any concurrent transition can run. Documented at `apps/backend/src/workflows/inventory_orders/dual-write-unified-order.ts` lines 149–153.

---

## Open questions / (unverified)

1. **Line fulfillment `quantity_delta` semantics:** The `event_type` enum includes `adjust` and `correction` but the model comment only mentions the integer-rounding fix. How `adjust`/`correction` interact with the inventory order's `Partial` status is not captured in source comments. (unverified)

2. **Inventory order constants file drift:** `apps/backend/src/modules/inventory_orders/constants.ts` omits `"Partial"` from `INVENTORY_ORDER_STATUS` while the model schema allows it. Whether this is intentional (Partial as a transitional/derived state, not a first-class status) or an accident is undocumented.

3. **`fullfilled_orders` module misspelling:** The module name `fullfilled_orders` (double l, double f) appears consistently, including the constant `FULLFILLED_ORDERS_MODULE`. This is the canonical spelling but differs from standard English. No rename is tracked.

4. **Migration count proliferation:** The `inventory_orders` module has 8 migration files and `fullfilled_orders` has 3 — notably more than other modules, suggesting schema churn. Whether all history is still needed or if migrations could be squashed is unaddressed.

5. **`query.index` usage in partner /admin `GET /orders?kind=`:** The admin retail list filter at (unverified — I did not read `apps/backend/src/api/admin/orders/route.ts` in this session) currently uses `query.graph` with an `id: $in`/`$nin` approach, not the Index Module anti-join. The eventual-consistency tradeoff and scaling limits of the injected id array are documented as accepted in `ORDERS_UNIFICATION_342.md` but not verified here.

6. **Partner-order detail route's `unified_order_status` BEST-EFFORT second query could silently miss status on production.** At `apps/backend/src/api/partners/orders/[id]/route.ts` line 82, the catch block is empty — any `query.graph` failure silently drops the status enrichment, and the UI falls back to retail rendering. This is intentional but could mask a production issue where partner_status fails to render.

7. **`fullfilled_orders` has no direct link to Medusa's core `Order` entity.** All its links go through `InventoryOrdersModule`. After the inventory_orders → core Order unification, the fulfillment chain is `order → inventory_order ↔ line_fulfillment` — two hops. Whether a direct `order ↔ line_fulfillment` link is needed is not addressed.
