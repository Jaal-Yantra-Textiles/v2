# 404 — Shipping-Providers Module Analysis

## Purpose

The shipping-providers module (`apps/backend/src/modules/shipping-providers/`) registers six carriers as Medusa fulfillment providers (Shiprocket, Delhivery, DHL, UPS, FedEx, AusPost) via `ModuleProvider(Modules.FULFILLMENT)`. It provides a normalised `ShippingProviderClient` interface (`apps/backend/src/modules/shipping-providers/provider-interface.ts:210`) so the admin and partner surfaces can drive any carrier through the same contract (`createShipment`, `getLabel`, `track`, `cancelShipment`, `schedulePickup`, `registerPickupLocation`, `listPickupLocations`), plus a resolver (`apps/backend/src/modules/shipping-providers/resolver.ts:111`) that sources carrier credentials from the encrypted `SocialPlatform` external-platform store or env-var fallbacks.

The module works alongside two workflow-driven admin flows (Shiprocket only, not Delhivery at this point): "convert design order → create shipment → label" and "attach existing AWB". Neither Shiprocket nor Delhivery has an on-label-generation endpoint exposed as a dedicated admin route as of the read code.

---

## Provider Registry & the Two Carriers

### Registry entry

The module is registered in `apps/backend/src/modules/shipping-providers/index.ts:9`:

```
ModuleProvider(Modules.FULFILLMENT, {
  services: [
    DelhiveryFulfillmentService,
    ShiprocketFulfillmentService,
    DHLExpressFulfillmentService,
    UPSFulfillmentService,
    FedExFulfillmentService,
    AusPostFulfillmentService,
  ],
})
```

### Normalised interface

`apps/backend/src/modules/shipping-providers/provider-interface.ts:210` — `ShippingProviderClient` contract:

| Method | Optional? | Signature |
|--------|-----------|----------|
| `checkServiceability` | Yes | `(destinationPincode: string) => Promise<boolean>` |
| `getRates` | Yes | `(query: RateQuery) => Promise<RateOption[]>` |
| `createShipment` | No | `(input: CreateShipmentInput) => Promise<ShipmentResult>` |
| `getLabel` | No | `(ref: ShipmentRef) => Promise<LabelResult>` |
| `track` | No | `(ref: ShipmentRef) => Promise<TrackingResult>` |
| `cancelShipment` | No | `(ref: ShipmentRef) => Promise<{ success: boolean; raw?: any }>` |
| `schedulePickup` | Yes | `(input: SchedulePickupInput) => Promise<SchedulePickupResult>` |
| `registerPickupLocation` | Yes | `(input: RegisterPickupLocationInput) => Promise<{ name: string; raw?: any }>` |
| `listPickupLocations` | Yes | `() => Promise<PickupLocation[]>` |

Known `CarrierId` values: `"delhivery" | "shiprocket"` (line 246).

### Shared types

- `apps/backend/src/modules/shipping-providers/types.ts:1` — `ShippingLabel`, `ShipmentResult`, `RateResult` (legacy types; the normalised interface uses the richer types in `provider-interface.ts`).
- `apps/backend/src/modules/shipping-providers/provider-interface.ts` — `CreateShipmentInput`, `ShipmentRef`, `ShipmentResult`, `LabelResult`, `TrackingResult`, `TrackingEvent`, `PickupLocation`, `RateQuery`, `RateOption`, `SchedulePickupInput`, `RegisterPickupLocationInput`.

---

### Shiprocket

**Files:**
- `apps/backend/src/modules/shipping-providers/shiprocket/index.ts` — `ModuleProvider` registration with `services: [ShiprocketFulfillmentService]`.
- `apps/backend/src/modules/shipping-providers/shiprocket/service.ts` — Medusa `AbstractFulfillmentProviderService`, identifier `"shiprocket"` (line 27).
- `apps/backend/src/modules/shipping-providers/shiprocket/client.ts` — `ShippingProviderClient` implementation (`ShiprocketClient`, line 180). Full normalised interface.

