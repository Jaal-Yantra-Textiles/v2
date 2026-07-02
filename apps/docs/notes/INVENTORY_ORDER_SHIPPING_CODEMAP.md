# Inventory-Order Shipping Codemap (2026-06-29)

Backs the leftover **shipping-creation UI** work: let partners (and admins)
create the Shiprocket shipment when an order is "ready for delivery". Companion
to `INVENTORY_IMAGE_IMPORT_AND_FLOWS_CODEMAP.md` + `SHIPROCKET_PROVIDER_CODEMAP.md`.

All paths under `apps/backend/` unless noted. Read-only map; nothing here is a
recommendation yet.

## 1. Shipment-creation backend (#772, merged in PR #777)

- **Workflow:** `src/workflows/inventory_orders/create-inventory-order-shipment.ts`
  - `createInventoryOrderShipmentWorkflow` (L149), imperative `createInventoryOrderShipment` (L52), step `createInventoryOrderShipmentStep` (L141).
  - **Input** `CreateInventoryOrderShipmentInput` (L37-50): `{ orderId, carrier?="shiprocket", pickupStockLocationId?, weightGrams?, dimensionsCm?, preferredCourierId?, deliveredQuantities?, actingEmail? }`.
  - **Persists** to `inventory_order.metadata` (L121-136): `partner_tracking_number` (= tracking_number||awb) + `metadata.shipment = { carrier, awb, tracking_number, tracking_url?, label_url?, provider_refs?, created_at }`.
- **Builder (pure):** `src/workflows/inventory_orders/lib/inventory-order-shipment.ts`
  - `buildInventoryOrderShipmentInput` (L60); `DEFAULT_INVENTORY_SHIPMENT_WEIGHT_GRAMS = 500` (L22); types `InventoryOrderLineForShipment`, `InventoryOrderForShipment`, `BuildInventoryShipmentOpts`.

## 2. There is NO standalone "create shipment" endpoint

Shipment creation today is **inline in the partner complete route only**, gated by `generate_shipment`:
- `src/api/partners/inventory-orders/[orderId]/complete/route.ts:201-226` — runs `createInventoryOrderShipmentWorkflow` AFTER completion succeeds, `throwOnError:false` (non-fatal → `shipment_error`).
- Body schema (L115-139): `{ notes?, deliveryDate?/delivery_date?, trackingNumber?/tracking_number?, stock_location_id?/stockLocationId?, lines:[{order_line_id,quantity}] (required), generate_shipment?, pickup_stock_location_id?, weight_grams?, dimensions_cm?{length,breadth,height}, preferred_courier_id? }`.
- Response (L228-233): `{ message, result:{fullyFulfilled}, shipment?, shipment_error? }`.

Other partner routes: `POST /partners/inventory-orders` (list/create), `GET …/[orderId]`, `…/start`, `…/complete`, `…/submit-payment`.
Admin inventory-order routes have **no** shipment route (only cancel, send-to-partner, tasks, feedbacks, order-lines).

**Implication:** to give partner+admin an independent "Create shipment" action (decoupled from completion), add a **new standalone endpoint** (e.g. `POST /partners/inventory-orders/[orderId]/shipment` + admin `POST /admin/inventory-orders/[id]/shipment`) that calls the existing `createInventoryOrderShipmentWorkflow`. The workflow is already endpoint-agnostic.

## 3. Partner inventory-order UI (`apps/partner-ui/`)

- **Complete modal** (most natural home for a shipment toggle/action today):
  `apps/partner-ui/src/routes/inventory-orders/inventory-order-complete/inventory-order-complete.tsx` (L22-342) — Notes, Delivery Date, Tracking Number, per-line qty, "Fill All Remaining" (L251). **No shipment UI yet.**
- **Hooks:** `apps/partner-ui/src/hooks/api/partner-inventory-orders.tsx`
  - `useCompletePartnerInventoryOrder(orderId)` (L181-206) → `POST …/complete`. Payload type `PartnerCompleteInventoryOrderPayload` (L58-67) — needs shipment fields added.
  - `usePartnerInventoryOrder(orderId)` (L123-152) → `GET …/[orderId]`.
  - `useStartPartnerInventoryOrder(orderId)` (L154-179) → `POST …/start`.
