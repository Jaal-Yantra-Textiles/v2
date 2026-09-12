# Survey: Core Medusa primitives vs hand-rolled reimplementations (design business)

> Scope: `apps/backend/src` in this Medusa 2.x repo. Three questions answered:
> (1) where core Medusa order/cart/product workflows are used, (2) where the same
> thing is hand-rolled via direct module-service calls, (3) where business meaning
> (design identity) rides in bespoke metadata / custom link tables instead of core
> primitives (`variant_id`, module links, price sets).
>
> Every claim cites a full repo-relative path (with symbol or line). Nothing here
> was inferred from filenames alone; unread behaviour is marked `(unverified)`.

## 1. Purpose

The design business (customer designs → cost estimate → cart/order → product/variant
mint → production run → partner work-order) is implemented on a mix of core Medusa
primitives and bespoke machinery. Core workflows are used for order creation,
draft-order conversion, quote carts, product/variant minting and fulfillment; but
design carts/line items are created through the raw Cart module service with
`metadata.design_id` as the design identifier, and design↔cart-line-item /
design↔order / partner↔order relationships live in custom link tables rather than
on a real `variant_id`.

## 2. Q1 — Where CORE Medusa order primitives ARE used

Core workflows imported from `@medusajs/medusa/core-flows` in `apps/backend/src`:

| Core workflow | Repo file (caller) | What for |
| --- | --- | --- |
| `createOrderWorkflow` | `apps/backend/src/workflows/designs/convert-design-order.ts:194` (`convertDesignOrderToOrder`) | Creates the real order from a design cart as a **draft order** (`is_draft_order: true, status: "draft"`), title-only items |
| `createOrderWorkflow` | `apps/backend/src/workflows/production-runs/dual-write-unified-run-order.ts:243` (`projectRunToUnifiedOrder`) | Projects one production run onto a unified kind=design core order (work-order) |
| `createOrderWorkflow` | `apps/backend/src/workflows/production-runs/dual-write-unified-run-order.ts:488` (`collateRunsIntoWorkOrder`) | Creates ONE collated work-order with a line item per run/design |
| `createOrderWorkflow` | `apps/backend/src/workflows/inventory_orders/dual-write-unified-order.ts:348` | Projects an inventory order onto the unified core `order` |
| `convertDraftOrderWorkflow` | `apps/backend/src/workflows/designs/convert-design-order.ts:260` | Flips draft→pending and emits `OrderWorkflowEvents.PLACED` (per the file header, lines 32-33) |
| `createOrderPaymentCollectionWorkflow` / `markPaymentCollectionAsPaid` | `apps/backend/src/workflows/designs/convert-design-order.ts:242` and `:249` | Payment collection on the converted order; prepaid mode marks it captured via core's `pp_system_default` |
| `beginOrderEditOrderWorkflow` / `orderEditAddNewItemWorkflow` / `confirmOrderEditRequestWorkflow` | `apps/backend/src/workflows/production-runs/dual-write-unified-run-order.ts:748-754` (`joinRunsIntoWorkOrder`) | Appends new designs into an existing open partner work-order through core order-edit |
| `createCartWorkflow` | `apps/backend/src/workflows/partner-quote/accept-quote.ts:419` | Quote-acceptance cart built with **real `variant_id` items** (lines 433-436) — the core-primitive pattern |
| `createCartWorkflow` | `apps/backend/src/scripts/stripe-connect-e2e-test.ts:157`, `apps/backend/src/scripts/stripe-connect-verify-routing.ts:157` | Test/e2e scripts |
| `updateCartWorkflow` | `apps/backend/src/api/store/carts/[id]/customer-details/route.ts:34` | Store cart customer-details update |
| `completeCartWorkflow` | `apps/backend/src/api/store/payu/complete/route.ts:92` | Standard cart→order completion after PayU payment |
| `completeCartWorkflow` | `apps/backend/src/api/store/payu/lib/complete-from-external.ts:138` (`completeCartFromExternalPayment`) | Completes a cart from an externally-verified PayU payment link |
| `createPaymentSessionsWorkflow` | `apps/backend/src/api/store/stripe/lib/init-session.ts:11` (import), `apps/backend/src/api/store/payu/lib/complete-from-external.ts:128` | Payment session creation on a collection |
| `createPaymentCollectionForCartWorkflow` / `refreshPaymentCollectionForCartWorkflow` / `deletePaymentSessionsWorkflow` | `apps/backend/src/lib/payments/ensure-cart-collection.ts:3-7` (`ensureCartPaymentCollection`) | Cart payment collections; full-total path runs core's workflow untouched (file header, lines 30-32) |
| `addShippingMethodToCartWorkflow` | `apps/backend/src/workflows/partner-quote/accept-quote.ts:463` (`addQuoteFreightStep`) | Puts the frozen freight option on the quote cart |
| `createProductsWorkflow` | `apps/backend/src/workflows/designs/create-product-from-design.ts:390` | New-product branch of design→product mint |
| `createProductVariantsWorkflow` | `apps/backend/src/workflows/designs/create-product-from-design.ts:307` | Appended-variant branch; chosen over the bare service precisely because it creates the price_set link + inventory items (comment, lines 299-306) |
| `createProductsWorkflow` | `apps/backend/src/workflows/designs/promote-design-to-product.ts:138`, `apps/backend/src/workflows/media/create-products-from-media/steps/create-products-batch.ts:72`, `apps/backend/src/workflows/whatsapp/create-draft-product-from-extraction.ts:248`, `apps/backend/src/workflows/partner/create-partner-product.ts:262`, `apps/backend/src/scripts/seed.ts:328`, `apps/backend/src/scripts/seed-wide-spec-local.ts:70`, `apps/backend/src/scripts/seed-ikat-spec-local.ts:49` | Product creation across promote/media/whatsapp/partner flows and seeds |
| `createProductVariantsWorkflow` | `apps/backend/src/api/partners/stores/[id]/products/[productId]/variants/route.ts:63` | Partner variant creation (route comment at line 56 mirrors the price_set rationale) |
| `linkProductsToSalesChannelWorkflow` | `apps/backend/src/workflows/partner-quote/ensure-design-quote-variant.ts:8` | Puts the minted made-to-order design product in the quoting store's channel |
| `getOrdersListWorkflow` | `apps/backend/src/workflows/orders/list-partner-orders.ts:283` (`listPartnerOrdersWorkflow`) | Partner orders listing (retail + work-orders) through the built-in orders workflow |
| `createOrderFulfillmentWorkflow` | `apps/backend/src/workflows/orders/fulfillment-context.ts:6`, `apps/backend/src/api/partners/orders/[id]/fulfillments/route.ts:2` | Order fulfillment |
| `createOrderShipmentWorkflow` | `apps/backend/src/workflows/orders/external-awb.ts:7`, `apps/backend/src/api/partners/orders/[id]/fulfillments/[fulfillmentId]/shipment/route.ts:2` | Shipments (incl. external AWB attach) |
| `cancelOrderWorkflow` | `apps/backend/src/api/partners/orders/[id]/cancel/route.ts:2` | Order cancellation |
| `requestOrderTransferWorkflow` / `cancelOrderTransferRequestWorkflow` | `apps/backend/src/api/partners/orders/[id]/transfer/route.ts:2`, `apps/backend/src/api/partners/orders/[id]/transfer/cancel/route.ts:2` | Order transfer requests |
| Claims workflows (`beginClaimOrderWorkflow`, `orderClaimItemWorkflow`, `orderClaimAddNewItemWorkflow`, `orderClaimRequestItemReturnWorkflow`, `confirmClaimRequestWorkflow`, …) | `apps/backend/src/api/partners/claims/route.ts:3` and the sibling routes under `apps/backend/src/api/partners/claims/[id]/` | Full partner claims UI on core workflows |
| Order-edit workflows (`beginOrderEditOrderWorkflow`, `orderEditAddNewItemWorkflow`, `orderEditUpdateItemQuantityWorkflow`, `confirmOrderEditRequestWorkflow`, `cancelBeginOrderEditWorkflow`) | `apps/backend/src/api/partners/order-edits/route.ts:2` and sibling routes under `apps/backend/src/api/partners/order-edits/[id]/` | Partner order edits on core workflows |

