---
title: "AI-Powered Email → Inventory Order Automation"
sidebar_label: "Visual Flow Automation"
sidebar_position: 5
---

# AI-Powered Email → Inventory Order Automation

## Overview

This document describes a zero-code automation built with the Visual Workflow Builder that:

1. Listens for incoming vendor emails via the `inbound_emails` module
2. Uses an LLM to extract structured order data from the email body
3. Automatically creates an inventory order if the email is an order confirmation
4. Marks the email as processed

**Trigger event:** `inbound_emails.inbound-email.created`

No custom code is required — the entire flow is configured through the Visual Flow Builder admin UI.

---

## The Complete Flow

### ASCII Diagram

```
[Trigger] inbound_emails.inbound-email.created
    │
    ▼
[ai_extract]  key: "extracted"
  → extracts email_type, order_number, vendor, items[], total
    │
    ▼
[condition]
  → success if extracted.object.email_type IN [order_received, confirmation]
  │                                  │
  │ success branch                   │ failure branch
  ▼                                  ▼
[execute_code]                   [log]
  key: "order_input"               "Not an order email, skipping"
  → builds order_lines from
    extracted.object.items
    │
    ▼
[trigger_workflow]
  → createInventoryOrderWorkflow
  → input: {
      order_lines,
      total_price,
      status: "Pending",
      metadata: { order_number, vendor, inbound_email_id }
    }
    │
    ▼
[update_data]
  → module: inbound_emails
  → record: $trigger.id
  → sets status: "processed"
  → sets metadata.action_result.order_id: $last.result.order.id
```

### Step-by-Step Table

| Step | Type | Key | What It Does |
|------|------|-----|--------------|
| 1 | `ai_extract` | `extracted` | Calls Gemini Flash to extract `email_type`, `order_number`, `vendor`, `items[]`, `total` from subject + HTML body |
| 2 | `condition` | — | Checks `extracted.object.email_type` is `order_received` or `confirmation`; routes to failure branch otherwise |
| 3 | `execute_code` | `order_input` | Maps `extracted.object.items` into `order_lines` array with quantity/price fields |
| 4 | `trigger_workflow` | — | Runs `createInventoryOrderWorkflow` with the built order input |
| 5 | `update_data` | — | Marks the inbound email as `processed` and stores the created order ID |

---

## Follow-Up: Shipped Email Flow

A second flow handles shipping confirmation emails. It is also triggered on `inbound_emails.inbound-email.created`.

```
[Trigger] inbound_emails.inbound-email.created
    │
    ▼
[ai_extract]  key: "extracted"
  → extracts email_type, order_number, tracking_number, carrier
    │
    ▼
[condition]
  → success if extracted.object.email_type === "shipped"
  │                         │
  │ success                 │ failure
  ▼                         ▼
[read_data]              [log] "Not a shipping email, skipping"
  key: "found_order"
  → module: inventory_orders
  → filter: metadata.order_number = extracted.object.order_number
    │
    ▼
[update_data]
  → record: found_order.result[0].id
  → sets status: "Shipped"
  → sets metadata.tracking_number: extracted.object.tracking_number
  → sets metadata.carrier: extracted.object.carrier
```

---

## Variable Reference Cheatsheet

| Variable | Source | Example Value |
|----------|--------|---------------|
| `{{ $trigger.subject }}` | Inbound email subject line | `"PO Confirmation #2024-001"` |
| `{{ $trigger.html_body }}` | Inbound email HTML body | Full HTML string |
| `{{ $trigger.from_email }}` | Sender email address | `"orders@vendor.com"` |
| `{{ $trigger.id }}` | Inbound email record ID | `"email_01HXYZ..."` |
| `{{ extracted.object.email_type }}` | ai_extract output | `"order_received"` |
| `{{ extracted.object.order_number }}` | ai_extract output | `"PO-2024-001"` |
| `{{ extracted.object.vendor }}` | ai_extract output | `"Acme Textiles"` |
| `{{ extracted.object.items }}` | ai_extract output | Array of line items |
| `{{ extracted.object.total }}` | ai_extract output | `1250.00` |
| `{{ extracted.usage.totalTokens }}` | ai_extract token usage | `165` |
| `{{ order_input.result.order_lines }}` | execute_code output | Mapped order lines array |
| `{{ $last.result.order.id }}` | Most recent operation result | Created order ID |
| `{{ found_order.result[0].id }}` | read_data output | Existing order record ID |

---

## ai_extract Configuration for Order Emails

```json
{
  "model": "google/gemini-2.0-flash-exp:free",
  "input": "Subject: {{ $trigger.subject }}\n\n{{ $trigger.html_body }}",
  "system_prompt": "Extract order info from this vendor email. Be precise. Return only the requested fields.",
  "schema_fields": [
    {
      "name": "email_type",
      "type": "enum",
      "enumValues": ["order_received", "confirmation", "shipped", "delivered", "other"],
      "required": true
    },
    { "name": "order_number", "type": "string" },
    { "name": "vendor", "type": "string" },
    { "name": "items", "type": "array", "description": "List of items with name, quantity, unit_price" },
    { "name": "total", "type": "number", "description": "Total order value" }
  ],
  "fallback_on_error": true
}
```

---

## Condition Filter Rules

The condition operation uses filter rules to check the extracted type:

```json
{
  "field": "extracted.object.email_type",
  "operator": "in",
  "value": ["order_received", "confirmation"]
}
```

For the shipped flow:

```json
{
  "field": "extracted.object.email_type",
  "operator": "eq",
  "value": "shipped"
}
```

---

## Notes

- Both flows run concurrently on the same trigger event. The condition in each flow ensures only the relevant flow takes action.
- The `fallback_on_error: true` on `ai_extract` prevents the flow from crashing on malformed emails — it simply skips through the condition's failure branch and logs the skip.
- The `execute_code` step is needed to reshape the raw `items` array (which may have inconsistent field names from the LLM) into a normalized `order_lines` format expected by `createInventoryOrderWorkflow`.
