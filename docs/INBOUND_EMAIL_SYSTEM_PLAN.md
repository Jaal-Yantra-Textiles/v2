# Inbound Email System with Pluggable Actions

## Context

The team orders raw materials from external e-commerce sites and receives confirmation/shipping emails. Currently, inventory orders are created manually. We want to build a **generic inbound email system** that:
1. Syncs emails from iCloud+ custom domain via IMAP (real-time IDLE)
2. Stores emails in a new module with an extensible **action system**
3. For the first action: extract order data from email HTML (simple parsing first, not AI) and create inventory orders
4. The action framework is generic — future actions can create designs, persons, or anything else

## Architecture

```
iCloud+ IMAP (custom domain)
  ← ImapFlow IDLE connection (real-time)
  → New email arrives → fetch body (HTML + text)
  → Store in InboundEmail module (status: received)
  → Admin views at /settings/inbound-emails
  → Admin selects action: "Create Inventory Order"
  → Simple HTML extraction parses order items, prices, quantities
  → Admin reviews extracted data, maps items to inventory, approves
  → Inventory order created via existing createInventoryOrderWorkflow
```

## Implementation

### 1. Install dependencies

```bash
pnpm add -w imapflow mailparser
pnpm add -w -D @types/mailparser
```

- `imapflow` — modern IMAP client with IDLE, async/await, TypeScript defs
- `mailparser` — parses raw email (MIME) into structured HTML/text/attachments

### 2. New Module: `inbound_emails` (via scripts)

Use the existing generator scripts:

```bash
# Step 1: Create module scaffold (index.ts, service.ts, models dir + auto-register in medusa-config)
npx medusa exec ./src/scripts/create-module.ts inbound_emails

# Step 2: Generate model with fields (creates model, updates service, runs db:generate + db:migrate)
npx medusa exec ./src/scripts/generate-model.ts inbound_emails inbound_email \
  imap_uid:text \
  message_id:text \
  from_address:text \
  to_addresses:json \
  subject:text \
  html_body:text \
  text_body:text \
  folder:text \
  received_at:datetime \
  status:enum(received,action_pending,processed,ignored) \
  action_type:text \
  action_result:json \
  extracted_data:json \
  error_message:text \
  metadata:json
```

Then manually edit the generated model to:
- Add `id` prefix (`inb_email`)
- Add `.nullable()` on optional fields (action_type, action_result, extracted_data, error_message, metadata, text_body, message_id)
- Add `.default("received")` on status
- Add `.searchable()` on subject and from_address

### 3. IMAP Sync Service

**Create** `src/utils/imap-sync.ts`

Singleton IMAP manager using `imapflow`:

```typescript
class ImapSyncService {
  private client: ImapFlow
  private onNewEmail: (email: ParsedEmail) => Promise<void>

  constructor(config: ImapConfig, onNewEmail) { ... }

  async connect()     // Connect + open INBOX + start IDLE
  async disconnect()  // Graceful close
  async syncRecent(count: number)  // Fetch last N emails (initial sync / manual)

  // IDLE handler: on "exists" event → fetch new messages → call onNewEmail
}
```

Config from env vars:
```
IMAP_HOST=imap.mail.me.com
IMAP_PORT=993
IMAP_USER=orders@yourdomain.com
IMAP_PASSWORD=xxxx-xxxx-xxxx-xxxx   # iCloud app-specific password
IMAP_TLS=true
IMAP_MAILBOX=INBOX
```

For each new email:
1. Fetch with `bodyStructure: true`
2. Download raw source via `client.download(uid, "")`
3. Parse with `mailparser.simpleParser()` → gets `from`, `to`, `subject`, `html`, `text`, `date`, `messageId`, `attachments`
4. Call the `onNewEmail` callback which stores in InboundEmail module

### 4. IMAP Subscriber (Auto-Start)

**Create** `src/subscribers/imap-sync.ts`

Medusa subscriber that starts the IMAP sync on server boot:
- Listens to a startup event or initializes in constructor
- Creates `ImapSyncService` instance, connects
- `onNewEmail` callback: resolves `InboundEmailService` from container, creates record with status `received`
- Handles reconnection on disconnect

### 5. Link: Inbound Email ↔ Inventory Order

