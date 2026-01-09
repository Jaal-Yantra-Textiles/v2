# Design-to-Cart Flow Implementation

This document describes the implementation of the design-to-cart flow, which enables customers to purchase their custom designs through the standard Medusa e-commerce checkout.

## Overview

The design-to-cart flow allows customers who create custom designs in the Design Editor to:
1. Get a cost estimate for their design
2. Convert the design into a purchasable product/variant
3. Add to cart and complete checkout via standard Medusa flow
4. Automatically trigger production runs when orders are placed

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Design Editor  │────▶│  Cost Estimation │────▶│  Create Product │
│   (Frontend)    │     │      API         │     │   /Variant      │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Production Run  │◀────│   order.placed   │◀────│  Medusa Cart    │
│    Created      │     │   Subscriber     │     │   & Checkout    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## API Endpoints

### 1. Cost Estimation API

**`GET /store/custom/designs/:id/estimate`**

Returns a cost estimate for a design based on:
- Material costs from inventory order history
- Production costs (from `design.estimated_cost` or 30% default)
- Similar designs as reference

**Query Parameters:**
- `inventory_item_ids` (optional): Comma-separated list of inventory item IDs

**Response:**
```json
{
  "costs": {
    "material_cost": 100.00,
    "production_cost": 30.00,
    "total_estimated": 130.00,
    "confidence": "estimated"  // "exact" | "estimated" | "guesstimate"
  },
  "breakdown": {
    "materials": [
      {
        "inventory_item_id": "inv_123",
        "name": "Silk Fabric",
        "cost": 50.00,
        "quantity": 2,
        "cost_source": "order_history"
      }
    ],
    "production_percent": 30
  },
  "similar_designs": [
    { "id": "design_456", "name": "Similar Design", "estimated_cost": 125.00 }
  ]
}
```

**Confidence Levels:**
- `exact`: Both material and production costs from actual historical data
- `estimated`: Some costs derived from historical data
- `guesstimate`: Using defaults (30% production cost)

### 2. Checkout API

**`POST /store/custom/designs/:id/checkout`**

Creates a purchasable product/variant from a design.

**Request Body:**
```json
{
  "inventory_item_ids": ["inv_123"],  // Optional
  "currency_code": "usd"               // Optional, defaults to "usd"
}
```

**Response:**
```json
{
  "product_id": "prod_abc123",
  "variant_id": "variant_xyz789",
  "price": 130.00,
  "is_new_product": true,
  "cost_estimate": {
    "material_cost": 100.00,
    "production_cost": 30.00,
    "total_estimated": 130.00,
    "confidence": "estimated",
    "breakdown": { ... }
  }
}
```

**Product Creation Strategy:**
- If design has a linked product → creates variant on existing product
- If no linked product → creates new product with variant
- Variant is linked to design via `design_product_variant` link table

## Workflows

### estimate-design-cost

Location: `src/workflows/designs/estimate-design-cost.ts`

Steps:
1. `get-design-with-inventory-step` - Fetches design and linked inventory items
2. `get-material-costs-step` - Queries inventory order history for material prices
3. `find-similar-designs-step` - Finds similar designs for reference pricing
4. `calculate-total-cost-step` - Calculates total with confidence level

### create-product-from-design

Location: `src/workflows/designs/create-product-from-design.ts`

Single consolidated step that:
1. Checks for existing product linked to design
2. Creates new product if none exists (with options for Medusa 2.0)
3. Creates variant with calculated price
4. Links design to variant for order tracking
5. Includes compensation for rollback on failure

## Module Links

### design-variant-link

Location: `src/links/design-variant-link.ts`

Links Design to ProductVariant with extra columns:
- `estimated_cost`: Cost estimate at time of checkout
- `customer_id`: Customer who created the design
- `created_at`: When the link was created

```typescript
export default defineLink(
  { linkable: DesignModule.linkable.design, isList: false },
  { linkable: ProductModule.linkable.productVariant, isList: false },
  {
    database: {
      extraColumns: {
        estimated_cost: { type: "decimal", nullable: true },
        customer_id: { type: "text", nullable: true },
        created_at: { type: "datetime", nullable: true },
      },
    },
  }
);
```

## Order-Placed Subscriber

Location: `src/subscribers/order-placed.ts`

Enhanced to check for design-variant links:
1. For each order line item, checks variant ID
2. Queries `design_product_variant` link for design ID
3. If found, creates ProductionRun for the custom design
4. Falls back to checking `design_product` link (standard products)

