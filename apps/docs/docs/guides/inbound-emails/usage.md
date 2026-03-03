---
title: "Using Inbound Emails"
sidebar_label: "Usage Guide"
sidebar_position: 2
---

# Using Inbound Emails

This guide walks through the typical workflow of processing an inbound email into an inventory order.

## Browsing Emails

Navigate to **Settings → Inbound Emails** in the admin panel. You'll see a table of all synced emails with:

- **From** — sender email address
- **Subject** — email subject line
- **Status** — color-coded badge: blue (received), orange (action pending), green (processed), grey (ignored)
- **Action** — the action type if one has been selected
- **Received** — when the email was received

### Searching & Filtering

- Use the **search bar** to filter by subject or sender address
- Use the **Status** filter dropdown to show only emails in a specific state
- Results are paginated — use the pagination controls at the bottom

### Manual Sync

Click **Sync Now** to trigger an immediate IMAP fetch. This fetches the most recent 50 emails and stores any that aren't already in the system. The button shows a loading spinner while syncing.

## Processing an Email

### Step 1: Open the Email

Click on any row to open the detail page. You'll see:

- Full email headers (from, to, date, folder, message ID)
- The email body rendered in a sandboxed preview
- Action controls

### Step 2: Extract Data

1. Select an action type from the dropdown (e.g. **Create Inventory Order**)
2. Click **Extract Data**
3. The system parses the email HTML and extracts:
   - Vendor name (from sender domain)
   - Order number
   - Line items (name, quantity, price, SKU)
   - Totals (subtotal, shipping, tax, total)
   - Tracking information
   - Currency

The extracted data appears in a JSON preview below the action controls. The email status changes to **action_pending**.

### Step 3: Execute the Action

1. Click **Execute Action** to open the mapping dialog
2. In the dialog:
   - Select a **Stock Location** from the dropdown
   - For each extracted item, enter the **Inventory Item ID** of the matching item in your system
   - Adjust **Quantity** and **Price** if the extraction wasn't accurate
3. Click **Execute Action** to create the inventory order

On success, the email status changes to **processed** and the action result (including the new inventory order ID) is stored on the record.

### Ignoring Emails

For emails that don't need processing (newsletters, spam, irrelevant notifications), click **Ignore** on the detail page. This sets the status to **ignored** and removes it from the active queue.

## Status Lifecycle

```
received ──(extract)──> action_pending ──(execute)──> processed
    │                        │
    └──────(ignore)──> ignored <──┘
```

| Status | Meaning |
|--------|---------|
| `received` | Email fetched and stored, no action taken yet |
| `action_pending` | Data has been extracted, waiting for admin to execute or ignore |
| `processed` | Action executed successfully (e.g. inventory order created) |
| `ignored` | Admin marked as not needing action |

## Tips

- **Check extracted data before executing** — the regex-based parser handles common formats but may miss items from unusual email layouts
- **You can re-extract** — running extraction again on the same email replaces the previous extracted data
- **Errors are stored** — if execution fails, the error message is saved on the record and visible in the detail page
- **Use Sync Now sparingly** — the IMAP IDLE listener handles new emails automatically in real-time; manual sync is for catching up on historical emails
