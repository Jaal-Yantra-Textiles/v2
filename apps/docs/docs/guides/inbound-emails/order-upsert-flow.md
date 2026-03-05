---
title: "Order Upsert from Email Flow"
sidebar_label: "Order Upsert Flow"
sidebar_position: 3
---

# Order Upsert from Email — Visual Flow

This guide documents the **"Order Upsert from Email"** visual flow: a fully automated pipeline that reads an inbound supplier email, extracts order data with AI, and either updates an existing inventory order or creates a new one from scratch.

**Seed script:** `src/scripts/seed-order-upsert-flow.ts`

---

## Overview

```
inbound_emails.inbound-email.created
        │
        ▼
   read_email       ← read_data: latest unprocessed inbound email
        │
        ▼
   parse_email      ← ai_extract: order_number, status, lines, tracking, dates
        │
        ▼
   find_order       ← read_data: inventory_orders WHERE metadata.order_number = parsed value
        │
        ▼
   order_found      ← condition: find_order.records.length > 0?
       / \
   TRUE   FALSE
     │       │
 prepare_update   create_inventory_items  ← bulk_trigger_workflow (one item per line)
     │               │
 update_order    create_raw_materials    ← bulk_trigger_workflow (one per line)
     │               │
 mark_processed  prepare_create          ← execute_code: assemble create-order input
                     │
                 create_order            ← trigger_workflow: create-inventory-order-workflow
                     │
                 mark_processed_create   ← update_data: email.status = "processed"
```

---

## Trigger

| Field | Value |
|-------|-------|
| Type | `event` |
| Event | `inbound_emails.inbound-email.created` |

---

## Operations

### 1. `read_email` — Read Data

Reads the latest inbound email that has not yet been processed.

```json
{
  "module": "inbound_emails",
  "collection": "InboundEmails",
  "fields": ["id", "subject", "html_body", "text_body", "from_address", "status"],
  "filters": { "status": "pending" },
  "pagination": { "take": 1, "order_by": "created_at", "order": "DESC" }
}
```

**DataChain key:** `read_email` → `{ records: [{ id, subject, html_body, ... }] }`

---

### 2. `parse_email` — AI Extract

Sends the email body to an LLM (OpenRouter `google/gemini-2.5-flash-preview`) and extracts structured order data.

**System prompt** instructs the model to extract:

| Field | Type | Notes |
|-------|------|-------|
| `order_number` | string | Supplier PO/order reference |
| `status` | enum | `Pending \| Processing \| Shipped \| Delivered \| Cancelled` |
| `order_date` | string | ISO date |
| `expected_delivery_date` | string | ISO date, optional |
| `tracking_number` | string | May appear as a URL — extract the code |
| `carrier` | string | Courier name |
| `notes` | string | Any extra info |
| `order_lines` | array | `[{ description, quantity, unit_price }]` |

The prompt explicitly handles cases where tracking info is provided as a hyperlink.

**DataChain key:** `parse_email` → extracted fields directly on the object.

---

### 3. `find_order` — Read Data

Searches for an existing inventory order with matching `metadata.order_number`.

```json
{
  "module": "order_inventory",
  "collection": "InventoryOrders",
  "fields": ["id", "status", "metadata", "quantity", "total_price", "order_date", "expected_delivery_date"],
  "filters": { "metadata": { "order_number": "{{ parse_email.order_number }}" } },
  "pagination": { "take": 1 }
}
```

**DataChain key:** `find_order` → `{ records: [...] }`

---

### 4. `order_found` — Condition

Checks if any existing order was found.

```json
{
  "conditions": [{ "field": "find_order.records", "operator": "_empty", "value": false }]
}
```

- **True handle** → update branch
- **False handle** → create branch

---

## Update Branch (order found)

### 5a. `prepare_update` — Execute Code

Assembles the input for `update-inventory-order-workflow`. Only includes fields that were actually extracted to avoid overwriting existing data.

```js
const parsed   = $input.parse_email
const found    = $input.find_order
const email    = $input.read_email?.records?.[0]
const existing = found?.records?.[0] || {}

const data = {}
if (parsed.status)                 data.status = parsed.status
if (parsed.expected_delivery_date) data.expected_delivery_date = parsed.expected_delivery_date

data.metadata = {
  ...(existing.metadata || {}),
  order_number: parsed.order_number,
  ...(parsed.tracking_number ? { tracking_number: parsed.tracking_number } : {}),
  ...(parsed.carrier         ? { carrier: parsed.carrier }                 : {}),
  ...(parsed.notes           ? { notes: parsed.notes }                     : {}),
  last_email_id:   email?.id,
  last_email_from: email?.from_address,
}

return { id: existing.id, data, order_lines: [] }
```

### 6a. `update_order` — Trigger Workflow

Calls `update-inventory-order-workflow` with `prepare_update` output.

### 7a. `mark_processed_update` — Update Data

Sets the email `status = "processed"` so it won't be re-processed.

---

## Create Branch (order not found)

### 5b. `create_inventory_items` — Bulk Trigger Workflow

Creates one Medusa inventory item per order line using the core `create-inventory-items-workflow`.

```json
{
  "workflow_name": "create-inventory-items-workflow",
  "items": "{{ parse_email.order_lines }}",
  "input_template": {
    "items": [{ "title": "{{ item.description }}", "description": "{{ item.description }}" }]
  }
}
```

**Result shape:** `create_inventory_items.records[i]` = `InventoryItemDTO[]` (plain array, NOT `{ items: [...] }`).
Access the created item ID as: `records[i][0].id`