## Middleware Configuration

Location: `src/api/middlewares.ts`

```typescript
{
  matcher: "/store/custom/designs/:id/estimate",
  method: "GET",
  middlewares: [authenticate("customer", ["session", "bearer"])],
},
{
  matcher: "/store/custom/designs/:id/checkout",
  method: "POST",
  middlewares: [authenticate("customer", ["session", "bearer"])],
},
```

## Frontend Integration

The frontend should:

1. **Call estimate endpoint** to show cost breakdown:
```typescript
const estimate = await fetch(`/store/custom/designs/${designId}/estimate`, {
  headers: {
    'Authorization': `Bearer ${token}`,
    'x-publishable-api-key': publishableKey,
  },
});
```

2. **Call checkout endpoint** to create purchasable variant:
```typescript
const checkout = await fetch(`/store/custom/designs/${designId}/checkout`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'x-publishable-api-key': publishableKey,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ currency_code: 'usd' }),
});

const { variant_id } = await checkout.json();
```

3. **Add to cart** using standard Medusa cart API:
```typescript
await fetch(`/store/carts/${cartId}/line-items`, {
  method: 'POST',
  headers: {
    'x-publishable-api-key': publishableKey,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    variant_id: variant_id,
    quantity: 1,
  }),
});
```

4. **Complete checkout** using standard Medusa checkout flow.

## Storefront Implementation

The storefront (`jyt-storefront`) implements the design-to-cart flow with a checkout modal that appears after saving a design.

### Files

| File | Purpose |
|------|---------|
| `src/lib/data/designs.ts` | Server actions for API calls |
| `src/modules/products/components/design-editor/components/design-checkout-modal.tsx` | Checkout modal component |
| `src/modules/products/components/design-editor/hooks/use-design-editor.ts` | Editor hook with save flow |
| `src/modules/products/components/design-editor/index.tsx` | Main editor component |

### User Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Design Editor  │────▶│  Save Design    │────▶│ Checkout Modal  │
│                 │     │  (createDesign) │     │ (shows estimate)│
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                        ┌─────────────────┐              │
                        │  Cart Page      │◀─────────────┘
                        │  (/cart)        │   "Add to Cart"
                        └─────────────────┘   (checkoutDesign + addToCart)
```

### Server Actions (designs.ts)

```typescript
// Get cost estimate for a design
export const getDesignEstimate = async (designId: string): Promise<CostEstimate>

// Create product/variant and return variant_id for cart
export const checkoutDesign = async (
  designId: string,
  options?: { currency_code?: string }
): Promise<CheckoutDesignResponse>
```

### DesignCheckoutModal Component

Displays after a design is saved successfully:

- **Header**: "Design Saved!" with design name
- **Price Breakdown**: Materials cost, production cost, total
- **Confidence Indicator**: exact/estimated/guesstimate
- **Actions**:
  - "Save for Later" - closes modal, design already saved
  - "Add to Cart" - creates variant, adds to cart, redirects to /cart

```tsx
<DesignCheckoutModal
  isOpen={editor.showCheckoutModal}
  onClose={() => editor.setShowCheckoutModal(false)}
  designId={editor.savedDesignId}
  designName={editor.designName || editor.design.name || ""}
  countryCode={countryCode || "us"}
/>
```

### Hook Changes (use-design-editor.ts)

Added state for checkout modal:

```typescript
const [showCheckoutModal, setShowCheckoutModal] = useState(false)
const [savedDesignId, setSavedDesignId] = useState<string | null>(null)
```

Modified `handleSave` to show modal after successful save:

```typescript
const result = await createDesign(designInput)
clearDraftSnapshot()
setSavedDesignId(result.design.id)
setShowCheckoutModal(true)
```

### Add to Cart Flow

Inside `DesignCheckoutModal.handleAddToCart()`:

```typescript
// 1. Checkout design to create product/variant
const result = await checkoutDesign(designId, { currency_code: "usd" })

// 2. Add variant to cart
await addToCart({
  variantId: result.variant_id,
  quantity: 1,
  countryCode,
})

