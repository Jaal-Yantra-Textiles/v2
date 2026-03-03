---
title: "API Reference"
sidebar_label: "API Reference"
sidebar_position: 3
---

# Inbound Emails API Reference

All routes require admin authentication (`Authorization: Bearer <token>`).

Base path: `/admin/inbound-emails`

## List Emails

```
GET /admin/inbound-emails
```

### Query Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | `20` | Page size (1–100) |
| `offset` | number | `0` | Pagination offset |
| `q` | string | — | Search subject and from_address (partial match) |
| `status` | enum | — | Filter: `received`, `action_pending`, `processed`, `ignored` |
| `from_address` | string | — | Exact match on sender address |
| `folder` | string | — | Exact match on IMAP folder |

### Response

```json
{
  "inbound_emails": [
    {
      "id": "inb_email_01ABC...",
      "imap_uid": "1234",
      "message_id": "<abc@vendor.com>",
      "from_address": "orders@vendor.com",
      "to_addresses": ["team@example.com"],
      "subject": "Order Confirmation #12345",
      "folder": "INBOX",
      "received_at": "2026-03-01T10:30:00.000Z",
      "status": "received",
      "action_type": null,
      "error_message": null,
      "created_at": "2026-03-01T10:30:05.000Z",
      "updated_at": "2026-03-01T10:30:05.000Z"
    }
  ],
  "count": 42,
  "offset": 0,
  "limit": 20
}
```

:::note
The list endpoint **excludes** heavy fields (`html_body`, `text_body`, `extracted_data`, `action_result`) for performance. Use the detail endpoint to fetch these.
:::

---

## Get Email Detail

```
GET /admin/inbound-emails/:id
```

### Response

Returns the full record including `html_body`, `text_body`, `extracted_data`, and `action_result`.

```json
{
  "inbound_email": {
    "id": "inb_email_01ABC...",
    "imap_uid": "1234",
    "message_id": "<abc@vendor.com>",
    "from_address": "orders@vendor.com",
    "to_addresses": ["team@example.com"],
    "subject": "Order Confirmation #12345",
    "html_body": "<html>...</html>",
    "text_body": "Order confirmed...",
    "folder": "INBOX",
    "received_at": "2026-03-01T10:30:00.000Z",
    "status": "action_pending",
    "action_type": "create_inventory_order",
    "extracted_data": {
      "vendor": "vendor",
      "order_number": "12345",
      "items": [...]
    },
    "action_result": null,
    "error_message": null,
    "metadata": null,
    "created_at": "2026-03-01T10:30:05.000Z",
    "updated_at": "2026-03-01T11:00:00.000Z"
  }
}
```

### Errors

| Status | Condition |
|--------|-----------|
| 404 | Email ID not found |

---

## List Available Actions

```
GET /admin/inbound-emails/actions
```

Returns all registered actions from the action registry.

### Response

```json
{
  "actions": [
    {
      "type": "create_inventory_order",
      "label": "Create Inventory Order",
      "description": "Parse order confirmation email and create an inventory order with line items"
    }
  ]
}
```

---

## Manual Sync

```
POST /admin/inbound-emails/sync
```

Triggers an IMAP fetch of recent emails. Requires IMAP env vars to be configured.

### Request Body

```json
{
  "count": 50
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `count` | number | `50` | Number of recent emails to fetch (1–500) |

### Response

```json
{
  "synced": 12,
  "skipped": 38,
  "total_fetched": 50
}
```

| Field | Description |
|-------|-------------|
| `synced` | New emails stored |
| `skipped` | Already existing (by `imap_uid` + `folder`) |
| `total_fetched` | Total emails fetched from IMAP |

### Errors

| Status | Condition |
|--------|-----------|
| 400 | IMAP not configured |
| 500 | IMAP connection failed |

---

## Extract Data

```
POST /admin/inbound-emails/:id/extract
```

Runs the extraction logic for a given action type. Parses the email and stores structured data.

### Request Body

```json
{
  "action_type": "create_inventory_order"
}
```

### Response

```json
{
  "inbound_email_id": "inb_email_01ABC...",
  "action_type": "create_inventory_order",
  "extracted_data": {
    "vendor": "vendor",
    "order_number": "ORD-98765",
    "order_date": null,
    "items": [
      {
        "name": "Cotton Fabric",
        "quantity": 10,
        "price": 50.0,
        "sku": null
      }
    ],
    "subtotal": 500.0,
    "shipping_cost": 15.0,
    "tax": null,
    "total": 515.0,
    "tracking_number": "1Z999AA10123456784",
    "tracking_url": null,
    "estimated_delivery": null,
    "currency": "USD"
  }
}
```

### Side Effects

- Sets `status` to `action_pending`
- Stores `action_type` and `extracted_data` on the email record

### Errors

| Status | Condition |
|--------|-----------|
| 400 | Missing `action_type` or unknown action type |
| 404 | Email ID not found |

---

## Execute Action

```
POST /admin/inbound-emails/:id/execute
```

Executes the action with admin-provided parameters. For `create_inventory_order`, this creates an inventory order via the existing workflow.

### Request Body

```json
{
  "action_type": "create_inventory_order",
  "params": {
    "stock_location_id": "sloc_01ABC...",
    "from_stock_location_id": "sloc_01DEF...",
    "item_mappings": [
      {
        "extracted_item_index": 0,
        "inventory_item_id": "iitem_01GHI...",
        "quantity": 10,
        "price": 50.0
      }
    ]
  }
}
```

#### Params for `create_inventory_order`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `stock_location_id` | string | Yes | Destination stock location |
| `from_stock_location_id` | string | No | Source stock location |
| `item_mappings` | array | Yes | Maps extracted items to inventory items |
| `item_mappings[].extracted_item_index` | number | Yes | Index in `extracted_data.items` |
| `item_mappings[].inventory_item_id` | string | Yes | Target inventory item ID |
| `item_mappings[].quantity` | number | Yes | Quantity to order |
| `item_mappings[].price` | number | Yes | Unit price |

### Response

```json
{
  "inbound_email_id": "inb_email_01ABC...",
  "action_type": "create_inventory_order",
  "action_result": {
    "inventory_order_id": "inv_order_01MNO...",
    "order_lines_count": 1
  }
}
```

### Side Effects

- Sets `status` to `processed`
- Stores `action_result` on the email record
- Clears `error_message`
- Creates an inventory order via `createInventoryOrderWorkflow`

### Errors

| Status | Condition |
|--------|-----------|
| 400 | Missing `action_type`, missing `params`, unknown action type |
| 404 | Email ID not found |
| 500 | Action execution failed (error stored on record) |

---

## Ignore Email

```
POST /admin/inbound-emails/:id/ignore
```

Marks an email as ignored.

### Response

```json
{
  "inbound_email_id": "inb_email_01ABC...",
  "status": "ignored"
}
```

### Errors

| Status | Condition |
|--------|-----------|
| 404 | Email ID not found |
