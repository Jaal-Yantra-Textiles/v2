---
title: "Export Freight: rating from an HQ pin when the partner's cannot"
sidebar_label: "Export freight relay"
sidebar_position: 1
---

# Export freight: the origin relay

**Issue:** [#1498] · **Shipped:** #1500, #1503, #1505, #1506 (2026-08-24)
**Code:** `apps/backend/src/modules/shipping-providers/export-origins.ts`, `apps/backend/src/lib/shipping-estimate.ts`

## The problem, in one sentence

A partner in Srinagar cannot export. The carrier answers *"no serviceable
couriers"* with a **400**, every international lane fell through to a flat
manual row, and that row is the same number at 3 kg and at 22 kg — which is
why international freight read as flat at any weight.

Probed live against Shiprocket on 2026-08-24, 1.2 kg / 30×25×10:

| origin | → NL | → DE |
|---|---|---|
| `190001` Srinagar (partner) | ❌ 400, no serviceable couriers | ❌ 400 |
| `110032` / `110096` Delhi HQ | ✅ 8 couriers, from ₹1,276 | ✅ 5, from ₹1,852 |
| `176215` Himachal HQ | ✅ 1 courier, ₹2,916 | ✅ 2, from ₹1,852 |

The goods already route through a warehouse and export from there. The relay
makes the *quote* describe the movement that actually happens.

## What it does

When the destination is international **and** the partner's own pin cannot be
rated, every owned warehouse pin is tried, and the cheapest **complete** route
wins. A route is two legs, and the total is both of them:

| route | Srinagar → HQ | HQ → NL | landed |
|---|---|---|---|
| via Delhi | ₹206 | ₹1,276 | **₹1,482.36** |
| via Himachal | ₹505 | ₹2,916 | ₹3,421.05 |

The route travels **with** the number. Each calculated option carries a `route`
object naming the hub, the two leg amounts, and whether the domestic leg could
be priced — because a landed price that is silently two legs is unauditable.

## Three decisions worth knowing

### It is a fallback, not a comparison

If the partner's own pin rates, that is the answer and no hub is asked. An
earlier cut rated every origin on every quote and took the cheapest. That is
wrong twice: it spends a carrier call per hub on lanes that never needed one,
and it would silently start relaying domestic-capable shipments through Delhi
to save a few hundred rupees — a logistics decision nobody made, arriving as a
pricing change.

### It lives above the provider

The obvious home is inside `shiprocket/rate-context.ts`, and that would be
wrong. *"If the partner's origin cannot be rated, retry from an HQ origin"* has
nothing to do with Shiprocket — it applies identically to Blue Dart, DTDC and
DHL as each gains a rate API. `rateWithOriginFallback` takes a `rate()`
callback and names no carrier. Today Shiprocket is the only live international
rate source, so day one is a Shiprocket-only capability behind a
carrier-agnostic seam.

### Origins are data, not configuration

Hubs come from `location_ownership.is_core` — the warehouses already recorded
as ours. An earlier cut read `EXPORT_FALLBACK_ORIGINS`; that env var is gone.
It made the whole feature inert until somebody remembered to set it, and made
"we opened a warehouse" a deploy. A new hub is live the moment it is marked.

:::info Deliberate conflation
`is_core` was written to answer *"may we deduct consumption from this stock"*,
and this reads it as *"may we export from here"*. Those are the same set today
and there is no second table to disagree with. If they diverge, that is the
line to split.
:::

## Prod configuration (24 Aug 2026)

Two core rows:

| location | pin | → NL, 1.2 kg |
|---|---|---|
| `sloc_01JPAQVGYJR3CDP2Q2AYV7GRDR` Dharamshala | 176215 | 1 courier, ₹2,916 |
| `sloc_01M0RXH3XXDVR2PDC7XKXH7VTP` JYT HQ Delhi | 110096 | 8 couriers, ₹1,276 |

## Caching

One carrier call **per leg**, cached 900s under a key of
carrier · origin · destination · country · weight bucket. Per-leg rather than
per-quote: `110032 → NL at 1.2 kg` is the same question for every partner, so
the second partner to quote that lane pays nothing for it. Weights are bucketed
to 500 g so a buyer dragging a quantity slider does not mint a rate per step.

The cache holds the **unfiltered** carrier answer. Caching the currency-filtered
list under a key with no currency in it would serve an INR quote's survivors to
a EUR one — the very bug the guard exists to prevent, reintroduced through the
cache.

## 🔴 Watch-outs

- **Never run `set-location-ownership seed:true`.** Its inference keys on *"is
  this a partner store's default location"*, which is wrong for export
  purposes. Against prod it proposes marking *Bhagalpur Silks*, *Le Atelier*,
  *Azmat Handloom* and five others core while leaving **Main Warehouse** out.
  Applying it would silently turn a dozen unrelated addresses into export
  origins. Set rows one at a time.
- **A rated route is not permission to ship it.** Readiness refuses a country
  with no configured lane — *"No freight option could be quoted to DE from this
  store's location"* (#1497) — **before** the relay is consulted. The relay only
  helps a store that already has the lane configured.
- **`EXPORT_FIRST_LEG_IS_SUNK` defaults to charging the first leg.** Setting it
  to `true` under-quotes every relay route by ₹206–₹505 *and* ranks the hubs
  wrongly, because the leg costs do not rank the same way the export costs do.
  Set it only if stock demonstrably consolidates at HQ regardless of the order.
- **HQ pins are not interchangeable.** Delhi is 2.3× cheaper than Himachal to
  NL for the same parcel. A single hardcoded fallback silently over-quotes.
- **The `JYT HQ Delhi` street line is a placeholder.** Rating only uses the
  pin; a customs declaration does not — see the open question below.
- **A location with no valid 6-digit PIN is dropped, not passed through.**
  Shiprocket's international endpoint 400s the *whole request* on a bad
  `pickup_postcode`, so a half-filled address would take the retry with it.
- **The relay never returns 0.** A zero is indistinguishable from genuinely
  free freight and shipped bulk orders free once already (#1430).
- **A route whose two legs disagree on currency is dropped, not summed.**
- **An origin lookup that fails is logged, never silent.** A swallowed failure
  degrades to "no fallback available", which looks exactly like "correctly
  configured and not needed" — the only signal of breakage would be the absence
  of a signal.

## Open question

Does exporting from Delhi rather than Srinagar change the customs declaration
([#348])? The seller tax ID and origin address on a declaration are not the pin
used for rating. Unanswered.

[#1498]: https://github.com/Jaal-Yantra-Textiles/v2/issues/1498
[#348]: https://github.com/Jaal-Yantra-Textiles/v2/issues/348
