---
title: "Receiving material, and moving it once it is here"
sidebar_label: "Receiving & Moving Material"
sidebar_position: 1
---

# Receiving material, and moving it once it is here

Cloth arrives from a supplier, lands somewhere, and then part of it goes
somewhere else. Three different records describe that journey, and confusing any
two of them puts stock in a place it physically is not.

This guide is the recipe for the whole path, written around the order it was
built for: **86 m of GOF cotton, ₹69,340, delivered to a partner's bench.**

---

## The one sentence that matters

:::danger `Delivered` is a carrier event, not a receipt
`Delivered` is written by the Shiprocket webhook. It proves a parcel reached a
door. **It moves no stock**, and it means nobody counted what was inside.

Until someone receives the order, the inventory level reads `0` — however
OTP-verified the scan was, and with nothing anywhere having failed.

Two Mill Spun Pashminas, ₹14,000, sat at `stocked_quantity: 0` in a partner's
hands for nine days on exactly this. The parcel was delivered. The books said we
had nothing.
:::

---

## The three records, and what each one means

| Record | Answers | Moves stock? |
|---|---|---|
| **Shipment** (`Delivered`) | Did a parcel reach a door? | ❌ No |
| **Receipt** (`/receive`) | Did somebody count what was in it? | ✅ Yes — posts it at the destination |
| **Material transfer** | Did material we already own move somewhere else? | ✅ Yes — on the count at the far end |

They are not stages of one thing. An order can be `Delivered` and never
received. Material can be received and never move again. A transfer can exist
for material that arrived months ago.

---

## Recipe 1 — receive what the supplier sent

**When:** the goods are physically in someone's hands.

Receivable from `Processing`, `Ready for Delivery`, `Shipped`, `Partial` and
`Delivered` — **not** from `Pending` (nothing has left the supplier) or
`Cancelled`.

### In the admin

1. Open the inventory order → the **Goods receipt** section.
2. If the carrier says delivered and nobody has counted it, the section says so
   in red. That banner is the point of the screen.
3. Press **Receive goods**. Every line opens on its full outstanding quantity.
4. Adjust anything that did not match the paperwork, add a note, press
   **Receive onto stock**.

### By MCP

```jsonc
// The ordinary case: everything outstanding, where the order says.
receive_inventory_order({ id: "inv_order_01M1ZH...", confirm: true })
```

### Where the goods land

The order's own destination — which on a consignment order **is a partner's
location**. That is deliberate: material we bought, stocked where the partner
will cut it, and deducted there when it becomes a garment.

For the GOF order that destination is **Ksaman Naturals Pvt Ltd**, not a
warehouse of ours. If that looks wrong on screen, it is not.

:::tip Receipts are cumulative, so calling twice is safe
The rule measures against `line_fulfillments`, not a flag. A second receipt on a
fully-received order receives **nothing** rather than posting the stock twice.

Over-receipt is **refused, not clamped**: claiming 100 m against an 86 m line
fails loudly instead of quietly recording 86.
:::

---

## Recipe 2 — one delivery, two destinations

**When:** the supplier sent two consignments to two different places, and **both
have arrived**.

List the same line twice with different destinations:

```jsonc
receive_inventory_order({
  id: "inv_order_01M1ZH...",
  lines: [
    { order_line_id: "line_cloth", quantity: 60, stock_location_id: "sloc_ksaman" },
    { order_line_id: "line_cloth", quantity: 26, stock_location_id: "sloc_warehouse" },
  ],
  confirm: true,
})
```

The portions are **summed per line** before the outstanding check. Two portions
of 50 against an 86 m line each look fine alone and are an over-receipt of 14 m
together; the split is refused.

:::danger Do not use a split for material that has not arrived yet
A split receipt posts **both portions immediately**. That is correct only when
both portions are already where you are sending them.

If the partner received everything and will send part of it on **later**, that
is not a split — receive all 86 m at the partner's location, then use
[Recipe 3](#recipe-3--move-material-that-is-already-ours). Posting the balance
at a warehouse before it gets there is the same mistake as trusting
`Delivered`, one layer up.
:::

---

## Recipe 3 — move material that is already ours

**When:** material we already own goes from one location to another. A partner's
bench to our warehouse. One partner to the next partner in the chain.

Nothing was produced, nobody is being paid, and no purchase is happening. It is
a movement.

### Step 1 — record the hop

```jsonc
create_material_transfer({
  inventory_item_id: "iitem_cloth",
  from_location_id: "sloc_ksaman",     // where it is now
  to_location_id:   "sloc_warehouse",  // where it is going
  quantity: 26,                        // metres — decimals are expected
  reason: "stock",
  source_inventory_order_id: "inv_order_01M1ZH...",  // for the trail
  confirm: true,
})
```

The transfer is born `in_transit`.

:::info Nothing moves yet, and that is deliberate
Stock stays counted at the **origin** for the whole journey.

Decrementing on dispatch would make the material exist **nowhere** while it is
on a van — and "nowhere" is what makes a consumption log go negative later.
:::

### Step 2 — count it in at the far end

```jsonc
// Omit received_quantity to accept what was sent.
receive_material_transfer({ id: "gtrf_...", confirm: true })
```

This is the step that actually moves the inventory: it decrements the origin and
increments the destination in one act.

A short count posts **only what arrived**. Goods that did not turn up are never
posted because the paperwork said they were sent — the shortfall is reported
instead.

:::danger Receiving a transfer twice is refused
It would move the same material twice. A correction is a **new transfer**, not a
second receipt.
:::

---

## Which record do I want?

```
Did a supplier send it to us?
├─ yes → is it all at one place?
│         ├─ yes → Recipe 1  (receive)
│         └─ no, two consignments already delivered
│                 → Recipe 2  (split receipt)
└─ no, we already own it and it is moving
          → Recipe 3  (material transfer)
```

The question that separates Recipe 2 from Recipe 3 is **not** "how many places
does it end up in". It is **"has it arrived there yet?"**

---

## What this path does *not* do

- **It does not create an inventory order.** A transfer is a movement, not a
  purchase — nobody is paid for it.
- **It does not handle goods going back to the supplier.** A return is an
  inspection matter on the inventory order, not a destination on a receipt.
- **It does not wait for an approval.** A *production run's* output does — that
  gate exists because partner completion is a claim and admin approval accepts
  it. Material has no claim behind it, so the only gate is somebody counting it.
- **It does not tell you whose location is whose.** The destination picker lists
  every stock location and cannot yet mark ours from a partner's: ownership
  (`is_core`) is seeded `false` for every location, so a badge would currently
  call them all not-ours — including the one holding most of the stock.

---

## Reference

| | |
|---|---|
| Receive an order | `POST /admin/inventory-orders/:id/receive` · `receive_inventory_order` |
| Create a transfer | `POST /admin/inventory-transfers` · `create_material_transfer` |
| Receive a transfer | `POST /admin/inventory-transfers/:id/receive` · `receive_material_transfer` |
| Read stock back | `list_inventory_levels` |
| Find location ids | `list_stock_locations` |

Related: [Design → Product minting](/docs/guides/designs/design-to-product-minting).
