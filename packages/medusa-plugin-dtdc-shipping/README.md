# @jytextiles/medusa-plugin-dtdc-shipping

A [Medusa v2](https://medusajs.com) fulfillment provider for
[DTDC](https://www.dtdc.in) — India's express parcel carrier. It wraps DTDC's
two API surfaces (booking + tracking) into a Medusa fulfillment provider, so
orders can be rated, booked, labelled, tracked and cancelled through the same
path as the other JYT carriers.

## Features

- **Pincode serviceability** — `isPincodeServiceable()` checks whether a
  destination pincode is B2C-serviceable before you quote or book.
- **Booking** — create a consignment (Ground Express or Priority) against DTDC's
  booking API (`pxapi.dtdc.in`, Shipsy demo host in sandbox).
- **Label streaming** — fetch the shipping label / manifest PDF for a booked
  waybill.
- **Cancellation** — cancel a booked consignment by reference number.
- **Tracking** — resolve tracking scans from DTDC's tracking API using either a
  username/password pair or a pre-minted `X-Access-Token`.
- **Sandbox mode** — `sandbox: true` routes booking/label/cancel to DTDC's Shipsy
  demo host and tracking to the staging host, so no live waybill is minted.

## Requirements

- Medusa **2.x**
- Node.js **>= 22**
- A DTDC customer code + API key (booking), and tracking credentials
  (username/password or `X-Access-Token`)

## Install

```bash
npm install @jytextiles/medusa-plugin-dtdc-shipping
# or
pnpm add @jytextiles/medusa-plugin-dtdc-shipping
```

## Configure

Register the provider in `medusa-config.ts` under the fulfillment module. It is
gated on `DTDC_API_KEY` so dev/test stay clean without credentials:

```ts
import { Modules } from "@medusajs/framework/utils"

{
  resolve: "@medusajs/medusa/fulfillment",
  options: {
    providers: [
      {
        resolve: "@jytextiles/medusa-plugin-dtdc-shipping/providers/dtdc",
        id: "dtdc",
        options: {
          customer_code: process.env.DTDC_CUSTOMER_CODE,
          api_key: process.env.DTDC_API_KEY,
          sandbox: process.env.DTDC_SANDBOX === "true",
          tracking_username: process.env.DTDC_TRACKING_USERNAME,
          tracking_password: process.env.DTDC_TRACKING_PASSWORD,
          tracking_access_token: process.env.DTDC_TRACKING_ACCESS_TOKEN,
          default_service_type: process.env.DTDC_DEFAULT_SERVICE_TYPE,
        },
      },
    ],
  },
}
```

## Fulfillment options

The provider exposes four options:

| Option | Mode | Return |
|---|---|---|
| `dtdc-ground-express` | Surface | no |
| `dtdc-ground-express-return` | Surface | yes |
| `dtdc-priority` | Express | no |
| `dtdc-priority-return` | Express | yes |

## Shared client

The booking/tracking client is exported for direct use outside the fulfillment
provider (e.g. a carrier resolver that needs a pincode check before quoting):

```ts
import { DtdcClient, isPincodeServiceable } from "@jytextiles/medusa-plugin-dtdc-shipping/lib/dtdc-client"
import { DtdcProviderAdapter } from "@jytextiles/medusa-plugin-dtdc-shipping/providers/dtdc/adapter"
```

## License

MIT