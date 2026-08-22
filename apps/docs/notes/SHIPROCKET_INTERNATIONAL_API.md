# Shiprocket International API — spec (for #1111)

Source: Shiprocket's **official public Postman collection** (`shiprocketdev/shiprocket-dev-s-public-workspace`,
collection `qu05zax`), read verbatim 2026-07-21 via the browser. This corrects an
earlier web-research inference that "international reuses the domestic endpoint with
HSN" — **it does not**. There is a full separate `/v1/external/international/*`
namespace.

> 🔴 **Re-verified against the LIVE API 2026-08-22, and the collection is not
> trustworthy on its own.** Four things it gets wrong or omits: `ioss`/`eori`
> exist and are marked required but are not; `pickup_postcode` is marked optional
> and is not; `Terms_Of_Invoice` is marked required here and optional there; and
> the entire DDP / duty / IOSS-fee block on the serviceability response is
> **absent from the collection altogether**. Treat this file as the contract and
> the collection as a hint — and probe before believing either.
>
> Collection JSON, for a future re-read (the docs site is JS-rendered and
> WebFetch only gets the shell):
> `https://www.postman.com/_api/collection/8407119-f5af337c-69fc-49c7-8418-e2f6ee461674?populate=true`

Base URL is unchanged: `https://apiv2.shiprocket.in/v1/external`.

## Endpoints (international namespace)

| Purpose | Method | Path |
|---|---|---|
| Create order | POST | `/international/orders/create/adhoc` |
| Courier serviceability | GET | `/international/courier/serviceability` |
| AWB assignment | POST | `/international/courier/assign/awb` |
| Tracking | GET | `/international/orders/track` |
| Manifest generation | POST | `/international/manifests/generate` |
| All-in-one wrapper (create+ship+pickup+label+manifest) | POST | `/international/shipments/create/forward-shipment` |
| International KYC (prerequisite) | POST | `/international/settings/international_kyc` |
| Add bank details (prerequisite) | POST | `/international/settings/add-bank-details` |

Domestic label endpoint `/courier/generate/label` is shared (no international-specific
label path in the collection). AWB assign shape mirrors domestic
(`shipment_id` yes, `courier_id` no, `status: "reassign"` no).

## Create order body — international-specific fields (beyond the domestic shape)

Verbatim example body used `shipping_country: "United States"` (**full country NAME**,
not ISO) and these extra top-level fields:

| Field | Req | Type | Values / notes | Retail default |
|---|---|---|---|---|
| `currency` | **YES** | string | `INR,USD,GBP,EUR,AUD,CAD,SAR,AED,SGD`. **Amounts (`selling_price`, `sub_total`) are in THIS currency** — not forced to INR. | order currency |
| `reasonOfExport` | **YES** | int | `0`=BONAFIDE_SAMPLE, `1`=SAMPLE, `2`=GIFT, `3`=COMMERCIAL | `3` (commercial sale) |
| `Terms_Of_Invoice` | no | string | `FOB` or `CIF`. Earlier noted here as required; the collection says optional. **There is no `DDP`/`DAP` value — this field is the invoice VALUATION basis (does the declared value include freight/insurance), not who pays duty.** | `FOB` |
| `ioss` | doc says **YES** | string | **The IOSS registration NUMBER, not a boolean.** Undocumented beyond the name — no description, no example. ⚠️ Live-verified 2026-08-22: an NL order creates fine with this ABSENT, so "required" is wrong at create time. Untested at AWB assign. | omit until IOSS-registered |
| `eori` | doc says **YES** | string | The EORI number. Same caveats as `ioss`. | omit |
| `purpose_of_shipment` | no | int | `0`=gift, `1`=sample, `2`=commercial | `2` |
| `igstPaymentStatus` | no | char | `A`=not applicable, `B`=LUT/Export under Bond, `C`=Export against IGST payment | `A` |
| `commodity` | no | bool | is the order a commodity | `true` |
| `mies` | no | — | (undocumented) | omit |
| `isd_code` | no | string | destination ISD dial code, e.g. `+1` | derive from country |
| `shipping_country` | cond | string | **full country NAME** e.g. `"United States"` | ISO2→name map |
| `order_items[].hsn` | no* | int | HSN code. *Shiprocket made HSN **mandatory for all international shipments** (product-update May 2025) → treat as required. | from product/variant |
| `order_items[].category_name` / `category_id` / `caetgroy_code` (sic) | no | | optional catalogue hints | omit |
| `pickup_location` (name) or `pickup_location_id` (int) | yes | | registered pickup | name (as domestic) |

`payment_method` must be **Prepaid** — COD is not available internationally.

## Serviceability — `GET /international/courier/serviceability`

