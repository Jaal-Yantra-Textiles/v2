---
title: "Submitting Payments on Inventory Orders"
sidebar_label: "Submit Payment"
sidebar_position: 3
---

# Submitting Payments on Inventory Orders

This guide walks through how partners **record a payment that has already
happened** against an inventory order.

:::danger This is not how you ask to be paid
Submit Payment creates a **record that money moved**. It is not a claim: it
creates no payout, enters no review queue, and does not reduce what a payout
says is outstanding.

**If you are asking to be paid for material you supplied, use Payment
Submissions → Create → Goods instead.** See
[Getting Paid](./getting-paid.md), which explains the difference and why it
matters.
:::

## Prerequisites

- The partner must be logged in to the partner portal
- The inventory order must have been **started** by the partner (`partner_started_at` is set)
- Optionally, the partner should have saved payment methods configured under **Settings > Payments**

## Steps

### 1. Navigate to the Inventory Order

Go to **Inventory Orders** from the sidebar and click on the order you want to submit a payment for.

### 2. Click "Submit Payment"

In the **Actions** section on the order detail page, click the **Submit Payment** button. This button appears once you have started the order.

### 3. Fill in the Payment Form

The drawer form opens with the following fields:

- **Amount** — Pre-filled with the order's total price. You can adjust it if submitting a partial payment.
- **Payment Date** — Defaults to today. Change it if the payment was made on a different date.
- **Payment Method** — Select from your saved payment methods (bank accounts, cash accounts, digital wallets). The payment type is automatically determined from the method you choose. If you select "None", the payment type defaults to Cash.
- **Note** — Add an optional note for context (e.g., "Advance payment", "Final installment").

### 4. Submit

Click **Submit Payment**. The payment will be created with a **Pending** status and linked to the inventory order.

A success toast confirms the submission, and the drawer closes automatically.

## What Happens Next

- The payment appears in the admin's inventory order detail view under the payments section
- It also appears on the partner ledger (**Partners → *partner* → Payments**),
  listed as *"recorded against &lt;order&gt; — no payout attached"*
- Admin can review and update the payment status (approve, mark as completed, etc.)
- Partners can submit multiple payments against the same order (e.g., partial payments)

:::warning If a payout also bills this order
Both records now exist and neither knows about the other. The partner ledger
raises an orange warning on the payout — *"already recorded against the order
this bills — check before paying"* — but it deliberately does **not** subtract
one from the other. An advance and a payout can legitimately coexist, so a
human decides, by linking the payment to the submission it settles.
:::

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Submit Payment" button not visible | The order must be started first — click "Start" before submitting payments |
| Payment methods not loading | Check that you have payment methods saved under **Settings > Payments** |
| Payment method dropdown shows "Loading methods..." | Wait for the methods to load — this may take a moment on slow connections |
| Error on submit | Ensure the amount is greater than 0 and a payment date is selected |