Notes:
- `addToCartWorkflow` is **not used anywhere** in `apps/backend/src` (grep over `apps/backend/src` for `\baddToCartWorkflow\b` returns nothing) — design items are added via the raw Cart service (see Q2).
- `createDraftOrderWorkflow` is likewise not used; the repo's draft-order pattern is `createOrderWorkflow` with `is_draft_order: true` + `convertDraftOrderWorkflow` (`apps/backend/src/workflows/designs/convert-design-order.ts:194` and `:260`).
- Integration tests also drive core workflows directly, e.g. `createOrderWorkflow` in `apps/backend/integration-tests/http/design-order-produce-fanout.spec.ts:3` and `apps/backend/integration-tests/http/requires-shipping-fulfillment-gate.spec.ts:372`.

## 3. Q2 — Where the same thing is HAND-ROLLED (direct module service calls)

### 3.1 Cart + line items via raw Cart module (bypasses `createCartWorkflow` / `addToCartWorkflow`)

1. **`apps/backend/src/api/store/custom/designs/[id]/checkout/route.ts:124`** (`POST` handler) —
   resolves `Modules.CART` (line 101) and calls `cartService.addLineItems(body.cart_id, [...])`
   with a custom-priced, **variant-less** line item (`is_custom_price: true`,
   `requires_shipping: false`, `metadata.design_id`). Bypasses `addToCartWorkflow`.
   The route then hand-creates the design↔line-item link via `remoteLink.create`
   (lines 151-155) — something no core workflow would know to do.
2. **`apps/backend/src/workflows/designs/create-draft-order-from-designs.ts:273` and `:288`**
   (`createDesignCartStep`) — `cartService.createCarts({...})` then
   `cartService.addLineItems(cart.id, [...])`, again variant-less custom items with
   `metadata.design_id`. Bypasses `createCartWorkflow` (which the quote path uses at
   `apps/backend/src/workflows/partner-quote/accept-quote.ts:419`). The step hand-rolls
   what core cart creation would provide: region lookup (lines 218-226), sales-channel
   fallback (lines 232-252), customer email resolution (lines 262-270). No payment
   collection is created with the cart; payment is only attached later at convert time
   via `createOrderPaymentCollectionWorkflow` (`apps/backend/src/workflows/designs/convert-design-order.ts:242`).
3. **`apps/backend/src/scripts/seed-design-cart-links.ts:80` and `:89`** — seed script using
   the same `createCarts` + `addLineItems` pattern, with the manual design↔line-item link
   at `apps/backend/src/scripts/seed-design-cart-links.ts:103` and
   `metadata: { design_id, cost_confidence: "seed" }` at `:96`.