| Param | Req | Type | Notes |
|---|---|---|---|
| `weight` | **YES** | int | shipment weight |
| `cod` | **YES** | int | **must be `0`** (no international COD) |
| `delivery_country` | **YES** | string | destination country. ISO Alpha-2 (`NL`) and the full name (`Netherlands`) both work here — unlike create, which needs the full name. |
| `order_id` | no | int | Shiprocket order id (skips weight/cod if given). ⚠️ See the note below — this form returned NO couriers for an NL order that the weight form priced fine. |
| `pickup_postcode` | **YES, in practice** | int | 🔴 Documented optional, but omitting it 400s with `"Please fix request using below fields"` — **naming no fields**. Live-verified 2026-08-22; cost three attempts to find. Always send it. |

## 🔑 The serviceability RESPONSE carries a customs block the docs never mention

Live-verified 2026-08-22 against the prod account (probe: create → rate → cancel,
no AWB ever assigned). **None of these appear anywhere in the Postman
collection** — a full-text search of all 2 MB returns zero hits for "ddp",
"duty", "duties" or "incoterm". The published contract is simply behind the API.

Each entry in `data.available_courier_companies[]` carries:

| Field | Meaning (inferred — Shiprocket documents none of it) |
|---|---|
| `ddp_tag`, `ddp_vcn`, `ddp_inclusive_vcn` | **Delivered Duty Paid.** So DDP IS expressible; it is simply not a `Terms_Of_Invoice` value. |
| `tariff`, `tariff_data` | Duty. Empty/0 on every probe so far. |
| `ioss_fee`, `eori_fee`, `international_vat_amount` | The EU VAT/IOSS/EORI money, per courier. |
| `is_csb5`, `csb4_seller_kyc`, `csb5_seller_kyc` | Which export route the lane runs under, and whether the seller is KYC'd for it. |
| `custom_clearance_type`, `cha_agent_id`, `clearance_cha_partner`, `custom_route_code` | Clearance agent wiring. |

🔴 **This is the right place to read landed cost from — BEFORE assigning an AWB.**
Serviceability is a free read; assign books and bills. Anything we ever show a
buyer about duty must come from here, per shipment, and never from a config flag
that says what we *intend* the incoterm to be.

### Account state as observed 2026-08-22 (NL, 2 kg, €450)

```
Aramex International | ddp_tag=false  ddp_vcn=false  ddp_inclusive_vcn=false
                     | ioss_fee=0  eori_fee=0  international_vat_amount=0  tariff=0
                     | is_csb5=true  csb4_seller_kyc=true  csb5_seller_kyc=FALSE
                     | is_active=false
```

Two blockers, both account-side rather than code:

- **`csb5_seller_kyc: false`** while CSB-4's is true. CSB-5 is the commercial
  export route that pairs with the LUT, and our create body classifies as CSB-5.
  Most likely why every DDP/tariff/fee field reads zero.
- **`is_active: false`**, on the only courier that serves the lane at all.

Enabling IOSS/EORI in Settings → International Taxes changed **nothing** on the
order record — reading the order back before and after is byte-identical. These
are rate-level fields, not order fields.

### Also observed

- **`shipping_is_billing: true` is not honoured** — send an explicit `shipping_*`
  block. Already recorded in `shiprocket/client.ts` (live-verified 2026-08-06),
  but it was missing here, and it cost three attempts on this probe: the create
  fails as `"Delivery pincode is not valid for Netherlands!"`, which reads as a
  postcode-format problem and is nothing of the kind. Note it is `isd_code`, not
  `billing_isd_code`.
- **Only ONE courier serves NL** (Aramex International), and only via the
  weight-based lookup. The `order_id` form answered *"No serviceable couriers
  available for entered pincodes"* for the same pickup, with the Dutch postcode
  in every format tried (`1015 CJ`, `1015`). Delivery-pincode matching is what
  fails, not the postcode format.
- **Cancelling spawns a clone.** Cancelling `ioss-probe-…` left a NEW order
  named `ioss-probe-…-C` behind. A create/cancel probe that does not sweep
  afterwards leaves live orders on the account. Always re-list and re-cancel;
  never cancel anything carrying an AWB.

## Country-format gotcha (load-bearing)

- **create/adhoc** `shipping_country` → **full country NAME** ("United States").
- **serviceability** `delivery_country` → **ISO Alpha-2** ("US").
Our order addresses store ISO-2 `country_code`, so we need an ISO2→name map for the
create body and pass ISO2 straight through to serviceability.

## Ops prerequisites (not code — surface clean errors)

International shipping requires, on the Shiprocket account: **International KYC**
approved, **bank details** added, and an **international-capable pickup** registered.
These fail the create/assign with actionable messages; the client should pass those
through as `ShiprocketApiError` (already does), and the workflow should not silently
fall back to a domestic label.
