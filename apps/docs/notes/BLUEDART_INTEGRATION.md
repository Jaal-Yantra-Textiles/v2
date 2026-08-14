# Blue Dart integration + carrier waybill cancellation

Status: implemented, **not yet exercised against the live account** beyond
read-only probes. 2026-08-13.

## Why

Two separate problems, done in one pass because they share the carrier
abstraction.

1. **Nothing could cancel a waybill.** Every carrier client has implemented
   `cancelShipment` since the #31 provider spike, and nothing ever reached it —
   no route, no workflow, no UI. The only callers were a dev script and #1233's
   internal "a failed AWB assign must cancel the order it just created". An
   operator whose shipment hit a problem (pickup no-show, partner change, wrong
   address caught late) had a live waybill they could only kill on the carrier's
   own dashboard, while our fulfillment went on claiming it.
2. **Some origins don't work with the incumbent carriers** — the pickup never
   materialises. Blue Dart serves those lanes, and unlike our Delhivery
   integration it also has a real export product.

## Part 1 — cancelling a waybill

`cancelShipmentForFulfillment` (`src/workflows/orders/cancel-shipment.ts`), via
`POST /admin/orders/:id/fulfillments/:fulfillmentId/cancel-shipment`.

**The ordering is the whole design:**

1. cancel at the **carrier** first,
2. only then clear the refs from `fulfillment.data`.

Never the reverse. Clearing first and then failing at the carrier leaves a live,
billable waybill that nothing in our system points at — precisely the orphan
class #1225 was filed for. A carrier refusal throws and leaves the fulfillment
exactly as it was.

What a successful cancel does:

- strips `carrier`, `waybill`, `tracking_number`, `tracking_url`, `label_url`,
  `shipment_id`, `sr_order_id`, `provider_refs` from `fulfillment.data`, so the
  order drops back to un-labelled and the existing Generate-label path can run
  again on a different carrier;
- appends `data.cancelled_shipments[]` — `{carrier, awb, cancelled_at,
  cancelled_by, reason, provider_refs}`. The voided AWB is the only handle for
  reconciling a carrier invoice later, so losing it would make the cancellation
  itself untraceable;
- clears the fulfillment's **labels**. Not cosmetic: the AWB is stamped as a
  `fulfillment_label` tracking number because that is the queryable key the
  tracking webhook matches carrier pushes on (`data` is JSONB and can't be
  filtered). A dead label row lets a late scan for a voided waybill land back
  on the order;
- emails the customer (below).

Guards:

- **no AWB** → 400, nothing to cancel;
- **carrier not API-backed** (a hand-attached AWB, a manual fulfillment) → 400
  telling the operator to cancel with the carrier directly;
- **already marked shipped** → refused unless `force: true`. The parcel is
  physically in the carrier's network and voiding its waybill strands a box
  nobody can route.

**Admin only, deliberately.** A cancel costs real money at the carrier and the
partner-change decision that usually motivates it is an admin's to make. There
is no partner route.

### The customer email

Template key `order-courier-changed`, seeded by
`src/scripts/seed-courier-changed-email.ts`.

⚠️ **The send is best-effort and must stay that way.** By the time it runs the
waybill is already cancelled and that is not undoable; failing the operation
because a template row is missing would report "cancel failed" for a cancel that
definitively succeeded — the worst possible lie to tell an operator deciding
whether to retry. `customer_notified: false` in the response is the signal that
the seed hasn't been run, and both UIs raise a warning toast on it.

The operator's free-text reason is **not** shown to the customer: it is written
for an internal audit trail ("partner swap", "pickup no-show") and can name
partners, costs or blame. The email carries the fact and the promise, and no
tracking link — at send time the replacement shipment does not exist yet.

### UI

- **Retail orders** — `admin/widgets/order-carrier-shipment.tsx`, in the
  already-labelled branch. Two-step: the reason field doubles as the
  confirmation gesture.
- **Design orders** — `admin/routes/design-orders/[id]/page.tsx`, next to the
  tracking row, behind a `usePrompt` confirm. The design-order payload gained
  `tracking.fulfillment_id` (additive) because cancel is addressed per
  fulfillment and that page never knew which one carried the shipment.
- **Partner UI** — unchanged; partners see the AWB and are pointed at support.

⚠️ `existingAwbOf` in the widget now treats `data` as authoritative once
anything has been cancelled on that fulfillment, rather than trusting the label
row. Otherwise a label that didn't clear would keep the widget in its
"already labelled" branch and block the re-label the feature exists to enable.

## Part 2 — Blue Dart as a provider