What the bypass loses (grounded in this repo's own documentation of past damage):
- **Price sets / inventory**: the repo documents that calling the bare product service
  instead of `createProductVariantsWorkflow` leaves `variant.price_set` null and crashes
  admin's prices page — `apps/backend/src/workflows/designs/create-product-from-design.ts:299-306`
  and the repair script `apps/backend/src/scripts/backfill-variant-price-sets.ts:4-16`.
  The cart-side analogue (custom items with no variant) has no price-set or inventory
  reservation at all by construction.
- **Checkout invariants**: variant-less items forced `requires_shipping: false` because
  core's `validateShippingStep` inside `completeCartWorkflow` cannot satisfy a
  shipping-method profile match for an item with no variant —
  `apps/backend/src/lib/requires-shipping.ts:14-20` and the inline comments at
  `apps/backend/src/workflows/designs/create-draft-order-from-designs.ts:294-300` and
  `apps/backend/src/api/store/custom/designs/[id]/checkout/route.ts:129-132`.
- **Payment-collection amount control**: core's `createPaymentCollectionForCartWorkflow`
  hardcodes `amount: cart.raw_total` with no override, which is why a bespoke seam exists
  for deposits — `apps/backend/src/lib/payments/ensure-cart-collection.ts:24-28`.

### 3.2 Order line items / order changes via raw Order module (bypasses order-edit workflows)

4. **`apps/backend/src/workflows/inventory_orders/reproject-inventory-mirror-items.ts:209-212`**
   (`reprojectInventoryMirrorItems`) — `orderService.createOrderLineItems(unifiedOrderId, plan.create)`
   and `orderService.deleteOrderLineItems(plan.removeItemIds)` to re-mirror inventory lines
   onto a unified order. Bypasses the order-edit trio (`beginOrderEditOrderWorkflow` /
   `orderEditAddNewItemWorkflow` / `confirmOrderEditRequestWorkflow`) that the design
   analogue uses at `apps/backend/src/workflows/production-runs/dual-write-unified-run-order.ts:748-754`;
   loses the order-change records / confirm-cancel semantics that workflow path produces.
5. **`apps/backend/src/api/partners/orders/[id]/credit-lines/route.ts:13`** —
   `orderService.createOrderCreditLines({...})` directly off the request scope. No core
   workflow is used for credit lines anywhere in this repo (whether Medusa core ships one
   is `(unverified)`).
6. **`apps/backend/src/api/partners/orders/[id]/changes/[changeId]/route.ts:12`** —
   `orderService.updateOrderChanges(req.params.changeId, req.body)` — raw order-change
   mutation outside the begin/update/confirm workflow trio.
7. **`apps/backend/src/workflows/designs/create-product-from-design.ts:508`** —
   `orderService.updateOrderLineItems(item.id, { variant_id, product_id, ... })` to
   backfill a real variant onto title-only order items after the design is approved.
   Bypasses order-edit workflows (no change record); deliberate per the comment at
   lines 429-434 ("closes the loop: order placed (custom item) → design approved → order items linked").
8. **`apps/backend/src/subscribers/order-placed.ts:88`** — `orderService.updateOrderLineItems`
   repairing `requires_shipping` to `true` at order.placed; the repair rules and why it
   must happen post-placement are documented in `apps/backend/src/lib/requires-shipping.ts:40-55`.

### 3.3 Product options / order status via raw module services

9. **`apps/backend/src/workflows/designs/create-product-from-design.ts:256` and `:271`** —
   `productService.upsertProductOptions([...])` to grow option values before appending a
   variant (variant creation itself then goes through `createProductVariantsWorkflow`,
   line 307). No core workflow is used for option upserts in this repo.
10. **`apps/backend/src/workflows/production-runs/dual-write-unified-run-order.ts:145` and
    `:154`** (`patchUnifiedOrder`) and `:974` — `orderService.updateOrders([...])` for
    status/metadata patches on unified work-orders; also `apps/backend/src/workflows/inventory_orders/dual-write-unified-order.ts:479`.
    Direct service calls; no core "update order status" workflow is used for these.

### 3.4 Cart metadata stamping via raw Cart module (not order creation, but same pattern)

11. **`apps/backend/src/api/store/payu/payment-link/route.ts:140-148`** —
    `cartModule.updateCarts` stamping `payu_invoice_number` / `payu_payment_link` on cart
    metadata (merge required because Medusa replaces the whole metadata blob — comment at
    lines 135-137).
12. **`apps/backend/src/api/store/payu/lib/complete-from-external.ts:146-149`** —
    `cartService.updateCarts` stamping `payu_order_id` for webhook idempotency (read back
    at line 109).

## 4. Q3 — Bespoke metadata carrying business meaning

### 4.1 Line-item `metadata.design_id` (design identified by metadata, not `variant_id`)

Writers:
- `apps/backend/src/api/store/custom/designs/[id]/checkout/route.ts:134-141` — cart line
  item `metadata: { design_id, cost_confidence, original_currency?, original_amount? }`,
  no `variant_id`.
- `apps/backend/src/workflows/designs/create-draft-order-from-designs.ts:302-309` — same
  metadata on draft-order cart line items.
- `apps/backend/src/workflows/designs/convert-design-order.ts:171-179` — order items copy
  the cart item metadata and add `source_cart_line_item_id`; these are TITLE-ONLY items
  (no product_id/variant_id) so the order.placed subscriber skips them (file header,
  lines 38-43).
- `apps/backend/src/workflows/production-runs/dual-write-unified-run-order.ts:254-259`
  (per-run work-order item) and `:375-380` (`buildWorkOrderItems`, collated work-order
  items) — item `metadata: { design_id, production_run_id, cost_type, legacy_cost_estimate }`.

Readers (who reads `metadata.design_id` back):
- `apps/backend/src/workflows/designs/create-runs-for-design-order.ts:71` —
  `createRunsForDesignOrder` fans out one production run per item whose
  `item?.metadata?.design_id` is set (comment at lines 14-18 calls these "TITLE-ONLY
  line item[s] ... each with `metadata.design_id`").
- `apps/backend/src/workflows/orders/list-partner-orders.ts:158`
  (`attachOrderDesignSummariesStep`) — unions `items.metadata.design_id` with
  `production_runs.design_id` to attach design summaries to partner order rows
  (comment at lines 106-108 explains the two shapes).
- `apps/backend/src/workflows/designs/create-product-from-design.ts:507` — finds order
  items with `item.metadata?.design_id === input.design_id && !item.variant_id` to
  backfill the minted variant.
- `apps/backend/src/workflows/production-runs/partner-run-steps.ts:422` — finds the
  order line item for an inventory reservation by
  `i.metadata?.design_id === input.design_id && i.variant_id === variantId`.

### 4.2 Product/variant `metadata.is_custom_design` + `metadata.design_id`

Writers:
- `apps/backend/src/workflows/designs/create-product-from-design.ts:293-296` (variant
  metadata) and `:360-364` (product metadata `is_custom_design`, `design_id`, `design_type`).

Readers:
- `apps/backend/src/modules/partner-quote/lib/design-lines.ts:318-323`
  (`isMadeToOrderDesignProduct`) — reads `product?.metadata?.is_custom_design === true`;
  consumed by `apps/backend/src/modules/partner-quote/lib/quote-readiness.ts:351` and
  `apps/backend/src/workflows/partner-quote/ensure-design-quote-variant.ts:392` (comment
  at line 343: "isMadeToOrderDesignProduct is the whole safety boundary").
- The repo itself documents the weakness of the metadata stamp:
  `apps/backend/src/api/admin/designs/[id]/products/route.ts:12-18` — "`create-product-from-design`
  writes a product↔design link row and stamps `metadata.design_id` on the product, but
  nothing read either direction ... `/admin/products` cannot filter on metadata"; the same
  finding is restated for the MCP registry at `apps/backend/src/api/admin/mcp/lib/registry.ts:1702`.

### 4.3 Cart / order metadata carrying business state

- Cart provenance: `apps/backend/src/workflows/designs/create-draft-order-from-designs.ts:281-284`
  (`metadata: { created_by: "admin", source: "design-order" }`).
- Cart conversion marker: `apps/backend/src/workflows/designs/convert-design-order.ts:271`
  (`converted_order_id` stamped on the cart; read back for idempotency at lines 143-153).
- Order provenance: `apps/backend/src/workflows/designs/convert-design-order.ts:207-212`
  (`source: "design-order-convert"`, `source_cart_id`, `payment_mode`).
- Work-order metadata: `apps/backend/src/workflows/production-runs/dual-write-unified-run-order.ts:225-234`
  (`legacy_id`, `production_run_id`, `run_type`, `execution_mode`, `source_order_id`,
  `source_line_item_id`) and collated flags at `:495-505` (`collated_design_order: true`,
  `production_run_ids`). Note the repo already moved `partner_status` OFF metadata onto a
  typed sidecar — `apps/backend/src/links/order-unified-status.ts:5-9`.
- PayU idempotency: `apps/backend/src/api/store/payu/lib/complete-from-external.ts:109`
  reads `cart.metadata.payu_order_id`; writer at `:147-149`.
- Quote cart provenance: `apps/backend/src/workflows/partner-quote/accept-quote.ts:437-443`
  stamps `quote_id` / `partner_id` on cart metadata with the explicit warning that it is
  NOT the scoping mechanism (comment at lines 438-440).

### 4.4 Custom link tables standing in for core relationships

- `apps/backend/src/links/design-line-item-link.ts` — design ↔ **cart line item**
  (many-to-many; written by `apps/backend/src/api/store/custom/designs/[id]/checkout/route.ts:151-155`
  and `apps/backend/src/workflows/designs/create-draft-order-from-designs.ts:331-367`).
- `apps/backend/src/links/design-order-link.ts` — design ↔ order (written by
  `apps/backend/src/workflows/designs/link-designs-to-order.ts:83-92` and explicitly in
  `apps/backend/src/workflows/designs/convert-design-order.ts:217-230`).
- `apps/backend/src/links/design-variant-link.ts` — design ↔ product variant, 1:1, with
  `extraColumns` `estimated_cost` / `customer_id` / `created_at` (lines 26-37).
- `apps/backend/src/links/product-design-link.ts` — product ↔ design (read via its
  `entryPoint` at `apps/backend/src/api/admin/designs/[id]/products/route.ts:31-48`).
- `apps/backend/src/links/partner-order.ts` — partner ↔ order scoping for work-orders
  (comment, lines 5-8: retail keeps sales-channel scoping).
- Design↔customer ownership is enforced through `designCustomerLink.entryPoint` at
  `apps/backend/src/api/store/custom/designs/[id]/checkout/route.ts:51-59`.

The "good" counter-pattern (links, not metadata) already exists for variant-backed
retail items: `apps/backend/src/lib/resolve-line-item-production.ts:20-52`
(`resolveLineItemDesignId`) resolves a line item's design via the
`design_product_variant` and `product_design` link tables, and
`apps/backend/src/subscribers/order-placed.ts:109-123` uses it (title-only items are
skipped by the `if (!lineItemId || !productId) continue` guard at lines 109-111).

## 5. Gotchas / invariants

- **`requires_shipping` must stay `false` on design CART items** and is repaired at
  order.placed only for items whose product has a shipping profile —
  `apps/backend/src/lib/requires-shipping.ts:14-20` and `:40-55`; enforced in
  `apps/backend/src/subscribers/order-placed.ts:75-101`.
- **Title-only order items are load-bearing**: convert-design-order deliberately builds
  items without product/variant so the order.placed production-run branch skips them
  (`apps/backend/src/workflows/designs/convert-design-order.ts:38-43`); producing a design
  order is a separate explicit admin step (`apps/backend/src/workflows/designs/create-runs-for-design-order.ts:14-19`).
- **`order.cart_id` is not a column** — order↔cart is the `order_cart` link module; code
  that selected `cart_id` off the order silently no-oped (the original #379 bug) —
  `apps/backend/src/workflows/designs/link-designs-to-order.ts:20-23`.
- **Metadata is replaced wholesale on update** — merge before stamping —
  `apps/backend/src/api/store/payu/payment-link/route.ts:135-137` and
  `apps/backend/src/workflows/production-runs/dual-write-unified-run-order.ts:140-152`.
- **Prices are decimal major units** — the historical ×100 in this workflow listed a ₹850
  design at 85,000 — `apps/backend/src/workflows/designs/create-product-from-design.ts:156-174`
  (`resolveListedPrice`).
- **A null cost estimate must refuse, not price at 0** — enforced on both the checkout
  route (`apps/backend/src/api/store/custom/designs/[id]/checkout/route.ts:82-99`) and the
  draft-order workflow (`apps/backend/src/workflows/designs/create-draft-order-from-designs.ts:86-99`).
- **Idempotency markers**: cart `converted_order_id` + `completed_at`
  (`apps/backend/src/workflows/designs/convert-design-order.ts:141-153`, `:262-277`);
  production-run `order_line_item_id` uniqueness
  (`apps/backend/src/lib/resolve-line-item-production.ts:7-9`, partial unique index #1123);
  order↔production_run link as the "already projected" signal
  (`apps/backend/src/workflows/production-runs/dual-write-unified-run-order.ts:182-201`).

## 6. Open questions / (unverified)

- Whether Medusa core ships a workflow equivalent for `createOrderCreditLines`
  (the partner route calls the module service directly —
  `apps/backend/src/api/partners/orders/[id]/credit-lines/route.ts:13`); not verified
  against core's workflow list.
- `apps/backend/src/api/partners/orders/[id]/route.ts:176` and
  `apps/backend/src/api/partners/orders/[id]/changes/[changeId]/route.ts:11` resolve
  `Modules.ORDER` for reads/mutations whose full behaviour was not read here.
- The exact internal steps of core's `createCartWorkflow` / `addToCartWorkflow`
  (e.g. payment-collection creation, event emission) were not read from
  `node_modules`; the "what the bypass loses" statements above are grounded in this
  repo's own comments and repair scripts, not in core source.
