# Codemap — Shiprocket shipping provider (service surface & wiring)

> Exploration record (2026-06-29). The reusable map of the Shiprocket integration, captured while scoping #772 (wire Shiprocket into partner inventory-order completion). All paths under `apps/backend/`.

## Module layout — `src/modules/shipping-providers/`
- `provider-interface.ts` — shared `ShippingProviderClient` interface (`CreateShipmentInput` 59-89, `ShippingProviderClient` 218-251). Both carriers implement it → resolver abstraction.
- `shiprocket/client.ts` (1-542) — the HTTP client (JWT auth + endpoints).
- `shiprocket/service.ts` (1-234) — Medusa fulfillment-provider service; `createFulfillment` (104-209) maps a Medusa fulfillment → Shiprocket shipment and persists refs.
- `delhivery/service.ts` — contrast carrier: single-carrier, `create.json` returns waybill + assigns in one call, explicit `cod_amount`, API-key auth (no JWT expiry). Same interface.

## ShiprocketClient API surface (`shiprocket/client.ts`)
| Method | Line | Notes |
|---|---|---|
| `authenticate()` | 207-227 | JWT (email/password), ~10-day TTL, transparent 401-retry |
| `createShipment(input)` | 304-404 | **3-step**: POST `/orders/create/adhoc` (→ `shipment_id`) → POST `/courier/assign/awb` (optional `courier_id`) → POST `/courier/generate/label` (→ `label_url`, best-effort). Returns unified `ShipmentResult` {awb, tracking_number, tracking_url, label_url, provider_refs} |
| `getLabel(ref)` | 406-416 | fetch label by `shipment_id` (label may be generated later) |
| `track(ref)` | 418-433 | by AWB or `shipment_id` |
| `cancelShipment(ref)` | 435-445 | by `sr_order_id` |
| `schedulePickup(input)` | 447-463 | |
| `registerPickupLocation(input)` | 465-487 | register warehouse/pickup |
| `listPickupLocations()` | 494-500 | with `shippable` status |
| `getRates(query)` | 269-297 | courier options for a lane |
| `checkServiceability(pin)` | 262-267 | stubbed |
| `normalizeWebhook(payload)` | 503-519 | parse tracking webhook |

## Persistence (today, for Medusa Order fulfillments)
- `service.ts:185-204` — `createFulfillment` writes onto the Medusa `fulfillment.data`:
  `{ carrier: "shiprocket", waybill: awb, tracking_number, ...provider_refs (sr_order_id, shipment_id, courier_company_id), ...raw }` and `labels: [{ tracking_number, tracking_url, label_url }]`.
- Updated via `fulfillmentModule.updateFulfillment()`.

## Admin trigger routes (#404 label-first MVP)
- `POST /admin/orders/:id/fulfillments/:fulfillmentId/shiprocket-shipment` — `src/api/admin/orders/[id]/fulfillments/[fulfillmentId]/shiprocket-shipment/route.ts`; calls `createShiprocketShipmentForFulfillment()` (`src/workflows/orders/shiprocket-shipment.ts:120-235`). Body: `pickup_location_name?, weight_grams?, dimensions_cm?, preferred_courier_id?`.
- `POST /admin/orders/:id/shiprocket-label` — Design-Orders convenience; `ensureOrderFulfillment()` then `createShiprocketShipmentForFulfillment()`. Body: `preferred_courier_id?`.
- `GET /admin/orders/:id/fulfillments/:fulfillmentId/label` — fetch cached/manual label; delegates to `provider.getLabel()` for Shiprocket.

## Pickup-location resolution
- Resolved from the stock location metadata key `SHIPROCKET_PICKUP_METADATA_KEY` = `"shiprocket_pickup_location"` (`shiprocket-shipment.ts:163-171` queries `stock_location` by `fulfillment.location_id`, reads `metadata.shiprocket_pickup_location`). Register via `registerPickupLocation()` if missing.
- **First-time bootstrap pattern (for #772 / partner-created shipments)**: `listPickupLocations()` → if the partner/stock-location pickup name isn't present, follow-up `registerPickupLocation()` from the source address, then persist the name into `stock_location.metadata.shiprocket_pickup_location` so later shipments skip it. Registration is async server-side (pickup may show non-`shippable` briefly) — surface that, don't hard-fail. If the source address itself is missing, block with an "add pickup address" error before calling Shiprocket.

## `CreateShipmentInput` shape (`provider-interface.ts:59-89`)
`reference_id`, `pickup_location_name`, `to` {name, phone, address_1, city, postal_code, province, country}, `items[]`, `weight_grams`, `dimensions_cm`, `sub_total`, `payment_mode` (prepaid/COD), preferred courier, etc.

## Key gotchas
- Shiprocket needs a **pre-registered pickup location name** — you can't pass a raw from-address; register it (or map the stock location's metadata key) first.
- `createShipment` is multi-call; label generation is best-effort and may need a follow-up `getLabel()`.
- JWT expires (~10 days) — the client auto-reauths on 401.
- Today only **Medusa core Order** fulfillments flow through this. **Inventory orders use a custom `line_fulfillments` module — NO core fulfillment record** — so the inventory-order wiring must either create a core fulfillment or extend `line_fulfillment` to carry carrier refs (see #772).

Related: #404 (admin Shiprocket/Delhivery MVP), #649 (global shipping-provider abstraction), #772 (inventory-order completion wiring).
</content>