### 6b. `create_raw_materials` — Bulk Trigger Workflow

Creates a raw material record linked to each inventory item (using `create-raw-material` workflow).

```json
{
  "workflow_name": "create-raw-material",
  "items": "{{ parse_email.order_lines }}",
  "continue_on_error": true,
  "input_template": {
    "inventoryId": "{{ create_inventory_items.records[$index][0].id }}",
    "rawMaterialData": {
      "name": "{{ item.description }}",
      "composition": "{{ item.description }}",
      "unit_of_measure": "Meter",
      "status": "Active",
      "material_type": "Fabric"
    }
  }
}
```

`$index` is substituted with the loop index before interpolation, enabling cross-array references.
`continue_on_error: true` — if raw material creation fails, order creation still proceeds.

### 7b. `prepare_create` — Execute Code

Maps created inventory item IDs + AI-extracted lines into the `create-inventory-order-workflow` input shape.

```js
const parsed       = $input.parse_email
const email        = $input.read_email?.records?.[0]
const createdItems = $input.create_inventory_items?.records || []
const parsedLines  = parsed.order_lines || []

const order_lines = parsedLines.map((line, idx) => {
  const itemResult = createdItems[idx]
  // createInventoryItemsWorkflow returns InventoryItemDTO[] (plain array)
  const itemsArr   = Array.isArray(itemResult) ? itemResult : (itemResult?.items || [])
  const inventoryItemId = itemsArr[0]?.id
  return {
    inventory_item_id: inventoryItemId,
    quantity: Number(line.quantity)   || 1,
    price:    Number(line.unit_price) || 0,
  }
}).filter(l => l.inventory_item_id)

return {
  status:                 parsed.status || "Pending",
  is_sample:              false,
  order_date:             parsed.order_date || new Date().toISOString(),
  expected_delivery_date: parsed.expected_delivery_date || null,
  stock_location_id:      "sloc_01JEWQM7RPDS5C9QEMBXXXWHP5",
  shipping_address:       {},
  quantity:               order_lines.reduce((s, l) => s + l.quantity, 0),
  total_price:            order_lines.reduce((s, l) => s + l.quantity * l.price, 0),
  order_lines,
  metadata: { order_number: parsed.order_number, source: "inbound_email", email_id: email?.id, ... }
}
```

### 8b. `create_order` — Trigger Workflow

Triggers `create-inventory-order-workflow` with `prepare_create` output.

### 9b. `mark_processed_create` — Update Data

Sets the email `status = "processed"`.

---

## Key Implementation Lessons

### 1. `update_data` collection name must be plural

MedusaService generates `update<Model>s` (plural). Use the plural PascalCase form:

```json
{ "collection": "InboundEmails" }  ✓
{ "collection": "InboundEmail"  }  ✗  → "Method 'updateInboundEmail' not found"
```

### 2. `createInventoryItemsWorkflow` returns a plain array

The Medusa core workflow `create-inventory-items-workflow` returns `InventoryItemDTO[]` directly, **not** `{ items: [...] }`. So `bulk_trigger_workflow.records[i]` is `[{ id, title, ... }]`.

```js
// ✓ Correct — in execute_code
const itemResult = createdItems[idx]
const itemsArr   = Array.isArray(itemResult) ? itemResult : (itemResult?.items || [])
const id         = itemsArr[0]?.id

// ✓ Correct — in input_template with $index substitution
"inventoryId": "{{ create_inventory_items.records[$index][0].id }}"
```

### 3. `validateInventoryStep` must not run in parallel with `createInventoryOrderWithLinesStep`

In Medusa's workflow SDK, steps that don't share a data dependency can execute in parallel. Since `validateInventoryStep(input)` and `createInventoryOrderWithLinesStep(input)` both took `input` directly (no chained dependency), they ran independently. When validation failed, `created` was `undefined` in the downstream transform, causing:

```
TypeError: Cannot read properties of undefined (reading 'order')
```

**Fix:** Remove `validateInventoryStep`. Invalid inventory items are caught downstream by the link creation step.

### 4. Nullable date fields in the model

`model.dateTime()` is NOT NULL by default. Passing `null` for `expected_delivery_date` caused a database constraint violation. Both date fields on `InventoryOrder` are now nullable:

```typescript
// src/modules/inventory_orders/models/order.ts
expected_delivery_date: model.dateTime().nullable(),
order_date:             model.dateTime().nullable(),
```

Migration applied: `Migration20260305151334`.

### 5. Canvas `trigger` node and edge are required in seed scripts

The visual flow engine finds starting operations by looking for `connections` where `source_id === "trigger"`. Seed scripts must include:

- A `trigger` node in `canvas_state.nodes`
- A `trigger → first_operation` edge in `canvas_state.edges`
- A `trigger → first_operation` entry in `connections`

Without these, `Starting operations: []` and the flow never executes.

### 6. DB options fallback in the execution engine

The execution engine (`execute-visual-flow.ts`) now falls back to DB operation options when canvas node `data.options` is empty. This allows seed scripts to store options only in the `visual_flow_operation` table without embedding them in `canvas_state`.

---

## Re-seeding

The seed script guards against duplicate flows by name. To re-seed after changes:

1. Delete the flow in the Admin UI (Visual Flows → delete)
2. Run: `npx medusa exec src/scripts/seed-order-upsert-flow.ts`
3. Activate the flow in the Admin UI (set status → Active)
