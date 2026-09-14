---
title: "Design → Product: what minting guarantees (and what it does not)"
sidebar_label: "Design → Product Minting"
sidebar_position: 1
---

# Design → Product: what minting guarantees

When a design becomes something you can sell, one workflow does the work:
`createProductFromDesignWorkflow` (`src/workflows/designs/create-product-from-design.ts`).

This guide is the ideal path — what the minted product *should* look like, what
it looks like today, and where the two still differ. It exists because the gap
between those two cost us a real order that has read the wrong size since
September 2026.

---

## The three doors

Three callers mint. They are the same workflow, so a defect in it appears in all
three:

| Door | Route / caller | When |
|---|---|---|
| **Design approve** | `POST /admin/designs/:id/approve` | An operator approves a design |
| **Run output approve** | `approve-run-output.ts` | A completed run's output is accepted |
| **Quote** | `ensure-design-quote-variant.ts` | A quote needs something to price |

:::danger Two different things are called "approve"
Setting `design.status = "Approved"` — the status dropdown, or `update_design` —
**mints nothing**. No product, no variant, no price. Only `POST
/admin/designs/:id/approve` mints.

Check which happened with `list_design_products`. `count: 0` after a status
change is the correct answer, not a failed read.

The UI button lives on the design's **Production Runs** sub-page
(`/app/designs/:id/production-runs`) and is gated on
`design.status === "Technical_Review"` — **not** on a production run existing.
A design at `Conceptual`, or already at `Approved`, shows no button. That
placement is misleading and is listed under [Ideal path](#the-ideal-path) below.
:::

The route's only precondition is `estimated_cost > 0`. A design with no cost is
refused rather than listed at 0 (#1900).

---

## What a mint produces today

### Mock: a design with ONE size

```jsonc
// design
{
  "id": "des_ABC",
  "name": "Cream Hand Loom Tweed Jacket",
  "design_type": "Original",
  "size_sets": [{ "size_label": "M" }]
}
```

```jsonc
// product minted from it — CURRENT behaviour
{
  "title": "Cream Hand Loom Tweed Jacket",
  "options": [
    { "title": "Original", "values": ["Cream Hand Loom Tweed Jacket"] }
  ],
  "variants": [
    {
      "title": "Cream Hand Loom Tweed Jacket — M",   // ✅ size is here
      "sku": "CUSTOM-des_ABC-M"                       // ✅ and here
    }
  ]
}
```

### Mock: a design with TWO sizes

```jsonc
// design
{ "id": "des_XYZ", "name": "Cream Hand Loom Tweed Jacket",
  "size_sets": [{ "size_label": "S" }, { "size_label": "M" }] }
```

```jsonc
// product minted from it — CURRENT behaviour
{
  "options": [
    { "title": "Original", "values": ["Cream Hand Loom Tweed Jacket"] }
  ],
  "variants": [
    {
      "title": "Cream Hand Loom Tweed Jacket",  // ⚠️ no size
      "sku": "CUSTOM-des_XYZ"                   // ⚠️ no size
    }
  ]
}
```

**The minter abstains on purpose.** It does not pick `S`, because a variant
whose sku *looks* authoritative and is wrong is worse than one that is visibly
silent. See [The ideal path](#the-ideal-path) for where this goes next.

:::info The option answers "which design", never "which size"
`options[0].title` is the design's `design_type` and its value is the design's
**name**. That is #1874: one product can accumulate a variant per design without
two of them claiming the same option tuple. The size rides on the variant's own
title and sku, which adds no option and no second variant.
:::

---

## When a RUN is being approved, the run wins

`approve-run-output` mints through the same workflow, but it knows something the
design does not: **which size the work actually produced.** Each run snapshots
its own `size_sets` at the moment the work was commissioned.

Order 89 is exactly this shape:

| Source | Says | Usable? |
|---|---|---|
| The design | `S` and `M` | ❌ ambiguous — abstains |
| The runs that made it | `M`, `M` | ✅ **M** |

So the run door passes `size_label` into the mint, and it beats the design's own
size_sets. The rule across a batch (`resolveRunsSizeLabel`), because approval
mints per **design** and several runs are approved together:

| Runs in the batch | Result |
|---|---|
| `[M]`, `[M]` | **M** |
| `[M]`, `[S]` | `null` — a product cannot be both |
| `[M]`, `[S, M]` | **M** — a run that names no single size contributes nothing |
| `[S, M]`, `[]` | `null` |

:::tip A run that says nothing is not a veto
A run whose snapshot names no single size contributes **nothing** rather than
blocking its siblings. That is deliberately the same rule
`backfill-parent-run-produced-quantity` (#1877) settled on: a child that never
reported output contributes nothing, instead of having what it was *asked* to
make promoted into a record of what it *did* make.
:::

---

## The defect this guide came from

**Reproduced on production, 2026-09-14, in a clean room** — no order, no
production run, no partner, no prior history:

| Step | Result |
|---|---|
| Created design `01M2F1649Y82W0NYW4T9TXV9NF` with `size_sets` **S and M** | both sizes present from creation |
| Approved it 28 minutes later | minted `prod_01M2F2V2C1A656WMHTX0FFNKDH` |
| Read the product back | **one** variant, sku `CUSTOM-01M2F1649Y82W0NYW4T9TXV9NF` |
| Looked for the sizes | **neither "S" nor "M" appeared anywhere** — not as option, value, title or sku |

The cause was not a race and not a bad merge. The workflow's `query.graph`
**never selected `size_sets`**, so the minter could not have used the sizes even
in principle.

### What it cost

Order **89**'s line item is bound to a variant titled **"Small"**, while every
production run that made it says **Medium**.

| Time (2026-09-10) | Event |
|---|---|
| 12:00:13 | size_sets S and M created on the design |
| 12:00:29 | product minted — **one sizeless variant**, sku `CUSTOM-<design>` |
| 12:00:32 | order line bound to it |
| 12:03:32 | real Size values added **by hand** |
| 12:03:37 | Medium variant created by hand |
| 14:10:05 | the original placeholder **relabelled "Small"** |

Nothing was wrong with the binding. The thing it bound to had no size to be
right about, and a human later gave it one.

:::tip The lesson worth keeping
A placeholder that someone later relabels is indistinguishable, afterwards, from
a deliberate choice. The line item's `variant_sku` snapshot still reads
`CUSTOM-<design_id>` with **no suffix** — that leftover is the only surviving
evidence that it was never "Small" at all.
:::

---

## The ideal path

Ordered by how much each is worth, not by effort.

### 1. Ask when the answer is missing or ambiguous ✅ recommended next

Today a multi-size design mints silently and someone fixes it by hand minutes
later — or doesn't. The mint should **ask instead of guessing or abstaining**.

**Mock behaviour — the approve dialog when sizes are ambiguous:**

```text
┌──────────────────────────────────────────────────────────┐
│  Approve "Cream Hand Loom Tweed Jacket"                  │
│                                                          │
│  This design states 2 sizes. Which should the product    │
│  list?                                                   │
│                                                          │
│   ☑ S     ☑ M                            [ Select all ]  │
│                                                          │
│  → 2 variants: CUSTOM-des_XYZ-S, CUSTOM-des_XYZ-M        │
│                                                          │
│  Price ₹11,000 applies to each.                          │
│                                                          │
│              [ Cancel ]         [ Approve & create ]     │
└──────────────────────────────────────────────────────────┘
```

**Mock behaviour — when the design states no sizes at all:**

```text
┌──────────────────────────────────────────────────────────┐
│  Approve "Cream Hand Loom Tweed Jacket"                  │
│                                                          │
│  ⚠️ This design states no sizes.                          │
│                                                          │
│  The product will list ONE variant with no size          │
│  (CUSTOM-des_XYZ). Orders for it cannot say which size   │
│  was made.                                               │
│                                                          │
│  Add sizes to the design first?     [ Edit design ]      │
│                                                          │
│      [ Cancel ]       [ Approve without sizes ]          │
└──────────────────────────────────────────────────────────┘
```

The rule: **the operator is told what they are getting, before they get it.**
Approving without sizes stays possible — it is ordinary for some designs — but
it becomes a decision rather than a silence.

### 2. One variant per size_set

A real `Size` option alongside the design-identity option, one variant per size.
This is the honest end state and it is **not small**: it changes the variant
tuple, the multi-currency price fanout (per variant), the auto-created inventory
item (per variant), and it forces a rule for **which** variant an order line
binds to. Track separately; do not smuggle it into a naming change.

### 3. Move the approve control off the Production Runs page

The button that mints the product lives on the design's *Production Runs*
sub-page, which strongly implies a run is required. It is not — the gate is
purely `status === "Technical_Review"`. Put it where a person looks for it.

### 4. Re-point line items when real sizes arrive

When size variants are added to a design-backed product after the fact, existing
line items still point at the placeholder. Nothing moves them. Order 89 is the
open instance.

---

## Rules for anyone touching the minter

1. **Never invent a size.** One size_set means one answer; two mean the design
   has not decided, and neither has the minter. Abstain or ask — do not pick.
2. **A blank label is not a label.** `""` and `"   "` must not become the sku
   suffix `CUSTOM-<id>-`. `''` passes a `!= null` check.
3. **Check the `query.graph` select before adding a rule that reads a field.**
   This entire defect was a field that was never fetched: the helper would have
   been correct and would still have done nothing. A rule reading an unfetched
   field looks exactly like a rule that works and never fires.
4. **Leave `optionValue` alone.** It is the design's name, and #1874 depends on
   it.
5. **Mutation-check every new assertion.** Break the rule deliberately and watch
   the test go red. `Tests: 0 total` is a compile failure, not a red test.

---

## How to verify

```bash
cd apps/backend

# The pure rules — naming, size resolution, price
npx jest --config jest.config.js \
  --testPathPattern="create-product-from-design.unit"
```

Against production, after a mint:

```
list_design_products(id: "<design_id>")
```

Read the variant's **sku**, not its title — a title can be edited by hand
afterwards and tells you nothing about how the variant was born. A sku of
`CUSTOM-<design_id>` with no suffix means the product was minted without a size.
