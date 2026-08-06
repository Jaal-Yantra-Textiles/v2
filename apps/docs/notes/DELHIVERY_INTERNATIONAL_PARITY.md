# Delhivery international — parity audit (2026-08-06)

Companion to `SHIPROCKET_INTERNATIONAL_API.md`. Question asked: does our Delhivery
integration have parity with Shiprocket's international support?

**Answer: there is nothing to have parity with. Delhivery's exports are a
different product that we are not integrated with, and until this audit the
domestic integration was reachable for international orders.**

## What Delhivery's international shape actually is

The public [Express API doc set](https://delhivery-express-api-doc.readme.io/llms.txt)
has 43 pages and **no international/cross-border endpoint**. Order creation is a
single endpoint, `POST /api/cmu/create.json` — the domestic manifest API. It
takes a `country` field (their example uses `"BD"`), but that is the
Indian-subcontinent last-mile product, not exports.

Exports run on **Cross Border**, a separate Delhivery One service
([help.delhivery.com/docs/cross-border](https://help.delhivery.com/docs/cross-border))
that must be activated on the account. Per
[International Order Creation](https://help.delhivery.com/docs/create-international-order)
its order object is different:

| Group | Fields |
|---|---|
| Shipment type | Document · Sample · Gifts · Commercial Cargo · Commercial (CSB-V) |
| Invoice | INCO Terms, Invoice Number, Invoice Date, IGST Payment Status |
| Per item | Category, HSN Code, Quantity, Price, IGST rate |
| Parcel | Box Dimensions (LBH cm), Dead Weight (kg), mode: Document / Deferred Express / Express |
| Onboarding | Seller KYC **mandatory before order creation** — PAN, GST, bank account + IFSC, AD code, IEC |

None of this is documented publicly; the spec has to come from Delhivery's team
(same contact as the #649 status push).

## Measured against the live account, 2026-08-06

| Probe | Result |
|---|---|
| `GET /c/api/pin-codes/json/?filter_codes=110001` | `200`, full `delivery_codes` entry |
| same, US ZIP `10001` | `200 {"delivery_codes": []}` |
| same, UK `SW1A1AA` | `200 {"delivery_codes": []}` |
| `GET /api/kinko/v1/invoice/charges/` IN→IN | `200`, `total_amount: 56.79` |
| same, IN→US ZIP | **`400 {"error": "Unable to process request, Please contact: lastmile-integration@delhivery.com"}`** |
| staging (`staging-express`) with the live token | `401 Login or API Key Required` |

Two things to keep: the failure mode is **opaque** — nothing in it says "this
carrier has no export product on this account" — and **there is no sandbox**.
Delhivery issues separate staging credentials; the production token does not
cross over, with or without a `Content-Type` header. Any create test is against
the live account and mints a real waybill.

## What was wrong on our side

1. **Delhivery was selectable for an international order.** `SHIPMENT_CARRIERS`
   offered it unconditionally and `shiprocket-shipment.ts` is carrier-agnostic
   (`input.carrier || "shiprocket"` → resolver). Every international behaviour —
   FX conversion, the HSN-required check, `describeIntlPrereqError` — lives
   *inside the Shiprocket client*, so Delhivery just posted a foreign postcode in
   `pin` to the domestic endpoint.
2. **`hsn_code` never reached Delhivery, even domestically.** The client
   supported it; the adapter never set it. Delhivery lists it as mandatory on
   order creation alongside `seller_gst_tin` (which we do send, #348). Note it is
   **one code per shipment**, not per line.
3. `customs` and `currency` on `CreateShipmentInput` are consumed by Shiprocket
   only.
4. Rates and serviceability are India-only by construction (`o_pin`/`d_pin`,
   hardcoded `inr`).

## What was fixed

`assertDomestic` in `delhivery/adapter.ts` refuses `createShipment` / `getRates`
for a non-India destination with an actionable message; `isInternationalDestination`
moved to the carrier-neutral `shipping-providers/destination.ts` (re-exported
from `shiprocket/client` so imports still work); the adapter now forwards
`hsn_code`; the partner picker filters `domesticOnly` carriers out for
international orders.

## What is NOT fixed

Real Delhivery cross-border. It needs the service activated, full seller
KYC/IEC/AD-code onboarding, and a spec from Delhivery. That belongs under #649.
