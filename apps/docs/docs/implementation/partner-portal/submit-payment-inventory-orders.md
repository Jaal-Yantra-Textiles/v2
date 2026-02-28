---
title: "Partner Submit Payment on Inventory Orders"
sidebar_label: "Submit Payment"
sidebar_position: 1
---

# Partner Submit Payment on Inventory Orders

## Overview

Partners can submit payments against their inventory orders directly from the partner portal. When a payment is submitted, it is created with a **Pending** status and linked to the inventory order via the `createPaymentAndLinkWorkflow`.

## Architecture

```
Partner UI (RouteDrawer form)
  │
  ▼
POST /partners/inventory-orders/:orderId/submit-payment
  │
  ├─ Auth: getPartnerFromAuthContext()
  ├─ Validation: Zod safeParse (inline schema)
  │
  ▼
createPaymentAndLinkWorkflow
  ├─ createPaymentStep (status: "Pending")
  └─ linkPaymentToInventoryOrdersStep (links payment ↔ order)
```

## Backend

### API Route

**File:** `src/api/partners/inventory-orders/[orderId]/submit-payment/route.ts`

**Method:** `POST`

**Authentication:** Partner session or bearer token via `getPartnerFromAuthContext()`.

**Request Body:**

| Field          | Type     | Required | Default | Description                          |
|----------------|----------|----------|---------|--------------------------------------|
| `amount`       | number   | Yes      | —       | Payment amount (must be > 0)         |
| `payment_type` | enum     | No       | "Cash"  | "Bank", "Cash", or "Digital_Wallet"  |
| `payment_date` | date     | No       | now     | When the payment was made            |
| `note`         | string   | No       | —       | Optional note attached as metadata   |
| `paid_to_id`   | string   | No       | —       | ID of a saved payment method to link |

**Response:**

```json
{
  "message": "Payment submitted successfully",
  "payment": { "id": "...", "amount": 5000, "status": "Pending", ... }
}
```

**Error Responses:**

- `400` — Invalid request body (Zod validation errors)
- `401` — Partner authentication required
- `500` — Workflow execution failure

### Middleware

**File:** `src/api/middlewares.ts`

Entry added alongside the existing start/complete routes:

```ts
{
  matcher: "/partners/inventory-orders/:orderId/submit-payment",
  method: "POST",
  middlewares: [
    authenticate("partner", ["session", "bearer"]),
  ],
}
```

### Workflow

Uses the existing `createPaymentAndLinkWorkflow` from `src/workflows/internal_payments/create-payment-and-link.ts`. This workflow:

1. **createPaymentStep** — Creates an internal payment record with the given amount, type, date, and `status: "Pending"`
2. **linkPaymentToInventoryOrdersStep** — Creates a remote link between the payment and the inventory order via `ORDER_INVENTORY_MODULE ↔ INTERNAL_PAYMENTS_MODULE`

## Frontend

### Mutation Hook

**File:** `apps/partner-ui/src/hooks/api/partner-inventory-orders.tsx`

```ts
useSubmitPartnerInventoryOrderPayment(orderId)
```

- POSTs to `/partners/inventory-orders/${orderId}/submit-payment`
- On success, invalidates both the detail and list query caches

### RouteDrawer Page

**File:** `apps/partner-ui/src/routes/inventory-orders/inventory-order-submit-payment/inventory-order-submit-payment.tsx`

Form fields:

| Field            | Component    | Behavior                                                       |
|------------------|-------------|----------------------------------------------------------------|
| Amount           | `Input`     | Pre-filled from `inventoryOrder.total_price`                   |
| Payment Date     | `DatePicker`| Defaults to today                                              |
| Payment Method   | `Select`    | Loads from `usePartnerPaymentMethods(partnerId)`, shows loading state |
| Note             | `Textarea`  | Optional                                                       |

**Payment type derivation:** When a saved payment method is selected, the `payment_type` is automatically derived:

| Method Type      | Payment Type     |
|------------------|------------------|
| `bank_account`   | `Bank`           |
| `cash_account`   | `Cash`           |
| `digital_wallet` | `Digital_Wallet` |
| None selected    | `Cash` (default) |

### Route Registration

**File:** `apps/partner-ui/src/dashboard-app/routes/get-partner-route.map.tsx`

Added as a child of `/inventory-orders/:id`:

```ts
{
  path: "submit-payment",
  lazy: () => import("../../routes/inventory-orders/inventory-order-submit-payment"),
}
```

### Action Button

**File:** `apps/partner-ui/src/routes/inventory-orders/inventory-order-detail/components/inventory-order-actions-section.tsx`

A "Submit Payment" button (secondary variant) is shown when `partner_started_at` is set — meaning the partner has started working on the order. This allows payment submission for both in-progress and completed orders.

## Files Summary

| # | Action | File |
|---|--------|------|
| 1 | Create | `src/api/partners/inventory-orders/[orderId]/submit-payment/route.ts` |
| 2 | Modify | `src/api/middlewares.ts` |
| 3 | Modify | `apps/partner-ui/src/hooks/api/partner-inventory-orders.tsx` |
| 4 | Create | `apps/partner-ui/src/routes/inventory-orders/inventory-order-submit-payment/inventory-order-submit-payment.tsx` |
| 5 | Create | `apps/partner-ui/src/routes/inventory-orders/inventory-order-submit-payment/index.ts` |
| 6 | Modify | `apps/partner-ui/src/dashboard-app/routes/get-partner-route.map.tsx` |
| 7 | Modify | `apps/partner-ui/src/routes/inventory-orders/inventory-order-detail/components/inventory-order-actions-section.tsx` |

## Patterns Reused

| Pattern | Source File |
|---------|------------|
| Route auth + manual Zod validation | `src/api/partners/inventory-orders/[orderId]/complete/route.ts` |
| RouteDrawer action page | `apps/partner-ui/src/routes/inventory-orders/inventory-order-start/` |
| Payment method select + type derivation | `src/admin/routes/inventory/orders/[id]/@add-payments/page.tsx` |
| Mutation hook with cache invalidation | `apps/partner-ui/src/hooks/api/partner-inventory-orders.tsx` |
