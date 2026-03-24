---
title: "Customer Design Notifications"
sidebar_label: "Customer Notifications"
sidebar_position: 5
---

# Customer Design Notifications

_Last updated: 2026-03-24_

This document covers the event-driven notification system that keeps customers informed about their design lifecycle — from assignment through inventory linking, production, and completion.

---

## Overview

When a design is created for (or by) a customer, the system sends email notifications at each meaningful milestone. All notifications flow through a single generic workflow that resolves the linked customer and sends a templated email.

```
Design Created → Assigned → Inventory Linked → Production Started → Production Completed
       ↓              ↓              ↓                  ↓                    ↓
  design.assigned  design.assigned  design.inventory_linked  design.production_started  design.production_completed
       ↓              ↓              ↓                  ↓                    ↓
  [subscriber]   [subscriber]   [subscriber]       [subscriber]         [subscriber]
       ↓              ↓              ↓                  ↓                    ↓
  Email sent     Email sent     Email sent         Email sent           Email sent
```

Status transitions (e.g. `In_Development`, `Technical_Review`, `Approved`) are also captured via the `design.updated` event and send status update emails.

---

## Events & Subscribers

| Event | Emitted From | Subscriber | Email Template |
|---|---|---|---|
| `design.assigned` | `createDesignWorkflow` (when `customer_id_for_link` is set) | `design-assigned.ts` | `design-assigned` |
| `design.updated` | Medusa auto-emit on model update | `design-commerce-ready.ts` | `design-status-updated` |
| `design.inventory_linked` | `linkDesignInventoryWorkflow` | `design-inventory-linked.ts` | `design-inventory-linked` |
| `design.production_started` | `sendProductionRunToProductionWorkflow` | `design-production-started.ts` | `design-production-started` |
| `design.production_completed` | `production-run-task-updated.ts` subscriber (when all tasks complete) | `design-production-completed.ts` | `design-production-completed` |

---

## Architecture

### Generic Status Update Workflow

All design lifecycle notifications (except the initial assignment) use `sendDesignStatusUpdateEmailWorkflow`:

```
src/workflows/email/workflows/send-design-status-update-email.ts
```

**Steps:**

1. **`resolveCustomerFromDesignStep`** — Queries `designCustomerLink` to find the linked customer. Returns `null` if no customer is linked (email is silently skipped).
2. **`transform`** — Builds the email payload with customer name, design name, status, and any extra template data.
3. **`sendNotificationEmailStep`** — Creates a notification via Medusa's notification module, which routes to the configured email provider (Resend for customer emails).

This workflow accepts a `templateKey` parameter, making it reusable for all design notification types.

### Design Assignment Workflow

