---
title: "Freight currency: why rates are converted and not dropped"
sidebar_label: "Freight currency & FX"
sidebar_position: 2
---

# Freight currency and FX

**Issues:** [#1424] (the guard), [#1502]/[#1498] (the conversion) · **Shipped:** #1505
**Code:** `apps/backend/src/lib/shipping-estimate.ts` — `convertCalculatedRates`

## Why a currency guard exists at all

`pickFreightOption` sorts on the raw `amount` and `composeQuoteMoney` adds it
straight to the subtotal. So an INR rate on a EUR quote is not merely
irrelevant — **it wins whenever its number is smaller**, and is then added to a
EUR total and rendered with a euro sign.

Seen live: Srinagar → Berlin answered ₹3,788 / ₹5,232 / ₹14,436 alongside a €35
flat row, and €35 "won" only because 35 is the smallest number.

## Why dropping them was not the end of it

#1424 shipped the guard as a **drop**, reasoning that converting needs an FX
rate the function does not have, and a wrong rate is a wrong price wearing a
confident label. That was right about the danger and wrong about the remedy.

Every carrier rate on an export lane is in INR. So on a EUR quote the
calculated list was **always empty**, and the flat manual row won by
**walkover** — not by being cheaper, but by being the only survivor. That row
is €35 at 3 kg *and* €35 at 22 kg.

:::danger The guard was underwriting a defect that looked unrelated
"International freight is flat at any weight" and "we drop rates in the wrong
currency" read as two separate problems. They were one. Always ask what was
*removed* from a comparison before crediting the winner.
:::

## What it does now

Calculated rates are converted through the FX the platform already caches,
reusing `planShippingFxConversion` — the same pure function `resolveShippingFx`
uses for order freight, so there is **one FX path**, not a second one to
disagree with it. The rate, its source and the original amount are stamped onto
the option:

```json
{
  "courier_name": "SRX Priority Pro",
  "amount": 36.42,
  "currency_code": "eur",
  "source": "calculated",
  "route": { "via_hq": true, "origin_label": "JYT HQ Delhi",
             "export_leg_amount": 3788, "domestic_leg_amount": 286.36 },
  "fx": { "original_amount": 4074.36, "original_currency_code": "inr",
          "fx_rate": 0.00893775308762373, "fx_source": "fx_rates",
          "converted_at": "2026-08-24T04:54:13.809Z" }
}
```

That stamp is what answers the original objection. A converted price can be
reproduced after FX has moved — the label now shows its working.

## The rules that did not change

- 🔴 **A rate that cannot be converted is still dropped.** A cold FX cache must
  not become a guess. That is the one thing the original drop got right.
- 🔴 **Calculated rates only.** A manual option priced in another currency is a
  different offer the partner published to buyers billed in that currency;
  converting it would invent an offer nobody made. Those are filtered out
  further up, beside the zone and rule checks.
- 🔴 **The relay never sums two legs in different currencies.** Dropped, not
  converted — a leg-level conversion belongs to the estimate layer that holds
  the rate, not to the route builder.

## Verified on prod (24 Aug 2026)

Quote `01M0S1TMHCJ72FJ7766ZGAVMKB`, Srinagar → Berlin, 3.045 kg, EUR:

| | |
|---|---|
| freight options | 10 — 7 calculated, **7 carrying an `fx` stamp** |
| cheapest calculated | €36.42 via JYT HQ Delhi (₹3,788 export + ₹286.36 domestic) |
| chosen | €35, the flat manual row |
| FX rate used | `inr→eur` 0.00893775, `fx_source: fx_rates` |

€35 still wins — **and that is the correct outcome**, because at 3 kg the flat
row is genuinely cheaper by €1.42. The proof the fix works is the non-empty
calculated list with converted amounts, not the chosen number. Before #1505 that
list was empty at every weight.

[#1424]: https://github.com/Jaal-Yantra-Textiles/v2/issues/1424
[#1498]: https://github.com/Jaal-Yantra-Textiles/v2/issues/1498
[#1502]: https://github.com/Jaal-Yantra-Textiles/v2/issues/1502
