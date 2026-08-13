# Carrier authentication — Delhivery, Shiprocket, Blue Dart

How each carrier authenticates, where the credentials come from, and what the
token lifecycle actually is at runtime (which is not what the client code alone
suggests).

## The short answer on tokens

**Every carrier call mints a fresh token.** Both token-based clients cache
internally, and both caches are defeated by the same thing: `resolveShippingProvider`
constructs a **brand-new adapter and client on every call**
(`resolver.ts` — `return new DelhiveryProviderAdapter(...)` /
`new ShiprocketClient(...)` / `new BlueDartProviderAdapter(...)`). There is no
instance cache, no container registration, no module singleton. The client lives
for one API call and is then garbage.

So the in-client caches only ever help when a *single* client instance makes
several calls in a row — which today only happens inside a single
`createShipment` or `schedulePickup`.

| Carrier | Credential | Round trip before the real call? | In-client cache | Effective lifetime |
|---|---|---|---|---|
| **Delhivery** | Static API token | **No** — sent directly | n/a | n/a |
| **Shiprocket** | email + password → JWT | **Yes**, one login | `this.token`, TTL ~10 days | One resolve |
| **Blue Dart** | clientID + clientSecret → JWT | **Yes**, one login | `cachedToken`, 24 h − 5 min | One resolve |

**This is a real cost, not a theoretical one.** Every Blue Dart label, pickup and
tracking call pays an extra HTTPS round trip to `/token/v1/login`, and every
Shiprocket call re-authenticates with email+password. Blue Dart's own token is
valid for 24 hours; we discard it after one use.

### Why it hasn't been fixed yet

Caching across requests needs somewhere to put the token that outlives the
request — a module-scoped `Map`, or the container. That is a small change, but it
is a **correctness** change, not just a speed one: a cached token has to be
invalidated on 401, on credential rotation via
`shipping_platform.api_config`, and per-carrier-per-account (the resolver can
return different credentials for different platform rows). Worth doing
deliberately rather than as a drive-by.

`ShiprocketClient` already has the hook: `options.token` is documented as
"inject a token to skip the login round-trip (e.g. cached)" — the resolver simply
never passes one.

## Where credentials come from

All three resolve **DB-first, env-fallback** (`resolver.ts`):

1. A `shipping_platform` row whose `api_config.provider` / `provider_type` /
   `name` matches the carrier, case-insensitively.
2. Each secret prefers the encrypted `<field>_encrypted` blob and falls back to
   plaintext (`readSecret`), mirroring the google-ads workflow steps.
3. If no row matches, the `process.env` values are used — the local-dev path.

## Delhivery — static token

```http
Authorization: Token <api_key>
```

No login endpoint, nothing to expire, nothing to cache. The simplest of the
three, and the reason Delhivery calls have no auth failure mode beyond "wrong
key".

## Shiprocket — email/password → JWT

```
POST /v1/external/auth/login   { email, password }  →  { token }
Authorization: Bearer <token>
```

- Token TTL is ~10 days.
- `request()` retries **once** transparently on a 401, re-logging in — so an
  expired injected token self-heals rather than failing the call.
- ⚠️ Shiprocket's WAF 403s some networks (the office laptop); a VPN clears it.
  A 403 here is not an auth problem.

## Blue Dart — two layers, and both must be right

This is the one that trips people up. Blue Dart has **two independent
credentials**, and a valid one of each is required:

```
GET /in/transportation/token/v1/login
    clientID: <gateway client id>
    clientSecret: <gateway client secret>
 →  { "JWTToken": "..." }

then, on every call:
    JWTToken: <token>          ← NOT "Authorization: Bearer"
```

**Layer 1 — the API gateway pair** (`BLUE_DART_CLIENT_ID` / `_CLIENT_SECRET`)
mints a 24-hour JWT. This says the *application* may call the API.

**Layer 2 — the shipping account** (`BLUE_DART_LOGIN_ID`, `_LICENCE_KEY`,
`_CUSTOMER_CODE`) travels in the request **body**, inside a `Profile` object.
This says *which Blue Dart customer* is shipping.

> A valid JWT tells you nothing about whether the shipping account is right, and
> vice versa. A correct gateway pair with a wrong LicenceKey fails deep inside
> the call with `UnauthorizedUser`, long after the token succeeded.

### Casing is not consistent across Blue Dart endpoints

| API | Wrapper keys |
|---|---|
| Waybill (generate/cancel) | `Request` / `Profile` — **capitalised** |
| Pickup (register/cancel) | `request` / `profile` — **lowercase** |

Getting this backwards yields a null-reference error or a 500, never a
validation message. Both were hit live on 2026-08-13.

### Tracking is a third credential story

Blue Dart's TnT endpoint authenticates with the **same shipping licence key** —
there is no separate tracking credential. But it must be called **without a
`verno` parameter**: TnT folds `verno` into its licence check, so any value
returns `{"Error":"License Mismatch"}` — an error that blames the credential for
a parameter fault. See `BLUEDART_INTEGRATION.md`.

### Sandbox has its own shipping credentials

The sandbox gateway (`apigateway-sandbox.bluedart.com`) accepts the **production
gateway pair** and mints a JWT happily — then the shipping account returns
`UserDoesNotExists`. Sandbox issues separate LoginID/LicenceKey values which we
do not hold, so there is currently **no sandbox path**; everything is exercised
against production.

## Failure-message decoder

Carrier auth errors are frequently misleading. Observed live:

| Message | What it actually means |
|---|---|
| `415 "Access to the method is not allowed"` (Blue Dart) | **Wrong path.** Not a subscription or permission problem — this gateway returns 415 for paths the app can't route to. |
| `401 "Access to the method is not allowed"` (Blue Dart) | Missing/invalid JWT. |
| `{"Error":"License Mismatch"}` (Blue Dart TnT) | Usually a stray `verno` parameter, not a bad key. |
| `UserDoesNotExists` (Blue Dart sandbox) | Production shipping creds against sandbox. |
| `UnauthorizedUser` (Blue Dart) | Good JWT, wrong LoginID/LicenceKey in the body. |
| `403` (Shiprocket) | WAF blocking the network, not bad credentials. |

## If you change any of this

- `resolver.ts` is the only place that reads credentials. Adding a carrier means
  adding a branch there and to `SUPPORTED_CARRIERS`; every admin surface picks it
  up automatically.
- Never log a token or a licence key. The Blue Dart licence key is a
  bearer-equivalent secret: it authorises shipping *and* tracking on a live,
  billed account.
