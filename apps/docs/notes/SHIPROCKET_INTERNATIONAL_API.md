# Shiprocket International API — spec (for #1111)

Source: Shiprocket's **official public Postman collection** (`shiprocketdev/shiprocket-dev-s-public-workspace`,
collection `qu05zax`), read verbatim 2026-07-21 via the browser. This corrects an
earlier web-research inference that "international reuses the domestic endpoint with
HSN" — **it does not**. There is a full separate `/v1/external/international/*`
namespace.

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
| `Terms_Of_Invoice` | **YES** | string | `FOB` or `CIF` | `FOB` |
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
| `delivery_country` | **YES** | string | **destination country ISO Alpha-2 code**, e.g. `US` (NB: create uses full name, serviceability uses ISO2) |
| `order_id` | no | int | Shiprocket order id (skips weight/cod if given) |
| `pickup_postcode` | no | int | non-primary pickup |

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
