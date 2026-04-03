# Design Order Flow — Bugs & Enhancement Analysis

## Bugs Fixed (This Session)

### 1. Material estimate returns zero for partner-consumed designs
- **Root cause**: `estimateDesignCostWorkflow` only checked inventory order history and `unit_cost` on inventory items. Partners provide costs via consumption logs, which were never queried.
- **Fix**: Added consumption log + raw material fallback in estimate chain. Added cost propagation from consumption logs to raw materials on commit.

### 2. Phantom negative inventory on consumption commit
- **Root cause**: `commitConsumptionWorkflow` ran negative inventory adjustments, but partners don't maintain stock levels in the system.
- **Fix**: Removed inventory adjustment step. Commit now only records data and propagates costs.

### 3. Duplicate design orders created on double-click
- **Root cause**: No idempotency check — submitting "Convert to Draft Order" twice created two carts with identical line items.
- **Fix**: Added duplicate check in `POST /admin/customers/:id/design-order` that verifies designs aren't already linked to pending carts.

### 4. Raw material edit form loses unit_cost on save
- **Root cause**: `initialValues` in `edit-raw-material.tsx` didn't include `unit_cost` and `cost_currency`, so the form loaded blank and overwrote values on save.
- **Fix**: Added `unit_cost` and `cost_currency` to initialValues and TypeScript interfaces.

### 5. Admin consumption log endpoint missing unitCost field
- **Root cause**: Validator and route didn't accept `unitCost` in the request body.
- **Fix**: Added `unitCost` to validator and route handler.

### 6. Design order detail page shows wrong currency
- **Root cause**: Detail API only fetched `currency_code` from the order (null for pending carts). Cart currency wasn't queried.
- **Fix**: Added cart currency fetch to detail API, returned as top-level `currency_code`.

## Remaining Bugs

### 7. Flowy Skirt estimate: INR tagged as EUR
- **Severity**: Medium
- **Description**: Design `01KKJYNZXRPE9JMAYZF57T3VY2` estimated at ~4940 INR (from raw material unit_cost 3800). The conversion step treated this as EUR and converted "4180 EUR" → 448,514 INR. This suggests the store's default currency was set to EUR, but the estimate was actually in INR.
- **Root cause**: `estimateDesignCostWorkflow` assumes all estimates are in the store's default currency. If the store default is EUR but raw material costs are in INR, the conversion step misidentifies the source currency.
- **Fix needed**: Estimates should carry the currency they're denominated in. Raw materials have a `cost_currency` field — use it to tag the estimate's source currency.

### 8. Order-placed subscriber skips production runs for design-order items
- **Severity**: Low (may be intentional)
- **Description**: Line 53 of `order-placed.ts`: `if (!lineItemId || !productId) { continue }`. Design-order line items have `product_id: null`, so production runs are never created for them.
- **Impact**: After a customer pays for a design order, no production run is auto-created. This may be correct (partner already did sampling), but for production orders it could be a gap.
- **Fix needed**: Check if the line item has a `design_id` in metadata and create a production run from that if no product link exists.

### 9. Design orders table row click navigates to a single line item
- **Severity**: Low (UX)
- **Description**: Clicking a grouped design order row goes to `/design-orders/{firstLineItemId}`, showing one design as primary and others as siblings. If the user clicks a row with 5 designs, they see "Jolly jungle" with 4 siblings rather than a cart-level view.
- **Fix needed**: Change navigation to cart-based (`/design-orders/cart/{cartId}`) or show the full group equally in the detail page.

## Enhancement Opportunities

### 10. Multi-currency design order creation
- **Priority**: High
- **Description**: Admin creates design orders with a single currency (defaults to INR). If the customer is in a different region (e.g., Australia/EUR), the prices are in the wrong currency. Currently requires manual DB fixes.
- **Enhancement**: Auto-detect the customer's region and default to that currency. Or let the admin pick the target currency in the preview drawer (partially implemented with `override_currency`).

### 11. Storefront currency conversion on region change
- **Priority**: Medium
- **Description**: When a customer visits the checkout from a different region, Medusa updates the cart's region but doesn't convert custom-priced line items. The number stays the same but the currency label changes.
- **Enhancement**: Add a cart region-change hook/subscriber that re-converts custom design prices using live exchange rates. Store the original price + currency in metadata for accurate conversion.

### 12. Partner inventory tracking (future)
- **Priority**: Medium
- **Description**: Partners currently don't maintain stock levels. Consumption commit only records data. For production orders at scale, knowing partner stock levels would enable capacity planning and material allocation.
- **Enhancement**: Add opt-in inventory tracking where partners can declare stock on hand. Consumption commit would then adjust levels. Keep current behavior as default.

### 13. Consumption-based cost confidence
- **Priority**: Low
- **Description**: When the estimate uses consumption log data, the confidence is "estimated". It should distinguish between "has actual production data" (consumption logs) vs "guessing from similar designs".
- **Enhancement**: Add a `"consumption_actual"` confidence level that's between "estimated" and "exact", indicating we have real production data but not a complete sample run.

### 14. Design order cancellation and cart cleanup
- **Priority**: Medium
- **Description**: If an admin wants to re-create a design order (e.g., with different prices or currency), they must first remove the existing cart links. There's no UI for this — the duplicate check blocks re-submission.
- **Enhancement**: Add a "Remove from checkout" action on the customer widget's "Sent to Checkout" section. This would delete the cart, line items, and design-line-item links, allowing re-creation.

### 15. Bulk design status on design order
- **Priority**: Low
- **Description**: The design orders table shows the first design's status badge. If designs in the same order have different statuses, this isn't visible without hovering the tooltip.
- **Enhancement**: Show a mixed-status indicator when designs in a group have different statuses (e.g., "3 Approved, 2 In Development").

### 16. Checkout link expiry
- **Priority**: Low
- **Description**: Checkout links never expire. A cart created weeks ago still has a valid checkout link, but prices may be stale.
- **Enhancement**: Add a TTL to design-order carts. Show a warning in the admin if the cart is older than N days. Optionally auto-expire and allow re-creation.
