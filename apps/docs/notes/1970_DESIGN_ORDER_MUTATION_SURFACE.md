# Design Orders — the Mutation Surface, for #1970

## Purpose

A **design order** is not an entity. It is a **cart** carrying custom-priced
design line items, produced by `createDraftOrderFromDesignsWorkflow`
(`apps/backend/src/workflows/designs/create-draft-order-from-designs.ts`), and
shared with the buyer as a link they agree to before it becomes an order.

Everything about one was decided when it was created, and nothing could change
afterwards. Medusa's cart mutations are store-side, so **no admin route could
touch a cart**: an order created without a buyer stayed buyer-less forever, and
a price agreed after the fact had no way in. The admin screen offered no
controls because there was nothing to call.

This note records what the mutation surface now is, and — more usefully — the
three places where the obvious implementation is wrong.

---

## 1. The buyer lives in TWO places

`GET /admin/designs/orders/:lineItemId`
(`apps/backend/src/api/admin/designs/orders/[lineItemId]/route.ts`) resolves the
buyer from three sources, in order:

1. the **design↔customer link** (`designCustomerLink`), line 85
2. `cart.customer_id`, line 278
3. the converted order's customer, line 294

Because the read falls back, a **write** that touches only one side leaves the
other stale — and the fallback hides it:

| Wrote | Result |
| --- | --- |
| link only | The admin screen shows a buyer. Checkout still has `customer_id: null` and `email: null`, so nothing can be sent to them and the order completes **anonymous**. |
| cart only | Checkout is correct, but every reader that goes through the link — the design pages, the status emails — still says nobody owns this design. |

This is the shape of #1946: one surface writing one side of a pair while
another surface reads the other.

`POST /admin/designs/orders/:lineItemId/customer` therefore writes **both**, and
writes the **cart first**. If the link write then fails, the detail route still
resolves the buyer through its cart fallback, so the order stays correct and
recoverable. The reverse order would leave exactly the reads-as-owned /
checks-out-anonymous split the route exists to prevent.

### The link is a list, so an attach must also dismiss

`design-customer-link` is `isList: true` on **both** sides
(`apps/backend/src/links/design-customer-link.ts`). Attaching without dismissing
accumulates buyers, and the detail route then reads `[0]` — whichever row the
database returns first.

This is not hypothetical. A local design order already held **two** live
customer links before any of this work; the attach cleaned it up. It is the same
row-order roulette as `stores[0]` (#1979) and `take: 1` (#1983), in the field
that decides whose order it is.

---

## 2. `cart.completed_at` does NOT mean "converted"

The first implementation refused to mutate a converted design order by checking
`cart.completed_at`. Driving it against a real converted order showed it sail
straight through: the UI reported *"Repriced 1200 → 1234.5 EUR"* on an order
that had already been placed, and the buyer's **order** was untouched. A silent
no-op, reported as success.

Measured, which is why this is not a one-row fluke:

| Signal | Coverage |
| --- | --- |
| `cart.completed_at` | set on **2 of 48** carts |
| `order_cart` link | **1 row for 290** orders |

Neither is usable as a guard. The repo already ships
`apps/backend/src/scripts/backfill-converted-cart-completed-at.ts` because of
the first gap.

`isConverted()`
(`apps/backend/src/api/admin/designs/orders/mutate-design-order.ts`) therefore
asks the **linked order** as well — the same signal the detail page uses to
decide it is past the cart stage, so the UI and the API agree about what
"converted" means instead of each deciding privately.

:::warning Known imprecision
That link is per **design**, not per cart. A repeat customer's *second* design
order for the same design reads as converted and is refused. That is the safe
direction: refusing costs an operator one order edit, while allowing it writes a
number nobody will ever read.
:::

---

## 3. The price is custom, so nothing will ever correct it

Design line items are created with `is_custom_price: true`
(`create-draft-order-from-designs.ts:304`). Nothing recalculates them — which is
exactly what makes writing one safe, and exactly why a wrong one stays wrong.

`POST /admin/designs/orders/:lineItemId/reprice` therefore refuses anything that
is not `> 0`. `Number(null)` and `Number("")` are both `0`, so a missing field
arrives looking like a deliberate zero, and a price of 0 is a claim rather than
a price — #1900 caught one live on the storefront.

There is **no currency argument**, deliberately. The cart's region fixes the
currency; a price entered in another one would be valued by one number and
labelled by another, which is the #1979 shape.

---

## The routes

```
POST /admin/designs/orders/:lineItemId/customer   { customer_id: string | null }
POST /admin/designs/orders/:lineItemId/reprice    { unit_price: number }
```

Both refuse a converted design order with **409** and a message naming the
repair ("change the customer on the order itself" / "reprice it through an order
edit, not the cart"). The admin surfaces that message verbatim: a generic
"failed" would leave an operator retrying something that can never succeed.

The decision logic is pure and container-free — `decideCustomerAttach`,
`decideReprice`, `isConverted` — so every rule above is exercised without a
cart, a container, or a link module.

---

## Admin UI

Both are `RouteDrawer` sub-routes, the platform's convention for editing an
entity that already exists (the same shape as
`routes/production-runs/[id]/@edit`):

```
/app/design-orders/:id/customer
/app/design-orders/:id/reprice
```

Two things worth knowing if you add another:

- **`hasOutlet` must be true on the parent page.** With it false the nested
  route never mounts: the URL changes and the page renders unchanged, which
  looks exactly like a dead button and is invisible to a type-check.
- **Use `RouteDrawer.Title`, not a bare `Heading`.** Radix refuses to treat a
  `DialogContent` without a `DialogTitle` as accessible and logs it on every
  open; a screen reader then announces the drawer with no name. Do *not* wrap
  the subtitle in `RouteDrawer.Description` — it renders its own `<p>`, does not
  honour `asChild` here, and nests a `<p>` inside a `<p>`.

The buyer picker uses the shared `Combobox`
(`apps/backend/src/admin/components/inputs/combobox/combobox.tsx`) with
`onSearchValueChange` driving the **server** query. There is no bounded list of
customers to hold in memory, and a combobox filtering only what it was handed
would silently stop at whatever first page it loaded.

The reprice entry point appears **only** on the pre-checkout Items view. Once
the order exists the other branch renders and the route answers 409 — an action
that cannot succeed should not be offered.

---

## What is still open

- **Repricing may be rarely reachable.** Every design order in a local database
  was already converted, so the button never appeared for any of them. If that
  is typical of production, repricing via order edit matters more than this
  route does.
- **The success path is unverified end to end.** A fresh design order cannot be
  created on a database whose house store is unset:
  `POST /admin/designs/draft-order` fails with `no_house_store` — itself the
  #2064 refusal working correctly rather than picking `stores[0]`.
- **Neither route has an integration test.** The two existing design-order
  integration specs are red on `main` for an unrelated reason (#2096).