**Create** `src/links/inbound-email-inventory-order.ts`

Generic link so emails can reference created orders.

### 6. Simple HTML Email Parser

**Create** `src/utils/parse-order-email.ts`

Simple extraction (no AI) that parses common e-commerce email patterns:

```typescript
interface ExtractedOrderData {
  vendor_name: string | null
  external_order_ref: string | null
  items: Array<{ name: string; quantity: number; unit_price: number }>
  total_price: number | null
  tracking_number: string | null
  order_date: string | null
  expected_delivery_date: string | null
  email_type: "order_confirmation" | "shipping_update" | "other"
}

function parseOrderEmail(html: string, text: string, subject: string): ExtractedOrderData
```

Strategy:
- Strip HTML to text (or parse DOM with a lightweight parser like `htmlparser2` — already available via `mailparser`)
- Regex patterns for: order numbers (`Order #`, `Order ID`, `Confirmation #`), tracking numbers, prices (`$`, `₹`, `Total:`), dates
- Look for table structures in HTML (common in order confirmation emails) — extract rows as items
- Subject line analysis for email_type detection

### 7. Action Registry (Extensible Framework)

**Create** `src/utils/inbound-email-actions/index.ts`

```typescript
interface InboundEmailAction {
  type: string                    // e.g. "create_inventory_order"
  label: string                   // e.g. "Create Inventory Order"
  description: string
  // Extract structured data from the email for this action
  extract(email: InboundEmail): Promise<any>
  // Execute the action (called on admin approval)
  execute(email: InboundEmail, extractedData: any, params: any, container: MedusaContainer): Promise<any>
}

const actionRegistry = new Map<string, InboundEmailAction>()

function registerAction(action: InboundEmailAction): void
function getAction(type: string): InboundEmailAction | undefined
function listActions(): InboundEmailAction[]
```

**Create** `src/utils/inbound-email-actions/create-inventory-order.ts`

The first action implementation:
- `extract()`: calls `parseOrderEmail()` from the HTML parser
- `execute()`: takes admin-provided `stock_location_id` + `item_mappings`, calls `createInventoryOrderWorkflow`
- Stores result in `action_result` on the InboundEmail record

### 8. Admin API Routes

**Create** `src/api/admin/inbound-emails/route.ts`

- `GET /admin/inbound-emails` — list with filters (status, from_address, q, folder, pagination)

**Create** `src/api/admin/inbound-emails/actions/route.ts`

- `GET /admin/inbound-emails/actions` — list available actions from registry

**Create** `src/api/admin/inbound-emails/sync/route.ts`

- `POST /admin/inbound-emails/sync` — trigger manual IMAP sync (fetch recent emails)

**Create** `src/api/admin/inbound-emails/[id]/route.ts`

- `GET /admin/inbound-emails/:id` — full detail with html_body, extracted_data

**Create** `src/api/admin/inbound-emails/[id]/extract/route.ts`

- `POST /admin/inbound-emails/:id/extract` — run extraction for a specific action type
  Body: `{ action_type: "create_inventory_order" }`
  Returns extracted data preview

**Create** `src/api/admin/inbound-emails/[id]/execute/route.ts`

- `POST /admin/inbound-emails/:id/execute` — execute the action with admin-provided params
  Body: `{ action_type: "create_inventory_order", params: { stock_location_id, item_mappings, overrides } }`

**Create** `src/api/admin/inbound-emails/[id]/ignore/route.ts`

- `POST /admin/inbound-emails/:id/ignore`

**Create** `src/api/admin/inbound-emails/validators.ts`

### 9. Admin UI (under Settings)

**Create** `src/admin/routes/settings/inbound-emails/page.tsx`

DataTable (pattern: `src/admin/routes/settings/notifications/page.tsx`):
- Columns: From, Subject, Status (badge), Action, Received Date
- Toolbar: "Sync Now" button, status filter
- Row click → detail page

**Create** `src/admin/routes/settings/inbound-emails/[id]/page.tsx`

Detail page:
- Email header card (from, to, subject, date, folder)
- Email body preview (sanitized HTML in container, text fallback)
- Action selector dropdown (from registry) with "Extract" button
- Extracted data preview card (items table, order details)
- "Execute Action" button (opens params dialog)
- Status indicators + linked inventory order if created

