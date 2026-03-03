---
title: "Action Framework"
sidebar_label: "Action Framework"
sidebar_position: 4
---

# Action Framework

The inbound email system uses a pluggable action registry that allows adding new email processing behaviors without modifying existing code.

## How It Works

1. Actions are registered at import time via `registerAction()`
2. The API routes list available actions from the registry
3. `extract()` parses the email into structured data for the action type
4. `execute()` performs the business logic with admin-provided parameters

## Action Interface

```typescript
interface InboundEmailAction {
  type: string        // Unique identifier (e.g. "create_inventory_order")
  label: string       // Human-readable name for the UI
  description: string // Description shown in the UI

  extract(email: InboundEmailRecord): Promise<any>

  execute(
    email: InboundEmailRecord,
    extractedData: any,
    params: any,
    container: MedusaContainer
  ): Promise<any>
}
```

### `extract(email)`

Parses the raw email (HTML body, text body, subject, from address) and returns structured data relevant to this action. This data is stored on the email record as `extracted_data` and shown to the admin for review before execution.

**Should be:**
- Deterministic (same email → same output)
- Side-effect free (no database writes, no external calls)
- Fast (runs synchronously from the admin's perspective)

### `execute(email, extractedData, params, container)`

Performs the actual business logic. Receives:

- `email` — the full inbound email record
- `extractedData` — output from `extract()` (may have been called earlier)
- `params` — admin-provided parameters (e.g. stock location, item mappings)
- `container` — Medusa DI container for resolving services and running workflows

**Should return** a result object that gets stored as `action_result` on the email.

## Registry Functions

```typescript
import { registerAction, getAction, listActions } from "../utils/inbound-email-actions"

// Register a new action
registerAction(myAction)

// Get a specific action by type
const action = getAction("create_inventory_order")

// List all registered actions
const actions = listActions()
// => [{ type, label, description, extract, execute }, ...]
```

## Built-in Action: `create_inventory_order`

**File:** `src/utils/inbound-email-actions/create-inventory-order.ts`

### Extract

Calls `parseOrderEmail()` from `src/utils/parse-order-email.ts` to extract:

- Vendor name (from sender domain)
- Order number, date
- Line items (name, quantity, price, SKU)
- Totals (subtotal, shipping, tax, total)
- Tracking number and URL
- Currency

### Execute

Takes admin-provided `stock_location_id` and `item_mappings`, then calls `createInventoryOrderWorkflow` with:

- Order lines built from the item mappings
- Total price and quantity calculated from the mappings
- Metadata linking back to the email ID and vendor
- Dates from extracted data (or current date as fallback)

## Creating a New Action

### Step 1: Create the Action File

```typescript
// src/utils/inbound-email-actions/create-design.ts
import { InboundEmailAction, InboundEmailRecord, registerAction } from "./index"
import { MedusaContainer } from "@medusajs/framework/types"

const createDesignAction: InboundEmailAction = {
  type: "create_design",
  label: "Create Design",
  description: "Extract design details from email and create a design record",

  async extract(email: InboundEmailRecord) {
    // Parse design-relevant info from the email
    const nameMatch = email.subject.match(/design[:\s]+(.+)/i)
    return {
      design_name: nameMatch?.[1]?.trim() || email.subject,
      description: email.text_body || "",
      source_email: email.from_address,
    }
  },

  async execute(
    email: InboundEmailRecord,
    extractedData: any,
    params: any,
    container: MedusaContainer
  ) {
    const designService = container.resolve("design") as any
    const design = await designService.createDesigns({
      name: extractedData.design_name,
      description: extractedData.description,
      status: "Draft",
      ...params,
    })
    return { design_id: design.id }
  },
}

registerAction(createDesignAction)
export default createDesignAction
```

### Step 2: Import It

Add the import to the action routes so it's registered when the routes load:

```typescript
// In src/api/admin/inbound-emails/actions/route.ts
import "../../../../utils/inbound-email-actions/create-design"
```

Also add it to the extract and execute route files:

```typescript
// In src/api/admin/inbound-emails/[id]/extract/route.ts
import "../../../../../utils/inbound-email-actions/create-design"

// In src/api/admin/inbound-emails/[id]/execute/route.ts
import "../../../../../utils/inbound-email-actions/create-design"
```

### Step 3: Test

The new action will appear in:

```bash
GET /admin/inbound-emails/actions
# => { "actions": [..., { "type": "create_design", "label": "Create Design", ... }] }
```

And can be used via:

```bash
POST /admin/inbound-emails/:id/extract
{ "action_type": "create_design" }

POST /admin/inbound-emails/:id/execute
{ "action_type": "create_design", "params": { "priority": "high" } }
```

## HTML Order Parser

The built-in parser (`src/utils/parse-order-email.ts`) extracts order data using regex patterns.

### Supported Patterns

| Data | Patterns Matched |
|------|-----------------|
| Order number | `Order #`, `Order Number:`, `Order ID:`, `Confirmation #` |
| Items (HTML) | `<table>` rows with text cell + price cell |
| Items (text) | `Item Name x10 $50.00` line format |
| Prices | `Subtotal: $X`, `Shipping: $X`, `Tax: $X`, `Total: $X` |
| Tracking | `Tracking #`, UPS (`1Z...`), FedEx/USPS (20+ digit) |
| Tracking URL | `<a href="...track...">` |
| Dates | `Order Date: Month DD, YYYY`, `Estimated Delivery: ...` |
| Currency | `$` → USD, `€` → EUR, `£` → GBP, `₹` → INR |
| Vendor | Extracted from sender email domain |

### Output Shape

```typescript
interface ExtractedOrderData {
  vendor: string | null
  order_number: string | null
  order_date: string | null
  items: Array<{
    name: string
    quantity: number | null
    price: number | null
    sku: string | null
  }>
  subtotal: number | null
  shipping_cost: number | null
  tax: number | null
  total: number | null
  tracking_number: string | null
  tracking_url: string | null
  estimated_delivery: string | null
  currency: string | null
}
```