`src/modules/shipping-providers/bluedart/` — `client.ts` (transport, token
cache, envelope unwrapping), `adapter.ts` (`ShippingProviderClient`),
`constants.ts`, `types.ts`. Registered in `resolver.ts`'s `SUPPORTED_CARRIERS`,
so it appears in every existing admin surface automatically.

**Not domestic-only.** Product `H` (IPC, sub-product `IPC-Expedited`) is a real
export product on the same account, so there is no `assertDomestic` guard —
unlike Delhivery, whose exports run on the separate Cross Border service.

**Waybill and pickup stay separate acts.** `createShipment` sends
`RegisterPickup: false`; `schedulePickup` books the collection. A waybill can be
made the night before, but a pickup slot is a commitment for a date and a
warehouse. Same split settled for Delhivery in #1241.

### ⚠️ "Blue Dart 400s with an empty body" is FALSE

It names the field. Live capture, 2026-08-14:

```json
{"status":400,"title":"Bad Request",
 "error-response":[{"StatusCode":"InvalidPinCode",
                    "StatusInformation":"Pincode cannot be blank "}]}
```

The body arrives **pretty-printed, leading with newlines**, so a logger that
keeps the first line of an error message shows `failed (400): ` and nothing
after it. That apparent silence is ours, not the carrier's — and it cost three
sessions of guessing at auth faults, path faults, slot cutoffs and field caps
for a question Blue Dart had already answered on the first attempt.
`describeBlueDartHttpError` now flattens `error-response[]` onto one line.

**Corollary: do not trust any earlier note in this file, a handoff, or an issue
comment that reasons from the "empty body".** Re-read the response.

### Pickup registration carries its own address

There is no pickup-location registry (see below), so `RegisterPickup` needs
`CustomerPincode`, `CustomerTelephone` and a real street — every call. Until
2026-08-14 `schedulePickup` sent `pickup_location_name` as both the name and the
street with both those fields blank, so **no pickup this app ever attempted
succeeded.** The tokens cancelled on 2026-08-13 came from a direct probe script,
not from this code path — prod logs show no `/pickup` route hit that day.

### Gotchas that are load-bearing

Each of these is pinned by a unit test:

| Trap | What happens if you get it wrong |
|---|---|
| `JWTToken` header, **not** `Authorization: Bearer` | 401 |
| `Profile` must carry `Customercode` **and** `Version` | "UnauthorizedUser" or a null-reference error |
| `Customercode` is `000001` — not the LoginID, not `DHM000001` | auth fails obscurely |
| `Dimensions` array mandatory | waybill rejected; we fall back to a nominal 10×10×10 box |
| `OTPBasedDelivery` must be the **string** `"0"` | numeric `2` demands an OTPCode: "OTP Number cannot be blank" |
| `Commodity` object required even domestically | rejected |
| Dates are Microsoft-JSON `/Date(ms)/` | ISO strings are silently rejected |
| Weights are **KG**, ours are grams; 0 is treated as missing | rejected |
| Pickup API uses lowercase `request`/`profile`, waybill API uses `Request`/`Profile` | null-reference error, no validation message |
| `SubProducts` must be non-empty on pickup registration | rejected |
| Product availability is **per origin area** | `A` is not available outbound from DHM (176215); `D` is |
| A 200 can still be a failure | check `IsError`, non-`Valid`/`InsertSuccess` `Status[]`, **and** a bare `Error` string |
| Pickup needs the collection address **inline** — pincode and phone included | `InvalidPinCode`, "Pincode cannot be blank" |
| Sandbox has **separate** shipping credentials | production creds return `RequestAuthenticationFailed` |

`checkServiceability` reads the **inbound** flags. Outbound describes what can
leave that pincode — a fact about the destination's own senders, saying nothing
about whether our parcel can be delivered there.

### Tracking goes through DHL Unified, not Blue Dart

`src/modules/shipping-providers/dhl-unified-tracking.ts`.

Blue Dart's own *Shipment Tracking (DHL eCommerce India, Blue Dart)* endpoint
**works with the shipping licence key.** There is no separate tracking
credential.

```
GET /in/transportation/tracking/v1
    ?handler=tnt&action=custawbquery&loginid=DY3585329&awb=awb
    &numbers=<AWB>&format=json&lickey=<shipping licence key>&scan=1
    JWTToken: <token>          scan: 1 = full detail, 0 = status only
```

### ⚠️⚠️ NEVER send `verno` to this endpoint

TnT folds `verno` into its licence check. **Any** value — `1`, `1.3`, anything —
returns:

```
→ 200 {"ShipmentData":{"Error":"License Mismatch"}}
```

Drop `verno` and the *same* key authenticates:

```
→ 200 {"ShipmentData":{"Error":"Incorrect waybill number or No information"}}
```

That second error is the service answering about the AWB, not the credential.

