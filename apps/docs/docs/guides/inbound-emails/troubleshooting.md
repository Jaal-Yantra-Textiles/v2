---
title: "Troubleshooting"
sidebar_label: "Troubleshooting"
sidebar_position: 3
---

# Troubleshooting Inbound Emails

## IMAP Connection Issues

### "IMAP is not configured"

The IMAP environment variables are missing. Ensure `IMAP_HOST`, `IMAP_USER`, and `IMAP_PASSWORD` are all set in your `.env` file and restart the server.

### Connection timeout or refused

- Verify the host and port are correct (most providers use port 993 with TLS)
- Check that port 993 is not blocked by a firewall or VPN
- For iCloud: ensure you're using an **app-specific password**, not your Apple ID password

### "Lost connection to device" / frequent disconnects

The IMAP service has built-in reconnection logic with a 30-second delay. Check server logs for `[IMAP] Attempting reconnect...` messages. If disconnects are persistent:

- Check your internet connection stability
- Some IMAP providers enforce connection limits — ensure no other clients are holding too many connections
- Consider increasing the reconnect interval if the provider rate-limits

## Sync Issues

### "Sync Now" returns 0 synced, all skipped

This means all fetched emails already exist in the database (matched by `imap_uid` + `folder`). This is normal — it means you're up to date.

### Emails from a specific folder not appearing

Check the `IMAP_MAILBOX` environment variable. Default is `INBOX`. If your emails are in a different folder (e.g. `Purchases`, `Orders`), set:

```bash
IMAP_MAILBOX=Purchases
```

### Old emails not fetched

Manual sync fetches the most recent N emails (default 50). To fetch more, use the API directly:

```bash
curl -X POST http://localhost:9000/admin/inbound-emails/sync \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"count": 200}'
```

## Extraction Issues

### Items array is empty after extraction

The parser looks for items in two ways:
1. **HTML tables** — `<table>` rows containing a text cell and a price cell
2. **Text patterns** — lines matching `Item Name x10 $50.00`

If neither pattern matches the email's format, items will be empty. You can:

- Check the raw HTML via the detail page or API (`GET /admin/inbound-emails/:id`)
- If the vendor uses a non-standard format, consider adding a vendor-specific parser

### Order number not detected

The parser looks for patterns like:
- `Order #12345`
- `Order Number: ABC-123`
- `Confirmation #XYZ-789`
- `Order ID: 98765`

If your vendor uses a different format, the order number will be `null`. You can still proceed with execution — the order number is informational only.

### Prices showing wrong values

The parser extracts the first match for `Total:`, `Subtotal:`, etc. If the email contains multiple price sections (e.g. item prices and summary), it may pick up the wrong one. Review the extracted data before executing.

## Execution Issues

### "Workflow errors: ..."

The `createInventoryOrderWorkflow` failed. Common causes:

- **Invalid `stock_location_id`** — ensure the stock location exists
- **Invalid `inventory_item_id`** — ensure each mapped inventory item exists
- **Zero quantity** — quantity must be positive for non-sample orders

### Error persists after fixing and retrying

The error message is stored on the email record but the status stays at `action_pending` (not changed to `processed`). You can re-execute the action with corrected parameters.

### Email stuck in "action_pending"

This means extraction was done but execution hasn't happened yet. Either:
- Click **Execute Action** on the detail page to proceed
- Click **Ignore** if it's no longer needed

## Admin UI Issues

### Email body not rendering

The email body is displayed in a sandboxed `<iframe>`. If it appears blank:
- The email may have an empty HTML body — check `text_body` as fallback
- Some email clients generate complex HTML that may not render in a sandboxed iframe
- JavaScript in the email is stripped for security

### Page shows "Loading..." indefinitely

- Check that the API server is running
- Check browser console for network errors
- Verify your admin session hasn't expired (re-login if needed)
