# Shipping providers — pluggable carrier interface (#31)

**Status:** interface spike landed 2026-06-15 (branch `feat/31-shipping-provider-interface`); partner fulfilment routes migrated onto the resolver and merged (**PR #414**, 2026-06-15).
**Roadmap:** §31 in `PLATFORM_ROADMAP_2026_05.md` · **Issue:** #404 (`[#31]`).

This is the design note for the pluggable shipping-provider interface that lets
admin-driven shipping run across carriers. It reconciles the existing
**Delhivery** integration with **Shiprocket** (the multi-carrier aggregator) so
both implement one interface, and houses provider credentials in the existing
**external-platform** store rather than scattering them across env vars.

---

## 1. Why a provider interface

The partner fulfilment routes today hardcode the carrier:

```ts
// src/api/partners/orders/[id]/fulfillments/[fid]/{label,tracking,pickup}/route.ts
import { DelhiveryClient } from ".../shipping-providers/delhivery/client"
const client = new DelhiveryClient({ api_token: process.env.DELHIVERY_API_TOKEN, ... })
if (carrier !== "delhivery") { /* degraded fallback */ }
```

Adding Shiprocket this way means duplicating that branch in three routes (and
again on every future admin surface). Instead we resolve a carrier-agnostic
client by `fulfillment.data.carrier` and call one shape.

## 2. The interface

`src/modules/shipping-providers/provider-interface.ts` defines
`ShippingProviderClient` plus normalized request/response types
(`CreateShipmentInput`, `ShipmentResult`, `ShipmentRef`, `TrackingResult`,
`RateOption`, …). Required capability: `createShipment`, `getLabel`, `track`,
`cancelShipment`. Optional (not every carrier exposes them over API):
`checkServiceability`, `getRates`, `schedulePickup`, `registerPickupLocation`,
`normalizeWebhook`.

The key abstraction is **`ShipmentRef`** — `{ awb?, provider_refs? }`. Delhivery
needs only the waybill; Shiprocket needs `provider_refs.shipment_id` (and
`sr_order_id` to cancel). Persist the whole `ShipmentResult.provider_refs` blob
on `fulfillment.data` at create time and pass it back for label/track/cancel.

## 3. Delhivery vs Shiprocket — shape differences the interface absorbs

| Dimension        | Delhivery                                   | Shiprocket                                                        |
|------------------|---------------------------------------------|-------------------------------------------------------------------|
| Create + AWB     | `POST /api/cmu/create.json` — **one call**, auto-assigns waybill | `POST /orders/create/adhoc` (→ `shipment_id`, no AWB) **then** `POST /courier/assign/awb` |
| Carrier choice   | single carrier                              | aggregator — `getRates` returns `courier_company_id` options to pick |
| IDs to persist   | waybill only                                | `sr_order_id` + `shipment_id` (+ awb)                             |
| COD amount       | explicit `cod_amount`                       | derived from `sub_total` (no field)                              |
| Auth             | static API-key header                       | JWT, ~10-day TTL, re-login on 401                                |
| Label            | `GET /api/p/packing_slip`                   | `POST /courier/generate/label`                                   |
| Tracking status  | string statuses                            | numeric `shipment_status_id` (7=Delivered, 9/10=RTO, …)          |
| Webhook          | event subscription                          | dashboard-configured push; SAM-AEL gates with `x-api-key`         |

`ShiprocketClient.createShipment` sequences create → assign-AWB → label so
callers get an AWB + label in one call, mirroring Delhivery's single-call shape.

## 4. Credentials live in the external-platform store

Per the decision on #404, carriers are **external platform providers**, not
env-var singletons. `SocialPlatform` (despite the name) is a generic external-
API store: `category: "shipping"`, encrypted `api_config`, `auth_type`. Secrets
(`password`, `api_key`, …) are encrypted at rest by the
`social-platform-credentials-encryption` subscriber and decrypted via the
`encryption` module.

- **Delhivery** → `category: shipping`, `auth_type: api_key`, `api_config: { provider: "delhivery", api_key, mode }`.
- **Shiprocket** → `category: shipping`, `auth_type: basic`, `api_config: { provider: "shiprocket", email, password (encrypted), pickup_location, mode }`.

Admin creates these under **Settings → External Platforms → Shipping**. The
form (`shipping-provider-fields.tsx`) now shows email/password/pickup_location
when carrier = Shiprocket, and the api-key/account fields otherwise.

## 5. The resolver

`src/modules/shipping-providers/resolver.ts` →
`resolveShippingProvider(container, carrier)`:

1. `listSocialPlatforms({ category: "shipping", status: "active" })`, match on
   `api_config.provider` / `provider_type` / name.
2. Decrypt the carrier's secrets (`<field>_encrypted` → plaintext, falling back
   to plaintext) via the `encryption` module.