This error message blames the wrong thing and it cost a full session. It was
read as "tracking needs a second licence key Blue Dart never issued us", and a
**30-combination probe matrix appeared to confirm it** — both paths × `lickey`
as licence key / consumer key / consumer secret × `loginid` as LoginID /
customer code / client id × `awb` on/off × `format` json/xml. Every cell carried
`verno`, so every cell failed for the one reason baked into all of them. A wide
matrix with a constant defect is not evidence; it is the same experiment run 30
times. The absence of `verno` is now pinned by a unit test.

`verno` is a *shipping*-API parameter. It appears in the portal's tracking curl
example, which is where we got it — the example is wrong.

### A cancelled waybill is indistinguishable from a typo

TnT drops cancelled waybills and answers `"Incorrect waybill number or No
information"` for them — identical to a number that never existed. Observed on
AWB 21089967146 after its cancellation. **Never report "not found" as "invalid
AWB"** at this layer; the two cannot be told apart.

DHL Unified *does* retain cancelled-shipment history, which is the one thing it
gives us that TnT does not:

```
09:47  pre-transit/PU  Online shipment booked
09:48  transit/PU      SHIPPER INSTRUCTED TO RTO THE SHIPMENT   ← the cancellation
10:02  pre-transit/PU  PICKUP HAS BEEN REGISTERED
```

Note a cancellation surfaces as **shipper-instructed RTO**, not as a "cancelled"
status — `classifyDhlStatus` reading the description before the coarse
`statusCode` is what keeps that from looking like ordinary transit.

DHL's Unified Shipment Tracking API returns the same scans for the same AWB
using the API-gateway key we already have and that is already approved:

```
GET https://api-eu.dhl.com/track/shipments?trackingNumber=21089967146
    DHL-API-Key: <gateway client id>
→ 200 {"shipments":[{"id":"21089967146","service":"bluedart",…}]}
```

One approved credential beats chasing a second one. The adapter falls back to
Blue Dart's native endpoint if `BLUE_DART_TRACKING_LICENCE_KEY` is ever set, so
that path stays open without a code change.

⚠️ `classifyDhlStatus` consults the **description before** the coarse
`statusCode`, because DHL collapses outcomes we must keep apart: the live probe
returned `statusCode: "transit"` for `"SHIPPER INSTRUCTED TO RTO THE SHIPMENT"`.
Treating an RTO as ordinary transit makes a parcel coming *back* look like one
still going out. An unrecognised scan maps to `in_transit`, never `delivered`
(#1206's rule).

### Known gaps

- **`getLabel` throws by design.** Blue Dart returns the label PDF inline with
  the waybill only when `PDFOutputNotRequired` is false, and there is no
  standalone label-fetch endpoint on the documented surface. Throwing a named
  error beats returning an empty result the UI renders as a broken link.
- **No pickup-location registry.** Collections are booked per-AWB against the
  account's origin area, so `registerPickupLocation` / `listPickupLocations` are
  deliberately not implemented — a stub returning `[]` would make the
  carrier-pickups UI claim a location is unregistered when registration isn't a
  concept here. `carrier-pickups` keeps its own `["shiprocket","delhivery"]`
  list and is unaffected.
- **Not registered as a native Medusa fulfillment provider.** This is the
  `resolveShippingProvider` path only (what every admin route uses), not the
  `ENABLE_CARRIER_FULFILLMENT` block in `medusa-config.ts`.
- **A live waybill HAS been generated** — AWB 21089967146, booked 2026-08-13
  09:47 and cancelled 09:48, with a pickup registered at 10:02. It billed the
  prepaid account. Earlier drafts of this note and the #1285 handoff claimed no
  live waybill had ever been generated; that was wrong, and the DHL Unified
  event history is the receipt. The end-to-end path (book → cancel → pickup) is
  therefore carrier-proven, not just unit-proven.
- **No tracking call has returned shipment DATA.** Every live probe hit a
  cancelled AWB, which TnT will not serve. The credential and query shape are
  confirmed; a positive-data read needs a live, uncancelled waybill, which costs
  money to create.

## Env

See `.env.template`. Two layers: the developer.dhl.com gateway pair
(`BLUE_DART_CLIENT_ID` / `_SECRET`) that mints a 24 h JWT, and the shipping
account (`BLUE_DART_LOGIN_ID`, `_LICENCE_KEY`, `_CUSTOMER_CODE`) that travels in
the request body. Both required. The resolver prefers an encrypted
`shipping_platform.api_config` record and falls back to env, same as the other
carriers.

## Verify

```bash
pnpm test:unit --testPathPattern="bluedart-adapter|dhl-unified-tracking|plan-cancelled-fulfillment-data"
npx medusa exec ./src/scripts/seed-courier-changed-email.ts
```
