---
title: "Quote lines: attaching a design, and refusing a foreign one"
sidebar_label: "Design lines"
sidebar_position: 2
---

# Design lines on a quote

**Issues:** [#1501], [#1486] · **Shipped:** #1501
**Code:** `apps/backend/src/modules/partner-quote/lib/design-lines.ts`, plus a
panel in each of the two quote wizards.

## The gap

`design_by_variant` has existed since #1486 and the mint has always frozen it
onto the line — but **only the design picker could write it**. A line found the
ordinary way, in the product table, could never be told what it was made to; a
line that arrived through a design could never be corrected or cleared.

Half-writable: one entry point, no edit, no clear. The other half matches how
partners actually work — they know the product, and the design is what they add
afterwards.

## 🔴 The hole it uncovered

```js
.filter((l) => l?.design_id && !l?.variant_id)   // a line WITH a variant skipped resolution entirely
```

So **any string at all** could be frozen onto a commercial document as its
design — including another partner's design id. Nothing renders design data on
the buyer page, which is the only reason this was not a leak. An unchecked
foreign id on a signed document is the #1496 family and does not get to wait for
a renderer to make it real.

Every named design is now resolved, and a line that already names its variant
must prove its design is **visible**. The refusal reuses the wording a missing
design gets, so an id cannot be probed for existence by attaching it to a line.

## Visibility, not resolvability — the asymmetry is the point

| design | quoted ALONE | attached to a chosen variant |
|---|---|---|
| resolves to one variant | ✅ | ✅ |
| no product behind it | ❌ nothing to price | ✅ **the ordinary case** — the sketch a catalogue product was made from |
| sold as several variants | ❌ which SKU? | ✅ the SKU is already chosen |
| not yours / not there | ❌ | ❌ |

`DesignResolution` grows an explicit `visible` rather than inferring two
questions from one field. The readiness preflight makes the same split —
otherwise it reports *"sold as 3 variants"* as blocking on a line whose variant
is already chosen, inventing a problem the partner cannot fix and did not have.

:::danger The variant is never moved
Attaching a design must not silently re-point the line at a different SKU. That
would change *what is being sold* as a side effect of recording *what it was
made from*.
:::

## Admin vs partner scoping

The admin mint resolves design lines **unscoped by partner** — an admin
legitimately quotes a design the producing partner does not own. The guard that
matters on that surface is the next one: the resolved variant still has to be in
that partner's sales channel (`assertVariantsInStore`), because an admin picks
the partner from one dropdown and the variants from another, and a single
mis-click would freeze one partner's prices onto another partner's customer
group.

## UI

A panel under the quantities grid, not a grid column: a design is chosen from
hundreds **by name**, which is a search, and that grid is a numeric keyboard
surface whose arrow-key navigation a combobox fights. Only quantity-bearing
variants are listed.

Both wizards, deliberately — [#1380] landed a fix on four of five creation paths
and the fifth was the one that mattered.

## ⚠️ Watch-outs

- 🔴 **`apps/partner-ui` still has no CI** — `tsconfig` excludes `apps/*`. Its
  half was type-checked and built by hand. The two decisions with a way of being
  quietly wrong are extracted into a pure module with vitest coverage, and the
  admin copy carries the same assertions under jest so a drift goes red:
  - an empty quantity must read as **not a line** — `Number("")` is `0`, the
    same coercion that once parsed a truncated quote link as *remove this line*;
  - clearing a design must **delete the key**, not write `""` — the payload
    builder sends `design_id` whenever the entry is present, so `""` would
    travel to the mint as a design id and be refused, turning "clear this field"
    into a failed mint.
- **The panels themselves have not been clicked.** There is no DOM harness in
  either app.

[#1380]: https://github.com/Jaal-Yantra-Textiles/v2/issues/1380
[#1486]: https://github.com/Jaal-Yantra-Textiles/v2/issues/1486
[#1501]: https://github.com/Jaal-Yantra-Textiles/v2/issues/1501