// 3. Redirect to cart
router.push(`/${countryCode}/cart`)
```

---

## Testing

Integration tests: `integration-tests/http/design-to-cart-flow.spec.ts`

**Test Coverage (18 tests):**

Cost Estimation:
- Returns cost estimate for customer's design
- Returns 401 without customer authentication
- Returns 404 for design not owned by customer
- Uses design's estimated_cost for production cost calculation

Checkout:
- Creates product/variant from design and returns info
- Creates a new product when design has no linked product
- Creates variant on existing product when design has linked product
- Returns 401 without customer authentication
- Returns 404 for design not owned by customer
- Accepts currency_code parameter

Order Processing:
- Creates ProductionRun when order contains variant linked to design
- Is idempotent - no duplicate runs on repeat trigger
- Handles mixed order with both linked and non-linked variants

End-to-End:
- Complete flow: estimate → checkout → order → production run

Medusa Cart API Integration:
- Creates cart and adds design variant as line item
- Updates quantity of design variant in cart
- Removes design variant from cart
- **Full checkout with shipping and payment (creates order)**

## Notes

### Publishable API Key

Store API routes require a valid publishable API key linked to a sales channel. The test helper (`integration-tests/helpers/create-customer.ts`) creates and links the key automatically.

### Product Options

Medusa 2.0 requires products to have options when variants exist. The workflow:
- Creates products with a "Type" option and "Custom" value
- When adding variants to existing products, adds "Custom" as a new option value

### Idempotency

The order-placed subscriber checks for existing production runs before creating new ones, ensuring orders can be processed multiple times without duplicate runs.

## Medusa Cart API Integration

The design checkout flow creates standard Medusa product variants that are fully compatible with the Medusa cart API:

### Cart Operations Supported

```typescript
// 1. Create a cart with region
const cart = await sdk.store.cart.create({ region_id: regionId });

// 2. Add design variant to cart
await sdk.store.cart.createLineItem(cartId, {
  variant_id: variantId,
  quantity: 1,
});

// 3. Update quantity
await sdk.store.cart.updateLineItem(cartId, lineItemId, { quantity: 3 });

// 4. Remove from cart
await sdk.store.cart.deleteLineItem(cartId, lineItemId);

// 5. Update cart with addresses
await sdk.store.cart.update(cartId, {
  email: customerEmail,
  shipping_address: { ... },
  billing_address: { ... },
});
```

### Full Checkout Flow

To complete checkout after adding a design variant to cart:

1. **Add shipping address** - Update cart with shipping/billing address
2. **Select shipping method** - Fetch options and add to cart
3. **Create payment collection** - Initialize payment for cart
4. **Initialize payment session** - Select payment provider
5. **Complete cart** - Creates the order

```typescript
// After adding items and addresses...

// Get shipping options
const shippingOptions = await sdk.store.fulfillment.listCartOptions({ cart_id: cartId });
await sdk.store.cart.addShippingMethod(cartId, { option_id: shippingOptions[0].id });

// Create payment collection
const paymentCollection = await sdk.store.payment.createPaymentCollection({ cart_id: cartId });

// Initialize payment session (e.g., with Stripe or system default)
await sdk.store.payment.initializePaymentSession(cartId, { provider_id: 'pp_system_default' });

// Complete cart (creates order)
const result = await sdk.store.cart.complete(cartId);
if (result.type === 'order') {
  // Order created successfully - order.placed event fires automatically
  console.log('Order ID:', result.order.id);
}
```

### Note on Test Environment

The integration tests validate cart creation and line item operations. Full checkout completion (shipping method, payment, order creation) requires:
- Payment providers configured and linked to regions
- Shipping profiles and fulfillment providers set up
- Stock locations for inventory management

In production, these are configured in the Medusa Admin dashboard.

## Test Infrastructure Helper

For full checkout tests, use the helper at `integration-tests/helpers/setup-checkout-infrastructure.ts`:

```typescript
import { setupCheckoutInfrastructure } from "../helpers/setup-checkout-infrastructure"

// Sets up: stock location, fulfillment set, service zone, shipping option, payment provider
const infrastructure = await setupCheckoutInfrastructure(container, regionId)
```

This creates the necessary fulfillment and payment infrastructure for testing the complete checkout flow with manual providers.

---

## Future Improvements

1. ~~**Simplified Add-to-Cart**: Consider an endpoint that creates variant AND adds to cart in one call~~ ✅ Implemented via checkout modal
2. ~~**Price Display**: Frontend component showing cost breakdown on hover/expand~~ ✅ Implemented in DesignCheckoutModal
3. **Inventory Reservation**: Reserve inventory when design is added to cart
4. **Custom Pricing Rules**: Support for markup percentages, volume discounts
5. **Cart Expiration**: Handle cleanup of variants for abandoned carts