**Create** `src/admin/components/inbound-emails/execute-action-dialog.tsx`

For "create_inventory_order" action:
- Extracted items with inventory item search/select dropdowns
- Stock location selector
- Optional overrides
- Submit → POST execute

**Create** `src/admin/hooks/api/inbound-emails.ts`

React Query hooks for all endpoints.

### 10. Environment Variables

```
IMAP_HOST=imap.mail.me.com
IMAP_PORT=993
IMAP_USER=orders@yourdomain.com
IMAP_PASSWORD=xxxx-xxxx-xxxx-xxxx
IMAP_TLS=true
IMAP_MAILBOX=INBOX
```

## Files Summary

| # | Action | File | Purpose |
|---|--------|------|---------|
| 1 | Script | `npx medusa exec create-module.ts inbound_emails` | Scaffold module + register |
| 2 | Script | `npx medusa exec generate-model.ts inbound_emails inbound_email ...` | Model + migration |
| 3 | Edit | `src/modules/inbound_emails/models/inbound_email.ts` | Add nullable/defaults/prefix |
| 5 | Create | `src/utils/imap-sync.ts` | IMAP connection + IDLE + fetch |
| 6 | Create | `src/subscribers/imap-sync.ts` | Auto-start IMAP on server boot |
| 7 | Create | `src/links/inbound-email-inventory-order.ts` | Link definition |
| 8 | Create | `src/utils/parse-order-email.ts` | Simple HTML order extraction |
| 9 | Create | `src/utils/inbound-email-actions/index.ts` | Action registry framework |
| 10 | Create | `src/utils/inbound-email-actions/create-inventory-order.ts` | First action |
| 11 | Create | `src/api/admin/inbound-emails/route.ts` | List API |
| 12 | Create | `src/api/admin/inbound-emails/actions/route.ts` | List actions API |
| 13 | Create | `src/api/admin/inbound-emails/sync/route.ts` | Manual sync API |
| 14 | Create | `src/api/admin/inbound-emails/[id]/route.ts` | Detail API |
| 15 | Create | `src/api/admin/inbound-emails/[id]/extract/route.ts` | Extract API |
| 16 | Create | `src/api/admin/inbound-emails/[id]/execute/route.ts` | Execute action API |
| 17 | Create | `src/api/admin/inbound-emails/[id]/ignore/route.ts` | Ignore API |
| 18 | Create | `src/api/admin/inbound-emails/validators.ts` | Zod schemas |
| 19 | Modify | `src/api/middlewares.ts` | Validation middleware |
| 20 | Create | `src/admin/routes/settings/inbound-emails/page.tsx` | List UI |
| 21 | Create | `src/admin/routes/settings/inbound-emails/[id]/page.tsx` | Detail UI |
| 22 | Create | `src/admin/components/inbound-emails/execute-action-dialog.tsx` | Action dialog |
| 23 | Create | `src/admin/hooks/api/inbound-emails.ts` | React Query hooks |

## Key Patterns Reused

| Pattern | Source File |
|---------|------------|
| Inventory order creation | `src/workflows/inventory_orders/create-inventory-orders.ts` |
| Settings DataTable page | `src/admin/routes/settings/notifications/page.tsx` |
| Admin hooks | `src/admin/hooks/api/inventory-orders.ts` |
| Module registration | `src/modules/inventory_orders/` |
| Subscriber pattern | `src/subscribers/` (existing event handlers) |

## Verification

1. **Module + migration**: `npx medusa db:generate inbound_emails && npx medusa db:migrate`
2. **IMAP sync**: Server starts → connects to iCloud IMAP → IDLE listening. Send test email → record appears in DB
3. **Manual sync**: `POST /admin/inbound-emails/sync` → fetches recent emails
4. **Extract**: `POST /admin/inbound-emails/:id/extract` with action `create_inventory_order` → returns parsed items
5. **Execute**: `POST /admin/inbound-emails/:id/execute` with mappings → inventory order created
6. **Admin UI**: `/settings/inbound-emails` → table, detail, extract, execute all functional
7. **Build**: `pnpm build` — zero type errors