3. Instantiate the carrier client: `DelhiveryProviderAdapter` (wraps the
   untouched `DelhiveryClient`) or `ShiprocketClient` (native).
4. **Env-var fallback** so existing Delhivery flows keep working before any
   platform record exists: `DELHIVERY_API_TOKEN`, or
   `SHIPROCKET_EMAIL` / `SHIPROCKET_PASSWORD` / `SHIPROCKET_PICKUP_LOCATION`.

`DelhiveryProviderAdapter` lives in `delhivery/adapter.ts` — the existing
`DelhiveryClient` and `DelhiveryFulfillmentService` are **unchanged** (low-risk
spike). Shiprocket is also registered as a Medusa fulfillment provider
(`shiprocket/index.ts` + added to `shipping-providers/index.ts`) so it works in
the standard fulfilment flow too.

## 6. What this spike delivered

- `provider-interface.ts` — the normalized `ShippingProviderClient` contract.
- `shiprocket/{client,service,index}.ts` — Shiprocket adapted from the
  MIT-licensed `SAM-AEL/medusa-plugin-shiprocket`, rewritten to native `fetch`
  (no axios) and our conventions; implements both the Medusa fulfillment
  provider and our `ShippingProviderClient`.
- `delhivery/adapter.ts` — conforms the existing client to the interface.
- `resolver.ts` — carrier-keyed resolution with platform-store creds + env
  fallback.
- Admin external-platform form: Shiprocket as a shipping carrier.

Builds clean (no new TS errors). Not yet exercised against the live Shiprocket
API — see next steps.

## 7. Next steps (not in the spike)

1. ~~**Migrate the 3 partner routes** (`label`, `tracking`, `pickup`) off the
   hardcoded `DelhiveryClient` onto `resolveShippingProvider(req.scope, carrier)`.~~
   **DONE — PR #414.** First real consumer; wire shape preserved (the Delhivery
   tracking normaliser was folded into `delhivery/adapter.ts`, and the route-local
   `normalize-delhivery.ts` deleted). New resolver helpers `isSupportedCarrier()`
   + `shipmentRefFromFulfillment()`.
2. **Edit form** — apply the same Shiprocket-conditional fields to
   `edit-social-platform.tsx` (create path is wired; edit reuses different field
   rendering).
3. **Validate against Shiprocket** — create a `category: shipping` Shiprocket
   platform record (test creds), then exercise auth → serviceability → create →
   assign-AWB → label. The token re-login-on-401 path needs a real 401 to test.

## 8. Phasing (from #404)

- **P1 — label-first MVP.** Design Order → Convert to Order (paid OR COD) →
  generate a Shiprocket label/AWB; persist AWB + label URL + tracking ref.
  Single provider, no remittance. **Open Qs to confirm before building P1:**
  (a) Convert-to-Order default — always paid, COD an explicit toggle?
  (b) COD "capture" = capture-on-delivery remittance (P4), not pre-auth —
  confirm. (c) Per-entity action scope — order-only first, or design +
  inventory-order + order?
- **P2 — per-entity "Create shipment" action** on design / inventory-order /
  order; track via webhook (`normalizeWebhook` is the plug-in point), plug back.
- **P3 — stock locations as pickup points** via `registerPickupLocation`;
  internal transfers modelled as shipments.
- **P4 — COD capture + remittance loop.** Both providers implement it behind the
  interface.

## 9. Pickup-location (warehouse) registration — planned feature

