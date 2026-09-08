# Extra-cost display surfaces — where order-line money is shown WITHOUT `extra_cost`

## Purpose

`inventory_order_line.extra_cost` is a per-unit charge (colour/dye job, finishing) that a line contributes as `(price + extra_cost) × quantity` to the order total. This doc records the read/display surfaces that show inventory order-line money using `price` alone, omitting `extra_cost` — verified line-by-line against source. All four claims in the task were checked and are **CONFIRMED**. No fixes are proposed here.

## Background: the model contract

`apps/backend/src/modules/inventory_orders/models/orderline.ts:19` defines the field:

```ts
  extra_cost: model.bigNumber().nullable(),
```

The per-unit semantics are stated in the doc comment at `apps/backend/src/modules/inventory_orders/models/orderline.ts:13-14`:

> Per-UNIT, not a line total: like `price`, a line contributes
> `(price + extra_cost) × quantity` to the order total

The same arithmetic is implemented in the write/billing paths (see Gotchas), so the omission below is a display-only divergence, not the system contract.

## Entry points (the four surfaces)

| # | Surface | Kind | Citation |
|---|---------|------|----------|
| 1 | Partner order-detail API | `GET /partners/inventory-orders/:orderId` | `apps/backend/src/api/partners/inventory-orders/[orderId]/route.ts:GET` |
| 2 | Partner work-order line list (UI) | React component `InventoryOrderLines` | `apps/partner-ui/src/components/work-orders/inventory-order-lines.tsx:InventoryOrderLines` |
| 3 | Admin inventory-orders list tooltip | Route page `InventoryOrdersPage` / `useColumns` | `apps/backend/src/admin/routes/orders/inventory/page.tsx:useColumns` |
| 4 | Admin order-detail lines section | React component `InventoryOrderLinesSection` | `apps/backend/src/admin/components/inventory-orders/inventory-order-lines-section.tsx:InventoryOrderLinesSection` |

## Key behaviours — claim-by-claim verification

### Claim 1 — Partner API response mapping omits `extra_cost`: CONFIRMED

`apps/backend/src/api/partners/inventory-orders/[orderId]/route.ts:262` maps each order line into the partner response:

```ts
        order_lines: order.orderlines?.map((line: any) => ({
```

The mapped object (lines 263–282) carries `id`, `inventory_item_id`, `quantity`, `price` (line 266: `            price: line.price,`), `metadata`, `created_at`, `updated_at`, `deleted_at`, `inventory_items`, and `line_fulfillments` — `extra_cost` is not among them. Notably the query at `apps/backend/src/api/partners/inventory-orders/[orderId]/route.ts:171` selects `"orderlines.*"`, so `extra_cost` is fetched from the DB and then dropped by the mapping. The route's JSDoc response typedef (`apps/backend/src/api/partners/inventory-orders/[orderId]/route.ts:8-19`) likewise documents only `price` ("The price per unit") with no `extra_cost` property.

### Claim 2 — Partner UI computes displayed money from `price` only: CONFIRMED

`apps/partner-ui/src/components/work-orders/inventory-order-lines.tsx:107` reads only `price` off the line:

```tsx
        const price = Number(line?.price) || 0
```

`apps/partner-ui/src/components/work-orders/inventory-order-lines.tsx:162` computes the line total as `price × quantity` (no `extra_cost` term):

```tsx
                  {price > 0 ? totalMoney(price * requested) : "—"}
```

The unit-price cell at `apps/partner-ui/src/components/work-orders/inventory-order-lines.tsx:153` is likewise price-only:

```tsx
                <Text size="small">{price > 0 ? unitMoney(price) : "—"}</Text>
```

`extra_cost` does not appear anywhere in this file.

### Claim 3 — Admin list tooltip renders `line.price` only: CONFIRMED

`apps/backend/src/admin/routes/orders/inventory/page.tsx:67` renders the per-line tooltip content inside the Partner column:

```tsx
                            {label} — Qty {line.quantity} × ₹{line.price}
```

`extra_cost` does not appear anywhere in this file.

### Claim 4 — Admin detail Price badge renders `line.price` only: CONFIRMED

`apps/backend/src/admin/components/inventory-orders/inventory-order-lines-section.tsx:118` renders the Price badge:

```tsx
                      <Badge size="small" className="text-ui-fg-subtle">Price: ₹{line.price}</Badge>
```

`extra_cost` does not appear anywhere in this file.

## Gotchas / invariants

- **The field is available to admin UI code but unused in display.** The admin `OrderLine` type exposes it — `apps/backend/src/admin/hooks/api/inventory-orders.ts:20`: `  extra_cost?: number | null;` — yet neither display component (claims 3 and 4) reads it.
- **Write/edit surfaces DO include `extra_cost`**, so the omission is specific to read/display: the admin edit form seeds it (`apps/backend/src/admin/components/inventory-orders/edit-order-lines.tsx:67`: `    extra_cost: line.extra_cost ?? 0,`) and the payload builder folds it into totals (`apps/backend/src/admin/components/inventory-orders/order-lines-payload.ts:62`: `      ((Number(l.price) || 0) + (Number(l.extra_cost) || 0)) *`).
- **Billing paths use the full `(price + extra_cost)` unit value**, so displayed line money can diverge from what is actually owed: `apps/backend/src/workflows/payment_submissions/lib/inventory-order-value.ts:121`: `    const unitPrice = num(line.price) + num(line.extra_cost)`; and the unified-order dual-write at `apps/backend/src/workflows/inventory_orders/dual-write-unified-order.ts:313`: `        const unitPrice = Number(line.price) + Number(line.extra_cost || 0)`.
- **Partner UI cannot show it even if it wanted to**: the partner API mapping (claim 1) strips `extra_cost` before it reaches `apps/partner-ui`, so the partner-side omission is enforced server-side at `apps/backend/src/api/partners/inventory-orders/[orderId]/route.ts:262-283`.
- The partner UI's footer total (`apps/partner-ui/src/components/work-orders/inventory-order-lines.tsx:197`) renders `totalPrice` passed in from the order record, which per the model comment is folded at write time (`apps/backend/src/modules/inventory_orders/models/orderline.ts:16-17`); so the order-level total can include the charge while the per-line rows beside it do not.

## Open questions / (unverified)

- Whether any other partner-ui or admin surface displays line money was not exhaustively audited beyond the four claims above and the grep for `extra_cost`; other read surfaces may exist that also omit it (unverified).
