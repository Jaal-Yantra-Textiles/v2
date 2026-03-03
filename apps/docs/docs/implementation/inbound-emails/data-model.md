---
title: "Data Model"
sidebar_label: "Data Model"
sidebar_position: 2
---

# InboundEmail Data Model

## Schema

Defined in `src/modules/inbound_emails/models/inbound-email.ts` using Medusa DML:

```typescript
import { model } from "@medusajs/framework/utils"

const InboundEmail = model.define("inbound_email", {
  id: model.id({ prefix: "inb_email" }).primaryKey(),
  imap_uid: model.text(),
  message_id: model.text().nullable(),
  from_address: model.text().searchable(),
  to_addresses: model.json(),
  subject: model.text().searchable(),
  html_body: model.text(),
  text_body: model.text().nullable(),
  folder: model.text(),
  received_at: model.dateTime(),
  status: model.enum(["received", "action_pending", "processed", "ignored"]).default("received"),
  action_type: model.text().nullable(),
  action_result: model.json().nullable(),
  extracted_data: model.json().nullable(),
  error_message: model.text().nullable(),
  metadata: model.json().nullable(),
})
```

## Field Reference

| Field | Type | Nullable | Default | Searchable | Description |
|-------|------|----------|---------|------------|-------------|
| `id` | string | No | Auto-generated (`inb_email_*`) | — | Primary key with custom prefix |
| `imap_uid` | text | No | — | — | IMAP message UID, used for deduplication |
| `message_id` | text | Yes | — | — | RFC 2822 Message-ID header |
| `from_address` | text | No | — | Yes | Sender email address |
| `to_addresses` | json | No | — | — | Array of recipient addresses |
| `subject` | text | No | — | Yes | Email subject line |
| `html_body` | text | No | — | — | Full HTML body of the email |
| `text_body` | text | Yes | — | — | Plain text version (if available) |
| `folder` | text | No | — | — | IMAP folder the email was fetched from |
| `received_at` | datetime | No | — | — | Date from the email header |
| `status` | enum | No | `received` | — | Processing status |
| `action_type` | text | Yes | — | — | Registered action type (e.g. `create_inventory_order`) |
| `action_result` | json | Yes | — | — | Result data from action execution |
| `extracted_data` | json | Yes | — | — | Parsed data from the extraction step |
| `error_message` | text | Yes | — | — | Last error message if action failed |
| `metadata` | json | Yes | — | — | Arbitrary metadata |

## Status Enum

| Value | Description |
|-------|-------------|
| `received` | Email fetched and stored, no action taken |
| `action_pending` | Data extracted, waiting for admin to execute or ignore |
| `processed` | Action executed successfully |
| `ignored` | Admin marked as not needing action |

### Status Transitions

```
received ──(POST extract)──> action_pending ──(POST execute)──> processed
    │                              │
    └────(POST ignore)──> ignored <┘
```

## Service Methods

The module service extends `MedusaService({ InboundEmail })`, which auto-generates these methods:

| Method | Description |
|--------|-------------|
| `createInboundEmails(data)` | Create one or more records |
| `retrieveInboundEmail(id)` | Get a single record by ID |
| `listInboundEmails(filters, config)` | List records with filters |
| `listAndCountInboundEmails(filters, config)` | List + total count |
| `updateInboundEmails(id, data)` | Update a record |
| `deleteInboundEmails(id)` | Soft-delete a record |

### Example: Creating a Record

```typescript
const service = container.resolve("inbound_emails")

const email = await service.createInboundEmails({
  imap_uid: "1234",
  message_id: "<abc@vendor.com>",
  from_address: "orders@vendor.com",
  to_addresses: ["team@yourdomain.com"],
  subject: "Order Confirmation #12345",
  html_body: "<html>...</html>",
  text_body: "Order confirmed...",
  folder: "INBOX",
  received_at: new Date(),
  status: "received",
})
// email.id => "inb_email_01ABC..."
```

### Example: Listing with Filters

```typescript
const [emails, count] = await service.listAndCountInboundEmails(
  { status: "received", from_address: "orders@vendor.com" },
  { skip: 0, take: 20, order: { received_at: "DESC" } }
)
```

## Module Link

A many-to-many link exists between `InboundEmail` and `InventoryOrder`:

```typescript
// src/links/inbound-email-inventory-order.ts
import { defineLink } from "@medusajs/framework/utils"
import InboundEmailModule from "../modules/inbound_emails"
import InventoryOrdersModule from "../modules/inventory_orders"

export default defineLink(
  { linkable: InboundEmailModule.linkable.inboundEmail, isList: true },
  { linkable: InventoryOrdersModule.linkable.inventoryOrders, isList: true }
)
```

This allows querying related records via the Medusa link system.