> Investigated 2026-06-15. Shiprocket **does** support pickup-location
> registration over API (standard for business accounts). This section captures
> the mechanics + the product design before it's built.

### 9.1 How Shiprocket models pickup locations

A pickup point is referenced by a **unique nickname string** (`pickup_location`),
*not* by address. You register an address once under a nickname, then every
order-create call passes that nickname. New accounts ship with a default
`"Primary"` location.

| Operation | Endpoint | Notes |
|-----------|----------|-------|
| Add | `POST /v1/external/settings/company/addpickup` | `pickup_location` (nickname, **unique**), `name`, `email`, `phone`, `address`, `address_2`, `city`, `state`, `country`, `pin_code`, `gstin?` |
| List | `GET /v1/external/settings/company/pickup` | `data.shipping_address[]` — nickname, id, **phone-verification status** |

Delhivery's equivalent is `registerWarehouse` (a named warehouse), wired today in
`create-store-with-defaults.ts` and recorded as `stock_location.metadata.delhivery_warehouse_name`.

### 9.2 What exists vs the gap

- `ShiprocketClient.registerPickupLocation()` already calls `/settings/company/addpickup` (`shiprocket/client.ts`).
- `ShiprocketFulfillmentService.createFulfillment` already **reads** the nickname
  from `fromLocation.metadata.shiprocket_pickup_location` (→ `fromLocation.name`
  → `"Primary"`) — the deliberate parallel to `delhivery_warehouse_name`.
- **Gap (CLOSED 2026-06-15):** `shiprocket_pickup_location` was only ever read,
  never written. Now wired (branch `feat/31-shiprocket-pickup-registration`):
  `ShiprocketClient.listPickupLocations()` (idempotency + phone-verification
  status), a resolver-driven `registerShiprocketPickup()` helper that writes the
  nickname onto `stock_location.metadata`, an on-demand admin route, and a
  backfill script for pre-registered warehouses. See §9.5.
- **Watch-out:** Shiprocket requires the pickup address's **phone to be
  OTP-verified** before it's usable for live pickups. `addpickup` *creates* the
  location; verification is a separate (often manual, dashboard/OTP) step. So
  "registered" ≠ "shippable" — the UI must reflect verification state.

### 9.3 Product design — register on location-add, opt-in for partner stores

When a partner adds a location it should register as a pickup point in **our**
Shiprocket account (our shipping address). But whether that's automatic vs
opt-in depends on *why* the location exists:

- **Inbound (partner → us).** When we onboard a partner we add a location they
  ship *to us* from. Registering this pickup point is useful to **us** and can be
  done automatically — the partner doesn't need to think about it.
- **Outbound (partner runs a storefront → ships to their own consumers).** Here
  the partner is the shipper. Registration must be **opt-in** — they decide
  whether they want their location wired into our Shiprocket pickup set.

**Default-hidden status.** A partner should **not** see whether their location is
registered unless they explicitly ask for it. Registration status / the
"register this pickup location" action is surfaced on demand, not shown by
default. (Keeps the inbound case invisible plumbing, and makes the outbound case
a deliberate choice.)

### 9.4 Recommended implementation (resolver-driven, mirrors Delhivery)

1. Add `listPickupLocations()` to `ShiprocketClient` (`GET /settings/company/pickup`) for idempotency + verification status.
2. A registration step that `resolveShippingProvider(container, "shiprocket").registerPickupLocation({…stock_location.address})`, uses a deterministic nickname (`warehouse-<locationSuffix>`, same scheme as Delhivery), treats "already exists" as success, and writes `shiprocket_pickup_location` into `stock_location.metadata`.
   - **Inbound:** invoke automatically when we add a partner's ship-to-us location.
   - **Outbound:** invoke only on an explicit partner action (opt-in).
3. Surface phone-verification status from the list call so operators/partners
   know whether the location is live — but only when registration is requested
   (per §9.3 default-hidden rule).

Stays consistent with the spike decision (carriers as external-platform
providers, resolver-sourced creds) rather than Delhivery's env-var +
fulfillment-module-registry path.

### 9.5 What was built (2026-06-15, branch `feat/31-shiprocket-pickup-registration`)

