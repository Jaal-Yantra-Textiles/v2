# Shipping providers — pluggable carrier interface (#31)

**Status:** interface spike landed 2026-06-15 (branch `feat/31-shipping-provider-interface`).
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

1. **Migrate the 3 partner routes** (`label`, `tracking`, `pickup`) off the
   hardcoded `DelhiveryClient` onto `resolveShippingProvider(req.scope, carrier)`.
   This is the first real consumer and proves the interface end-to-end against
   existing Delhivery flows. Keep the wire response shape identical.
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