**Credentials (`apps/backend/src/modules/shipping-providers/shiprocket/client.ts:31`):**
```
ShiprocketOptions = {
  email: string        // Shiprocket login email
  password: string     // Shiprocket login password
  pickup_location?: string  // default pickup location nickname
  token?: string       // pre-authenticated token (skip login round-trip)
}
```
Auth: JWT via `POST /auth/login` with 10-day TTL (line 196 `authenticate`), transparent re-login on 401 (line 220 `request`). The resolver at `apps/backend/src/modules/shipping-providers/resolver.ts:144` reads `email`, `password`, and `pickup_location` from the platform record (falls back to `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, `SHIPROCKET_PICKUP_LOCATION` env vars).

**Capabilities (`apps/backend/src/modules/shipping-providers/shiprocket/client.ts`):**

| Capability | Method | Endpoint(s) |
|-----------|--------|-------------|
| Create shipment + AWB + label | `createShipment` (line 292) | Sequences: `POST /orders/create/adhoc` → `POST /courier/assign/awb` → `POST /courier/generate/label` |
| Get shipping rates | `getRates` (line 257) | `GET /courier/serviceability/` |
| Fetch label | `getLabel` (line 389) | `POST /courier/generate/label` |
| Tracking | `track` (line 401) | `GET /courier/track/awb/{awb}` or `GET /courier/track/shipment/{shipment_id}` |
| Cancel | `cancelShipment` (line 418) | `POST /orders/cancel` |
| Schedule pickup | `schedulePickup` (line 430) | `POST /courier/generate/pickup` |
| Register pickup location | `registerPickupLocation` (line 448) | `POST /settings/company/addpickup` |
| List pickup locations | `listPickupLocations` (line 477) | `GET /settings/company/pickup` |
| Normalize webhook | `normalizeWebhook` (line 486) | N/A — transforms inbound tracking push |

**COD:** `createShipment` sets `payment_method: "COD"` when `input.payment_mode === "cod"` and passes `sub_total` as the order value (line 328 `createBody.payment_method`, line 329 `sub_total`). `cod_amount` is NOT sent explicitly to Shiprocket in the adhoc body — Shiprocket derives it from `sub_total` per the interface header comment at `provider-interface.ts:13`.

**Shipment creation flow (3-step sequence inside `createShipment`, line 292):**
1. `POST /orders/create/adhoc` — creates order, returns `order_id` + `shipment_id`
2. `POST /courier/assign/awb` — assigns AWB to the shipment (optionally forces a `courier_company_id`)
3. `POST /courier/generate/label` — generates label URL (best-effort; failure caught at line 368, label fetchable later via `getLabel`)

**Error handling:** `ShiprocketApiError` extends `MedusaError` (line 47) so errors surface with correct HTTP status (401/403 → 403, 400-499 → 400, 500+ → 500). Per-field error bags from 422 responses are parsed by `parseShiprocketError` (line 81).

---

### Delhivery

**Files:**
- `apps/backend/src/modules/shipping-providers/delhivery/index.ts` — `ModuleProvider` registration with `services: [DelhiveryFulfillmentService]`.
- `apps/backend/src/modules/shipping-providers/delhivery/service.ts` — Medusa `AbstractFulfillmentProviderService`, identifier `"delhivery"` (line 17). Exposes an additional `registerWarehouse` method (line 32) that is NOT on the normalised `ShippingProviderClient` interface — it is called directly via `fulfillmentService.retrieveProviderRegistration` during store creation.
- `apps/backend/src/modules/shipping-providers/delhivery/client.ts` — Raw API client (`DelhiveryClient`, line 16). NOT a `ShippingProviderClient`.
- `apps/backend/src/modules/shipping-providers/delhivery/adapter.ts` — `ShippingProviderClient` adapter (`DelhiveryProviderAdapter`, line 34) wrapping `DelhiveryClient`.

**Credentials (`apps/backend/src/modules/shipping-providers/delhivery/client.ts:4`):**
```
DelhiveryOptions = {
  api_token: string   // Delhivery API token
  sandbox?: boolean   // if true → staging-express.delhivery.com else track.delhivery.com
}
```
Auth: Static token in `Authorization: Token {api_token}` header (line 27). The resolver at `apps/backend/src/modules/shipping-providers/resolver.ts:126` reads `api_key`, `api_token`, or `access_token` from the platform record (falls back to `DELHIVERY_API_TOKEN` env var); `DELHIVERY_SANDBOX` env var for sandbox mode.

**Capabilities (`apps/backend/src/modules/shipping-providers/delhivery/adapter.ts` — the normalised interface):**

| Capability | Method | Underlying client call |
|-----------|--------|----------------------|
| Create shipment (waybill auto-assigned) | `createShipment` (line 64) | `client.createShipment({ waybill: "" })` → `POST /api/cmu/create.json` |
| Check serviceability | `checkServiceability` (line 42) | `GET /c/api/pin-codes/json/` |
| Get rates | `getRates` (line 47) | `client.calculateShippingCost()` → `GET /api/kinko/v1/invoice/charges/.json` |
| Fetch label | `getLabel` (line 106) | `client.getLabel(waybill)` → `GET /api/p/packing_slip` |
| Tracking | `track` (line 116) | `client.trackShipment(waybill)` → `GET /api/v1/packages/json/` |
| Cancel | `cancelShipment` (line 154) | `client.cancelShipment(waybill)` → `POST /api/p/edit` |
| Schedule pickup | `schedulePickup` (line 161) | `client.schedulePickup()` → `POST /fm/request/new/` |
| Register pickup location (warehouse) | `registerPickupLocation` (line 174) | `client.registerWarehouse()` → `POST /api/backend/clientwarehouse/create/` |
| List pickup locations | Not implemented | (unverified — `DelhiveryProviderAdapter` has no `listPickupLocations`) |

**COD:** `createShipment` sets `payment_mode: "COD"` and passes `cod_amount` explicitly when `input.payment_mode === "cod"` (adapter.ts:76). The service.ts `createFulfillment` at line 258 defaults to `"Pre-paid"` even for COD orders (note: commented `"Pre-paid"` fallback at line 261 — `// Default to Pre-paid; COD requires explicit setup`). This means the Delhivery **service** (used via Medusa's fulfillment flow) hardcodes Pre-paid; COD must be driven through the adapter/resolver path.

**Warehouse registration:** `apps/backend/src/modules/shipping-providers/delhivery/client.ts:103` `registerWarehouse` — calls `POST /api/backend/clientwarehouse/create/`. Only one active pickup per warehouse at a time (line 151 comment). The name must be used exactly (case-sensitive) in future API calls (line 101 comment). Triggered during store creation at `apps/backend/src/workflows/stores/create-store-with-defaults.ts:335`, which stores the name on `stock_location.metadata.delhivery_warehouse_name`.

**Sanitization:** `sanitizeAddress` at `apps/backend/src/modules/shipping-providers/delhivery/client.ts:12` strips `&`, `#`, `%`, `;`, `\` characters to avoid API errors.

**Response parsing:** `safeJson` at `apps/backend/src/modules/shipping-providers/delhivery/client.ts:36` handles Delhivery's occasional XML responses by falling back to `{ raw: text }`.

---

## Admin Entry Points

### Shiprocket-specific admin routes

| Route | File | Method | Purpose |
|-------|------|--------|---------|
| `POST /admin/orders/:id/shiprocket-label` | `apps/backend/src/api/admin/orders/[id]/shiprocket-label/route.ts:21` | POST | One-click: ensure fulfillment + create Shiprocket shipment + label for converted orders |
| `POST /admin/orders/:id/shiprocket-attach-awb` | `apps/backend/src/api/admin/orders/[id]/shiprocket-attach-awb/route.ts:20` | POST | Attach an **existing** Shiprocket AWB (read-only lookup, no new shipment) |
| `POST /admin/orders/:id/fulfillments/:fulfillmentId/shiprocket-shipment` | `apps/backend/src/api/admin/orders/[id]/fulfillments/[fulfillmentId]/shiprocket-shipment/route.ts:30` | POST | Create Shiprocket shipment for a specific pre-existing fulfillment |
| `GET /admin/orders/:id/fulfillments/:fulfillmentId/label` | `apps/backend/src/api/admin/orders/[id]/fulfillments/[fulfillmentId]/label/route.ts:17` | GET | Fetch label for a fulfillment (via resolver, falls back to stored data) |
| `GET /admin/stock-locations/:id/shiprocket-pickup` | `apps/backend/src/api/admin/stock-locations/[id]/shiprocket-pickup/route.ts:40` | GET | Check Shiprocket pickup registration status for a stock location |
| `POST /admin/stock-locations/:id/shiprocket-pickup` | `apps/backend/src/api/admin/stock-locations/[id]/shiprocket-pickup/route.ts:45` | POST | Register a stock location as a Shiprocket pickup point (idempotent) |

### Partner shipping routes (use resolver — carrier-agnostic)

| Route | File | Method | Purpose |
|-------|------|--------|---------|
| `POST /partners/fulfillments/:id/shipment` | `apps/backend/src/api/partners/fulfillments/[id]/shipment/route.ts:5` | POST | Create fulfillment shipment (core Medusa workflow) |
| `GET /partners/orders/:id/fulfillments/:fulfillmentId/label` | `apps/backend/src/api/partners/orders/[id]/fulfillments/[fulfillmentId]/label/route.ts:10` | GET | Fetch label via resolver (carrier-agnostic) |
| `GET /partners/orders/:id/fulfillments/:fulfillmentId/tracking` | `apps/backend/src/api/partners/orders/[id]/fulfillments/[fulfillmentId]/tracking/route.ts:10` | GET | Fetch tracking via resolver (carrier-agnostic; falls back to fulfillment timestamps for manual) |
| `POST /partners/orders/:id/fulfillments/:fulfillmentId/pickup` | `apps/backend/src/api/partners/orders/[id]/fulfillments/[fulfillmentId]/pickup/route.ts:10` | POST | Schedule pickup via resolver; Delhivery requires `warehouseName` from `location.metadata.delhivery_warehouse_name` |

---

## Order → Shipment → Label Flow

### Convert design order → create shipment → label (the "PR-B" flow)

1. **Convert** — `apps/backend/src/workflows/designs/convert-design-order.ts:84` `convertDesignOrderToOrder` turns a cart+line-item into a real order: creates a draft order, optionally marks payment captured (prepaid) or leaves unpaid (COD), converts to pending. Stamps `metadata.payment_mode` on the order metadata (line 211). Prepaid orders get `payment_status=captured`. The cartless draft has no shipping method.

2. **Ensure fulfillment** — `apps/backend/src/workflows/orders/fulfillment-context.ts:64` `ensureOrderFulfillment`: reuses an existing Shiprocket-fulfillment if present; otherwise creates a plain fulfillment against the **MANUAL** provider (NOT Shiprocket, to avoid side effects — see comment at line 24). Resolves a manual shipping option via `resolvePlainFulfillmentContext` (line 27).

3. **Create Shiprocket shipment** — `apps/backend/src/workflows/orders/shiprocket-shipment.ts:113` `createShiprocketShipmentForFulfillment`:
   - Loads order + fulfillment via `query.graph`.
   - Resolves pickup nickname: explicit → stock-location metadata `shiprocket_pickup_location` (line 161) → client default.
   - Calls `buildCreateShipmentInput` (line 56) which reads `order.metadata.payment_mode` → sets `payment_mode` and `cod_amount` (line 81).
   - Calls `provider.createShipment(input)` (line 180) — the 3-step Shiprocket flow.
   - Persists carrier refs (`waybill`, `tracking_number`, `shipment_id`, `sr_order_id`, `provider_refs`) onto `fulfillment.data` via `fulfillmentModule.updateFulfillment` (line 183).

4. **Fetch label** — `GET /admin/orders/:id/fulfillments/:fulfillmentId/label` (`apps/backend/src/api/admin/orders/[id]/fulfillments/[fulfillmentId]/label/route.ts:17`): reads `fulfillment.data.waybill`, resolves the carrier via `resolveShippingProvider`, calls `provider.getLabel()`, returns `label_url` + `packing_slip`. Falls back to stored `fulfillment.labels[0]` for non-carrier fulfillments.

### Attach existing AWB (the "#437" flow)

`apps/backend/src/workflows/orders/shiprocket-attach-awb.ts:57` `attachExistingShiprocketAwb`:
- Validates the AWB by calling `provider.track({ awb })` (read-only).
- Stamps carrier refs onto `fulfillment.data` with `attached_existing: true`.
- Auto-syncs fulfillment state via `deriveFulfillmentState` (line 36): Shiprocket code 7 → `"delivered"`, 6/42 → `"shipped"`, else text-based fallback. Runs `createOrderShipmentWorkflow`/`markOrderFulfillmentAsDeliveredWorkflow` (both best-effort).

### Delhivery — Medusa fulfillment flow

Through `DelhiveryFulfillmentService.createFulfillment` (`apps/backend/src/modules/shipping-providers/delhivery/service.ts:165`):
- Called by Medusa core's `createOrderFulfillmentWorkflow` when a shipping option uses the Delhivery provider.
- Weight/dimensions from variant data on order line items; falls back to quantity-based bracket estimation (service.ts:226-236).
- Uses `fromLocation.metadata.delhivery_warehouse_name` or fallback (service.ts:252).
- Hardcodes `payment_mode: "Pre-paid"` even for COD (service.ts:259-261) — COD via the normal flow is **not supported**.
- Returns `data: { waybill, tracking_number, carrier: "delhivery", pickup_location_name, ...result }` and `labels[0]` with tracking URL.
- The service also exposes `registerWarehouse` (line 32) used during store creation.

---

## COD Handling

### In the normalised interface

`provider-interface.ts:63-64` — `CreateShipmentInput.cod_amount` is required when `payment_mode === "cod"`.

### Shiprocket

- **Conversion:** `convert-design-order.ts:211` stamps `metadata.payment_mode: "cod"`. Prepaid gets `payment_status=captured` (line 248); COD stays `not_paid` (line 233 comment: "cod → skip; the order stays not_paid and is reconciled later via Shiprocket remittance (P4 decision)").
- **Shipment input:** `buildCreateShipmentInput` at `shiprocket-shipment.ts:61` reads `order.metadata.payment_mode === "cod"` → sets `payment_mode: "cod"`, `cod_amount: order.total`.
- **Client:** `createShipment` at `client.ts:328` sets `payment_method: "COD"` when `payment_mode === "cod"`. The Shiprocket API derives COD amount from `sub_total` (no explicit `cod_amount` field in the adhoc body per `provider-interface.ts:13`).

### Delhivery

- **Adapter:** `createShipment` at `adapter.ts:75` sets `payment_mode: "COD"` and passes `cod_amount` explicitly when `input.payment_mode === "cod"`.
- **Service (Medusa flow):** `createFulfillment` at `service.ts:258` hardcodes `payment_mode: "Pre-paid"` — COD is NOT supported through the Medusa fulfillment flow. The adapter/resolver path must be used for COD shipments.

---

## Api Config / Credentials per Provider

The resolver `apps/backend/src/modules/shipping-providers/resolver.ts:111` sources credentials from the `SocialPlatform` external-platform store (`category: "shipping"`, `status: "active"`), matched case-insensitively by `api_config.provider_type`, `api_config.provider`, or platform `name` (line 93-98).

| Carrier | Fields read from `api_config` | Direct env-var fallback |
|---------|------------------------------|------------------------|
| Shiprocket | `email`, `username`, `password` (prefers `password_encrypted`), `pickup_location` | `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, `SHIPROCKET_PICKUP_LOCATION` |
| Delhivery | `api_key`, `api_token`, `access_token` (prefers `*_encrypted`), `mode` (test/live) | `DELHIVERY_API_TOKEN`, `DELHIVERY_SANDBOX` |

The decryption helper (`readSecret` line 65) prefers `<field>_encrypted` blobs decrypted via `EncryptionService`; falls through to plaintext `<field>`.

`apps/backend/src/modules/shipping-providers/resolver.ts:28` — `SUPPORTED_CARRIERS = ["delhivery", "shiprocket"]`.

`apps/backend/src/modules/shipping-providers/resolver.ts:36` `isSupportedCarrier` — used by the label/tracking/pickup admin/partner routes to gate whether to drive a carrier client or return stored data.

---

## Pickup-Location Registration

`apps/backend/src/modules/shipping-providers/pickup-locations.ts`:
- `registerShiprocketPickup` (line 95): idempotent — lists existing Shiprocket pickups first, skips add if nickname exists. Stores nickname on `stock_location.metadata.shiprocket_pickup_location`. Requires `phone` and `postal_code` on the location address (line 133). Called during store creation (best-effort at `create-store-with-defaults.ts:372`) and on-demand via `POST /admin/stock-locations/:id/shiprocket-pickup`.
- `pickupNicknameForLocation` (line 33): deterministic `warehouse-{last 8 chars of locationId}` (same scheme as Delhivery).
- `getShiprocketPickupStatus` (line 201): read-only status query (no registration side-effects).
- Deterministic nickname scheme (`warehouse-<last8>`) is shared with Delhivery's `warehouse-<suffix>` naming (`create-store-with-defaults.ts:315`).

---

## Gotchas / Invariants

1. **Delhivery `createFulfillment` hardcodes Pre-paid** (`apps/backend/src/modules/shipping-providers/delhivery/service.ts:259`). COD shipments routed through the Medusa fulfillment flow will be sent as Pre-paid. Use the adapter/resolver path instead.

2. **Shiprocket label generation is best-effort during `createShipment`** (`apps/backend/src/modules/shipping-providers/shiprocket/client.ts:363-371`). If the label API fails (rare — takes a moment to generate), the shipment still succeeds. Label can be fetched later via `getLabel` (which re-calls the same endpoint).

3. **Shiprocket AWB is assigned in a separate step** (`createShipment` at `client.ts:354`). The adhoc order must be created first; only then is an AWB assigned.

4. **Manual provider as fulfillment intermediary** (`fulfillment-context.ts:24`): converted orders have no shipping method, so `ensureOrderFulfillment` creates the plain fulfillment against a MANUAL provider. Carrier data is stamped onto `fulfillment.data` out-of-band. This avoids `createFulfillment` on the Shiprocket provider (which would create a duplicate Shiprocket shipment).

5. **Idempotent fulfillment reuse** (`fulfillment-context.ts:99-101`): `ensureOrderFulfillment` reuses an existing Shiprocket-stamped fulfillment (prefers one with `data.carrier === "shiprocket"`, else the newest non-canceled). This prevents pile-ups from retries.

6. **Order quantity field caveat** (`fulfillment-context.ts:75-77`): `items.quantity` is computed from `raw_quantity` and does NOT populate when selected by name. The workflow reads `items.detail.quantity` instead.

7. **Delhivery `safeJson`** (`apps/backend/src/modules/shipping-providers/delhivery/client.ts:36`): the client handles Delhivery's occasional XML responses (auth errors, warehouse ops, cancel) by falling back.

8. **Delhivery address sanitization** (`apps/backend/src/modules/shipping-providers/delhivery/client.ts:12`): strips `&`, `#`, `%`, `;`, `\` characters — these cause API errors.

9. **Pickup nickname scheme shared** (`apps/backend/src/modules/shipping-providers/pickup-locations.ts:33`, `create-store-with-defaults.ts:315`): both Shiprocket and Delhivery use `warehouse-{last8}` by convention. A stock location registered for one is already named for both.

10. **`DelhiveryFulfillmentService.registerWarehouse`** (`apps/backend/src/modules/shipping-providers/delhivery/service.ts:32`) is NOT part of the `ShippingProviderClient` interface. It is resolved separately via `fulfillmentService.retrieveProviderRegistration("delhivery_delhivery")` during store creation (`create-store-with-defaults.ts:320`).

11. **Shiprocket pickup OTP handling** (`apps/backend/src/modules/shipping-providers/shiprocket/client.ts:134-159` `normalizePickupLocation`): an API-registered pickup is considered `shippable` as soon as it has a complete address — the phone-OTP step is a dashboard-side action that is NOT required. `phone_verified` is informational only.

---

## Open Questions / (Unverified)

- **Delhivery listPickupLocations**: `DelhiveryProviderAdapter` does NOT implement `listPickupLocations` (the method is optional on the interface). There is no Delhivery endpoint for listing registered warehouses in the read code. The `pickup-locations.ts` module only handles Shiprocket.
- **Delhivery label fetch from admin/partner routes**: the `GET /admin/orders/:id/fulfillments/:fulfillmentId/label` route works via the resolver (carrier-agnostic), so Delhivery labels can be fetched. However, the Delhivery service's `createFulfillment` returns an empty `label_url` (`delhivery/service.ts:311`) — labels are fetched on demand.
- **Shiprocket `createReturnFulfillment`** (`apps/backend/src/modules/shipping-providers/shiprocket/service.ts:224`): stubbed. Return orders are P4 scope.
- **Delhivery `createReturnFulfillment`** (`apps/backend/src/modules/shipping-providers/delhivery/service.ts:337`): stubbed. Reverse pickups handled through portal.
- **Rate-limiting beyond the comment on Delhivery `calculateShippingCost`** (`apps/backend/src/modules/shipping-providers/delhivery/client.ts:67` — 40 req/min): no enforcement in the read code.
- **Order→shipment→label flow for Delhivery** via the admin convert flow: there is no Delhivery equivalent of `createShiprocketShipmentForFulfillment`. The Delhivery path through the admin UI is unverified.
- **COD remittance reconciliation** (`convert-design-order.ts:233`): tagged as P4, no implementation in the read code.
- **Delhivery COD via service.createFulfillment**: the code shows payment_mode hardcoded to Pre-paid (`delhivery/service.ts:259-261`). It's unclear if COD is intentionally blocked or just not yet wired through the service path.
- **Webhook handling** (`normalizeWebhook` on Shiprocket client at `client.ts:486`): exists but no subscriber/route consuming it was found in the read code. Tagged P2 in the comment.