| Piece | Location | Notes |
|-------|----------|-------|
| `PickupLocation` type + `listPickupLocations?()` | `shipping-providers/provider-interface.ts` | normalized list result incl. `phone_verified` |
| `ShiprocketClient.listPickupLocations()` | `shiprocket/client.ts` | `GET /settings/company/pickup` → `data.shipping_address[]`; maps `phone_verified` 0/1 → boolean |
| `registerShiprocketPickup()` / `getShiprocketPickupStatus()` | `shipping-providers/pickup-locations.ts` | resolver-driven, idempotent (lists first, treats duplicate-nickname errors as success), writes `stock_location.metadata.shiprocket_pickup_location`. `SHIPROCKET_PICKUP_METADATA_KEY` + `pickupNicknameForLocation()` exported |
| Admin route | `admin/stock-locations/[id]/shiprocket-pickup/route.ts` | `GET` status (null if unregistered), `POST` register — on-demand per §9.3 |
| Backfill | `scripts/backfill-shiprocket-pickup-locations.ts` | maps **pre-registered** Shiprocket pickups onto stock locations by nickname → unique pincode → pincode+city; dry-run (`--dry-run` / `DRY_RUN=1`); reports ambiguous/unmatched, never guesses |

**Nickname scheme:** `warehouse-<last 8 of locationId>` — identical to the
Delhivery warehouse name, so a location maps to the same nickname on both
carriers.

**Done (2026-06-15, branch `feat/31-shiprocket-pickup-registration`):**
- **Fulfillment provider registration** — Shiprocket added to the
  `@medusajs/medusa/fulfillment` `providers` list (env-gated on `SHIPROCKET_EMAIL`,
  mirroring Delhivery; no sandbox). Active in `medusa-config.prod.ts`, kept in
  parity in the commented base-config block.
- **Inbound auto-register** — wired into `create-store-with-defaults.ts`: India
  stores link `shiprocket_shiprocket` (when enabled) and best-effort call
  `registerShiprocketPickup` (never fails provisioning).
- **Outbound opt-in UI** — admin widget on the stock-location detail page
  (`src/admin/widgets/stock-location-shiprocket-pickup.tsx`, zone
  `location.details.after`). Default-hidden per §9.3: shows a "Check status"
  action until the operator asks, then GET status / POST register on demand.
- **Integration test** — `integration-tests/http/shiprocket-pickup-registration.spec.ts`
  (5 cases) covers the GET/POST route end to end with the Shiprocket HTTP calls stubbed.

**Still open:**
- **Live verification** — untested against the real Shiprocket API; needs test
  creds + a `category: shipping` Shiprocket platform record. The
  `data.shipping_address[]` field names (esp. `phone_verified`) should be
  confirmed against a live response.

### 9.6 Pickup "shippable" semantics (2026-06-17, #435)

Confirmed against a live `GET /settings/company/pickup` response (prod
`warehouse-AYV7GRDR`): rows carry `phone_verified` (0/1), `status` (1 seen),
and a full address (`address`, `city`, `pin_code`, `phone`). The field names in
§9.5 are correct — `phone_verified` reads fine.

The real issue was **semantic**: an API-registered pickup is usable for live
pickups as soon as it has a complete address; the phone-OTP step is a separate,
dashboard-only action that isn't required to ship. Showing "Phone not verified"
/ "Verification unknown" for a usable pickup was misleading.

- `normalizePickupLocation(r)` (exported from `shiprocket/client.ts`) now derives
  `shippable = active && (phone_verified === true || address_complete)`, where
  `address_complete` = `address && city && pin_code && phone` and `active` =
  `status !== 0`. `PickupLocation` gained `shippable` + `address_complete`;
  `PickupRegistrationResult` and the admin GET/POST thread `shippable` through.
- The admin widget leads with **Ready to ship** (green) / **Address incomplete**
  (orange) / **Registered** (grey, only when shippability is unknown), and notes
  "Phone OTP not completed — not required for API-registered pickups" when a
  shippable pickup hasn't done OTP.
- Tests: `shiprocket/__tests__/list-pickup-locations.unit.spec.ts` (normalizer +
  client) and an added integration case (API pickup with full address is
  shippable before phone OTP).