The `design.assigned` event uses the original `sendDesignAssignedEmailWorkflow` which takes a `customerId` directly (since it's emitted from `createDesignWorkflow` where the customer ID is already known).

```
src/workflows/email/workflows/send-design-assigned-email.ts
```

### Event Emission Points

#### `design.assigned` — in `createDesignWorkflow`

The `emitDesignAssignedStep` fires inside the conditional `when(customer_id_for_link)` block, right after `linkDesignToCustomerStep`. This means both admin and store design creation paths emit the event from the workflow itself — no API-level event emission needed.

```typescript
// src/workflows/designs/create-design.ts
when({ input, design }, ({ input }) => Boolean(input.customer_id_for_link)).then(() => {
  linkDesignToCustomerStep(...)
  emitDesignAssignedStep({
    design_id, customer_id, design_name, design_status
  })
})
```

#### `design.inventory_linked` — in `linkDesignInventoryWorkflow`

The `emitDesignInventoryLinkedStep` fires after inventory links are created:

```typescript
// src/workflows/designs/inventory/link-inventory.ts
const linksResult = createDesignInventoryLinks(...)
emitDesignInventoryLinkedStep({ design_id, inventory_count })
```

#### `design.production_started` — in `sendProductionRunToProductionWorkflow`

Emitted alongside the existing `production_run.sent_to_partner` event in `notifyPartnerStep`:

```typescript
// src/workflows/production-runs/send-production-run-to-production.ts
await eventService.emit([
  { name: "production_run.sent_to_partner", data: { ... } },
  { name: "design.production_started", data: { design_id, production_run_id } },
])
```

#### `design.production_completed` — in `production-run-task-updated` subscriber

Emitted after a production run's status is set to `completed`:

```typescript
// src/subscribers/production-run-task-updated.ts
await productionRunService.updateProductionRuns({ id, status: "completed" })
await eventBus.emit({
  name: "design.production_completed",
  data: { design_id, production_run_id },
})
```

---

## Status Change Notifications

The `design-commerce-ready.ts` subscriber (listening on `design.updated`) handles all status transitions. It notifies customers for the following statuses:

| Status | Meaning |
|---|---|
| `In_Development` | Partner has started work |
| `Technical_Review` | Partner has finished, awaiting review |
| `Sample_Production` | Sample is being produced |
| `Approved` | Design has been approved |
| `Commerce_Ready` | Design promoted to product (also triggers `promoteDesignToProductWorkflow`) |

Statuses like `Conceptual`, `Revision`, `On_Hold`, and `Rejected` do **not** trigger customer emails — they're internal workflow states.

---

## Email Templates

All templates are seeded via `src/scripts/seed-email-templates.ts`. Run the seed script after deployment to populate new templates.

| Template Key | Subject | Variables |
|---|---|---|
| `design-assigned` | Your custom design is ready: {{design_name}} | `customer_name`, `design_name`, `design_url`, `design_status` |
| `design-status-updated` | Design update: {{design_name}} is now {{design_status}} | `recipient_name`, `design_name`, `previous_status`, `design_status`, `updated_by`, `design_url` |
| `design-inventory-linked` | Materials assigned to your design: {{design_name}} | `customer_name`, `design_name`, `design_status`, `design_url` |
| `design-production-started` | Production has started for your design: {{design_name}} | `customer_name`, `design_name`, `design_url` |
| `design-production-completed` | Production complete for your design: {{design_name}} | `customer_name`, `design_name`, `design_url` |

All templates use the `designs@jyt.com` sender address and are sent via the `email` channel (Resend provider).

---

## File Reference

### Workflows

| File | Purpose |
|---|---|
| `src/workflows/email/workflows/send-design-status-update-email.ts` | Generic workflow — resolves customer from design link, sends templated email |
| `src/workflows/email/workflows/send-design-assigned-email.ts` | Assignment-specific workflow (takes customerId directly) |
| `src/workflows/designs/create-design.ts` | Emits `design.assigned` in `emitDesignAssignedStep` |
| `src/workflows/designs/inventory/link-inventory.ts` | Emits `design.inventory_linked` in `emitDesignInventoryLinkedStep` |
| `src/workflows/production-runs/send-production-run-to-production.ts` | Emits `design.production_started` in `notifyPartnerStep` |

### Subscribers

| File | Event | Action |
|---|---|---|
| `src/subscribers/design-assigned.ts` | `design.assigned` | Sends assignment email |
| `src/subscribers/design-commerce-ready.ts` | `design.updated` | Sends status update email + promotes to product on Commerce_Ready |
| `src/subscribers/design-inventory-linked.ts` | `design.inventory_linked` | Sends inventory linked email |
| `src/subscribers/design-production-started.ts` | `design.production_started` | Sends production started email |
| `src/subscribers/design-production-completed.ts` | `design.production_completed` | Sends production completed email |

### Links

| File | Relationship |
|---|---|
| `src/links/design-customer-link.ts` | Design ↔ Customer (many-to-many, used by `resolveCustomerFromDesignStep`) |

---

## Cart & Post-Payment Flow

The notification system integrates with the existing order flow without requiring changes to the cart or checkout process:

1. Customer adds design to cart via `POST /store/custom/designs/:id/checkout`
2. Customer completes payment (standard Medusa checkout)
3. `order.placed` subscriber fires:
   - Creates `design ↔ order` links
   - Creates `ProductionRun` for each design-linked line item
4. When the production run is dispatched to a partner → `design.production_started` email
5. When all tasks complete → `design.production_completed` email

The order confirmation email (existing) covers the payment/receipt side. The design notifications cover the production/fulfillment side.

---

## Manual Notification Trigger

Admins can manually re-send the design assignment email:

```
POST /admin/designs/:id/notify-customer
```

This endpoint looks up the linked customer via `designCustomerLink` and triggers `sendDesignAssignedEmailWorkflow`. Useful when the initial email fails or the customer needs a reminder.
