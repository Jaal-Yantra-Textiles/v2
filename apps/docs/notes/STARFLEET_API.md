# Delhivery International ("StarFleet") API — spec + gotchas

Live-verified 2026-09-02 against `api-stage-starfleet.delhivery.com` (a real AWB
`DL001113245XB` was manifested end-to-end) and `api-starfleet.delhivery.com`
(prod). Companion to `DELHIVERY_INTERNATIONAL_PARITY.md` — that file audited the
*gap*; this one documents the now-verified *contract*.

The spec is embedded in the StarFleet swagger UI (OpenAPI 3.0.2,
`https://rsgkiai9q6.delhivery.com/`) — it is NOT served at any public
`swagger.json` URL (all paths 403). The swagger's own `info.description` carries
the auth parameters.

## Auth

`POST /auth/token` (`application/x-www-form-urlencoded`) →

```
grant_type=password
username=<account>          # staging: JaalYantraTextilesPr-in-B2C · prod: 8e2306-JaalYantraTextilesPr-in
password=<password>
audience=StarFleet
scope="starfleet openid profile email ^/package/batchGeneratePackages:POST$ ^/package/batchGeneratePackages/.+:GET$ ^/package/auth-track/.+:GET$ ^/package/.+/invoice:GET$ ^/package/.+/shipping-label:GET$ ^/package/.+/upload-kyc-doc:POST$"
client_id=<client_id>
client_secret=<client_secret>
```

→ `{ access_token, id_token, expires_in: 86400, token_type: "Bearer" }`. Package
endpoints authenticate with `Authorization: Bearer <access_token>`.

### 🔴 Gotcha #1 — the scope must be QUOTED

The `scope` value is the literal `scope="starfleet openid … $"` **with the
double-quotes**. A bare `scope=starfleet openid … $` (no quotes) mints a token
that returns `401 Unauthorized` on every `/package` endpoint. The `\/` and `\:`
escaping the swagger renders is **irrelevant** — quote vs no-quote is what
decides whether the token works. When executing via code, URL-encode the whole
`scope` param (`URLSearchParams` does this; just keep the quotes inside the
value).

### Gotcha #2 — `client_name` must be the account name

`client_name` in the manifest must equal the account username (e.g.
`8e2306-JaalYantraTextilesPr-in`). Anything else → `403 Unauthorized User`. The
value is also visible in the token's `client_name` claim (decode the JWT).

## Endpoints

| Purpose | Method | Path | Status |
|---|---|---|---|
| Manifest (async) | POST | `/package/batchGeneratePackages` | ✅ verified |
| Poll job | GET | `/package/batchGeneratePackages/{id}` | ✅ verified |
| Track | GET | `/package/auth-track/{id}` | ✅ verified |
| Invoice | GET | `/package/{id}/invoice` | ⚠️ 403 `Unauthorized User` |
| Shipping label | GET | `/package/{id}/shipping-label` | ⚠️ 403 `Unauthorized User` |
| Upload KYC | POST | `/package/{id}/upload-kyc-doc` | ⚠️ 502 `Internal server error` |

`auth-track/{id}` accepts up to 15 comma-separated waybills.

## Manifest — `POST /package/batchGeneratePackages`

Async: returns `{ payload: { id } }` (a job id), then poll
`GET /package/batchGeneratePackages/{id}` until
`payload.status ∈ { COMPLETED, FAILED }`. The AWB is
`payload.data.success_waybills[].waybill` (matched by `order_id`); failures land
in `payload.data.error_waybills[].reason`.

The manifest is BULK (`packages[]`, swagger says min 2 but a one-row batch
works). Fields marked mandatory for exports carry `*^` in the schema.

### Gotcha #3 — pickup is `pickup_warehouse_id` + `zip`/`state`/`city`

```json
"pickup_location": {
  "pickup_warehouse_id": "<warehouse name>",
  "country": "IN",
  "zip": "<pickup pincode>",
  "state": "<pickup state>",
  "city": "<pickup city>"
}
```

- The warehouse is created via the **domestic** endpoint
  `POST /api/backend/clientwarehouse/create/` (Token auth, `staging-express` /
  `track.delhivery.com`), then referenced by its `name` as `pickup_warehouse_id`.
- The warehouse registry is **per-environment**: a prod warehouse does not exist
  in staging. On staging this surfaces as
  `ClientNotFoundException<… not found or XB is disabled>`; earlier attempts
  also saw `PickupPincodeNotFoundException` / `PickupStateNotFoundException` when
  the pickup was malformed or the env lacked the warehouse.
- An unregistered address (`type/address/city/state/country/zip`, **no `name`**)
  is also accepted, but only worked once the warehouse existed.

### Gotcha #4 — products need IGST fields even at 0

Each `products[]` item must carry `igst_rate` and `igst_amount` (both `0` for a
sample) plus `euec: false` / `meis: false`. Omitting them fails manifestation
with `AMX Manifestation Failed: Details.AdditionalProperties[0].Value - Value is
empty`.

### Gotcha #5 — `return_location` + `add_on_services` + full consignor KYC

A manifest that reaches AMX also expects `return_location`
(`{ address, zip }`), `add_on_services` (`{ free_domicile, signature_pod }`), and
a full `consignor` (name/address/phone/email + `document_id`, `document_type`,
`iec`, `pan`, `gstin`, `bank_ad_code`, `bank_ifsc`, `bank_ac`). The IEC/PAN/GSTIN/
bank block is account-level KYC (config), mandatory for `commercial` shipments.

`free_domicile: true` = "bill duties to shipper" = DDP (aligns with
`customs.incoterm === "DDP"`).

## Not working (Delhivery-side, pending)

- **invoice / shipping-label** → `403 Unauthorized User` even with a valid,
  correctly-scoped token (track with the same token is 200). Either a per-user
  `id_token` requirement (our `id_token == access_token`, a client-level token
  with `user_type: "CL"`) or the shipment not being label/invoice-ready.
- **upload-kyc-doc** → `502 Internal server error` (their gateway) for PNG and
  PDF alike. Request contract is `dlv-image-type: Front|Back` +
  `Content-Type: image/jpeg|png|jpg|application/pdf` + binary body →
  `{ success, message }`.

No cancellation endpoint exists in the scoped surface.

## Environment matrix

| env | `STARFLEET_ENV` | base | warehouse |
|---|---|---|---|
| staging | unset (default) | `api-stage-starfleet.delhivery.com` | created via `staging-express` `clientwarehouse/create` |
| prod | `prod` | `api-starfleet.delhivery.com` | prod warehouse (gates: wallet `InsufficientBalance`) |

🔴 The host is selected by `STARFLEET_ENV` and **defaults to staging**. Anything
other than the exact string `prod` (case- and space-insensitive) stays on
staging, so turning prod on is a deliberate act rather than a side effect of a
deploy.

⚠️ Because the warehouse registry is per-environment, prod credentials pointed
at the staging host do NOT fail at auth. They authenticate, and then
`pickup_warehouse_id` resolves against a registry that has never heard of that
warehouse — surfacing as a manifestation error that reads like bad shipment
data. If a manifest fails on an unknown warehouse, check the host first.