- **Detail/redirect page:** `apps/partner-ui/src/routes/inventory-orders/inventory-order-redirect/inventory-order-redirect.tsx`.
- **Start modal:** `apps/partner-ui/src/routes/inventory-orders/inventory-order-start/inventory-order-start.tsx`.

## 4. Admin inventory-order UI (`apps/backend/src/admin/`)

- **Detail page:** `src/admin/routes/orders/inventory/[id]/page.tsx` (L14-63) — sections: ID, General, Feedbacks, Lines, Tasks, StockLocation, Payments.
- **General section (status + actions):** `src/admin/components/inventory-orders/inventory-order-general-section.tsx` (L14-102). Status badge via `getPartnerWorkStatus()`+`getStatusBadgeColor()` (L62-74). Action menu (L46-59): Edit / Send to Partner / Delete. **No shipment action** — natural place to add "Create shipment".
- **Hooks:** `src/admin/hooks/api/inventory-orders.ts` — `useInventoryOrder` (L99), `useInventoryOrders` (L124), `useCreateInventoryOrder` (L146), `useUpdateInventoryOrder` (L164), `useDeleteInventoryOrder` (L204), `useSendInventoryOrderToPartner` (L222). Add a `useCreateInventoryOrderShipment` for the new endpoint.
- Work-status labels: `src/admin/lib/work-status.ts:13-21` (assigned, accepted, in_progress, partial, finished, completed, declined).

## 5. Status model + where "ready for delivery" fits

- **Enum:** `src/modules/inventory_orders/models/order.ts:8-15` — `Pending, Processing, Shipped, Delivered, Cancelled, Partial`. **No "ready for delivery" status.**
- **Transitions:** `src/workflows/inventory_orders/update-inventory-order.ts:50-124` — `updateInventoryOrderStep` (L70-112) validates + emits `inventory_orders.inventory-order.status-changed` `{id,previous_status,status}` (L22) on real change + mirrors to unified order (L121).
- **Who sets Shipped/Partial:** `src/workflows/inventory_orders/partner-complete-inventory-order.ts` — requires order in `Processing|Partial` (L249) and `partner_status ∈ {started,partial}` (L253); sets `Shipped` if fully fulfilled else `Partial` (L374); sets `partner_status` metadata = `completed|partial` (L350); appends `partner_delivery_history` (L355). Fulfillment entries + destination stock posting L140-219 / L580-699; shortage task L531-578.
- **"Ready for delivery" today = informal:** status `Shipped` + `metadata.partner_status="completed"`. No dedicated flag. **Decision pending:** model it as a new status / metadata flag / task, OR treat "create shipment" as available whenever order is `Processing`/`Partial`/`Shipped`.

## Build implications (for the leftover UI)

1. **Backend:** add a standalone shipment endpoint (partner + admin) wrapping `createInventoryOrderShipmentWorkflow` — IDOR-guard the partner one (mirror `assertPartnerOwnsInventoryOrder`).
2. **Partner UI:** "Create shipment" action (modal: pickup location, weight, dims, courier) on the complete modal and/or detail page; new hook.
3. **Admin UI:** "Create shipment" action in the general-section menu; new `useCreateInventoryOrderShipment` hook.
4. **Data-plumbing:** if a shipment-related visual flow is wanted, add an installer job mirroring `install-inventory-order-status-flow` (#788).
5. **Decision to lock first:** is "ready for delivery" a new status, or just a UI affordance gated on existing status? And do partner+admin share one endpoint shape (per `feedback_partner_api_mirrors_admin`)?

## LOCKED DECISIONS (2026-06-29) — tracked as #790

- **"Ready for Delivery" is a NEW first-class status** on the enum (not metadata).
  Flow: `Processing` → **`Ready for Delivery`** → create shipment → `Shipped` →
  `Delivered`. Adding it requires a hand-written **idempotent ALTER migration**
  (drop/re-add the status check constraint — mirror the Newsletter `page_type`
  pattern; never edit a create-table migration) + syncing EVERY status union
  (model, validators, workflows, service, admin work-status + page + visual-flows
  metadata route, partner-ui types, and the #788 flow label map).
- **Partner + admin get a standalone shipment endpoint** (`POST …/[id]/shipment`),
  same shape both sides (per `feedback_partner_api_mirrors_admin`), wrapping the
  existing `createInventoryOrderShipmentWorkflow`. Partner side IDOR-guarded.
- Build NOT started — handed off on #790 for a later session.
