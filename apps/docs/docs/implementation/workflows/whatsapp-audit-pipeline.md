---
title: "WhatsApp Audit Pipeline — Visual Flow + Notification Module"
sidebar_label: "WhatsApp Audit Pipeline"
sidebar_position: 13
---

# WhatsApp Audit Pipeline — Visual Flow + Notification Module

> Companion to [Partner WhatsApp — Production Run Flow](./whatsapp-partner-run-flow.md), [Production Run Reminders](./production-run-reminders.md), and [Notification Module Tradeoffs](./notification-module-tradeoffs.md). This doc covers the second-store audit trail: every successful WhatsApp send writes a row to the Medusa Notification Module via an audit-only provider, so admins get one queryable home for outbound comms across channels without disturbing the conversation graph in `messaging_message`.

## Why this exists

Three storage shapes coexist after this work:

| Store | Owns | Read for |
|---|---|---|
| `messaging_message` (custom) | Two-way conversation graph: every inbound + outbound WhatsApp, status callbacks, button-tap routing, `wa_message_id` correlation | Operational truth, debugging, partner timeline |
| `production_run_activity` (custom) | Domain timeline: lifecycle transitions + reminder dispatches + future notes | Per-run timeline UI |
| `notification` (Medusa core) | **Outbound audit trail across channels** — this doc's subject | Cross-channel admin reporting, stats panels, "what comms went where" |

The notification table is **secondary**. Operational status (delivered/read/failed timeline, inbound replies, button-tap routing) stays in `messaging_message` because that's the right shape for a two-way conversation. The notification row is a one-write audit copy stamped at successful send.

See [Notification Module Tradeoffs](./notification-module-tradeoffs.md) for the design rationale.

## Architecture

```
caller code
   ↓
WhatsAppService.sendTextMessage(to, body, replyTo, audit)        ← audit is optional
   ↓
WhatsAppService.sendRequest(payload, to, audit)                  ← single hook point
   ↓
fetch → graph.facebook.com/v21.0/{phoneNumberId}/messages
   ↓
wamid in result.messages[0].id
   ↓
(if audit && to)
   ↓
recordWhatsappNotification(scope, { ...audit, to, wa_message_id })
   ↓
notificationModuleService.createNotifications({
  channel: "whatsapp",
  template, to, receiver_id, resource_type, resource_id,
  trigger_type, idempotency_key,
  data: { _already_sent: true, _external_id: wamid, ... }
})
   ↓
notification row persisted (status=success, external_id=wamid)
   ↓
whatsapp-audit provider's send() called by framework
   → reads data._already_sent, returns { id: data._external_id }
   → no actual network call (the WhatsApp message was already sent above)
```

The `_already_sent` / `_external_id` convention is the same one used by `maileroo` and `mailjet` providers in this codebase (see `src/modules/maileroo/service.ts:99-110`, `src/modules/mailjet/service.ts:89-100`). One pattern, three providers.

## Components

| Path | Purpose |
|---|---|
| `src/modules/notification-whatsapp-audit/index.ts` | Module-provider definition registered against `Modules.NOTIFICATION` |
| `src/modules/notification-whatsapp-audit/service.ts` | `WhatsappAuditNotificationProviderService` — `send()` short-circuits when `data._already_sent` and echoes back `_external_id` |
| `src/modules/messaging/lib/record-whatsapp-notification.ts` | Helper that resolves `Modules.NOTIFICATION` from a scope and calls `createNotifications` with the conventional fields. Failures are logged + swallowed so a flaky notification module never blocks a real send. |
| `src/modules/social-provider/whatsapp-service.ts` | Exports the public `WhatsAppAuditContext` type. Every leaf send method (`sendTextMessage`, `sendInteractiveMessage`, `sendTemplateMessage`, `sendImageMessage`, `sendDocumentMessage`, `sendVideoMessage`) takes an optional `audit?:` and threads it to `sendRequest`. The lowest-level `sendRequest` writes the audit row after Meta returns success. |
| `medusa-config.ts` / `medusa-config.dev.ts` / `medusa-config.prod.ts` | Audit provider registered against `channels: ["whatsapp"]` alongside the existing email + local providers. |

## How callers opt in

**The audit row only writes when the caller passes an `audit` arg.** Calls that omit it are unchanged — same network behaviour, same `messaging_message` writes, no notification row.

### Visual-flow `send_whatsapp` operation

The operation builds `audit` per mode (template/image/text) and threads it to the leaf send method. Source: `src/modules/visual_flows/operations/send-whatsapp.ts`.

For a `mode: "template"` send the audit shape is:

```ts
{
  template: templateName,
  partner_id: resolvedPartnerId,
  resource_type: contextType,            // "production_run" for partner-run flows
  resource_id: contextId,                // run id (with reminder-day suffix for reminders)
  trigger_type: $trigger.event,          // e.g. "production_run.reminder_assignment_pending"
                                          // or "visual_flow:<flowId>" for ad-hoc triggers
  idempotency_key: `${contextType}:${contextId}`,
  data: { mode: "template", flow_id, execution_id, operation_key,
          platform_id, variables },
}
```

Image and text sends include their mode-specific keys (`image_url` / `caption`, etc.). The visual-flow op no longer calls the helper directly — the service handles the write.

### `whatsapp-message-handler` workflow (inbound → outbound replies)

Every send the handler makes (consent prompts, language selection, welcome, help) gets a default `audit` from the wrapper:

```ts
const defaultAudit: WhatsAppAuditContext = {
  partner_id: partner.partnerId,
  trigger_type: "whatsapp_message_handler",
  data: { conversation_id: conversationId },
}
```

Source: `src/workflows/whatsapp/whatsapp-message-handler.ts`. Per-call sites can override by passing their own `audit` arg.

### `whatsapp-admin-handler` workflow

The handler has 40+ send sites — most are help text, list dumps, "Usage:" hints. Only **action-confirmation** sends are audited. The other sends pass no `audit` → no row → no noise.

Six audited call sites:

| Handler | trigger_type | resource_type | resource_id | data extras |
|---|---|---|---|---|
| `handleCreatePartner` | `whatsapp_admin.partner_created` | `partner` | new partner id | `admin_user_id, admin_name, partner_name, partner_email` |
| `handleApproveRun` | `whatsapp_admin.run_approved` | `production_run` | run id | `admin_user_id, admin_name, design_name` |
| `handleCancelRun` | `whatsapp_admin.run_cancelled` | `production_run` | run id | `admin_user_id, admin_name, previous_status` |
| `handleSendRun` | `whatsapp_admin.run_sent_to_production` | `production_run` | run id | `admin_user_id, admin_name, design_name, partner_id, template_names` |
| `handleReviewPayment` | `whatsapp_admin.payment_approved` / `..._rejected` | `payment_submission` | submission id | `admin_user_id, admin_name, decision, rejection_reason?` |
| `handleViewRun` (with action buttons only) | `whatsapp_admin.run_view_prompt` | `production_run` | run id | `admin_user_id, admin_name, run_status, offered_actions` |

Adding more admin call sites: thread `admin: ResolvedAdmin` into the handler signature (already done for these six), then pass `audit` to the leaf send method. ~8 lines per call site.

## What gets stored

The Notification model fields populated on every audit write:

| Column | Source |
|---|---|
| `to` | E.164 phone number of the recipient |
| `channel` | always `"whatsapp"` |
| `template` | template name for `mode: "template"` sends; null for text/image/interactive |
| `data` | structured JSON payload — includes `_already_sent: true`, `_external_id: <wamid>`, plus per-call extras (mode, flow_id, admin_user_id, etc.) |
| `trigger_type` | event/workflow/handler that initiated the send (e.g. `production_run.reminder_assignment_pending`, `whatsapp_admin.run_cancelled`) |
| `resource_type` | scoping discriminator (`production_run`, `partner`, `payment_submission`) |
| `resource_id` | the resource being acted on |
| `receiver_id` | partner uuid when applicable; null for admin-to-admin sends |
| `provider_id` | always `"whatsapp-audit"` |
| `external_id` | Meta's wamid — joined with `messaging_message.wa_message_id` for delivery status |
| `status` | `"success"` (audit happens after Meta accepted) |
| `idempotency_key` | conventional shape: `<resource_type>:<resource_id>` for transactional sends; `<run_id>:reminder:YYYY-MM-DD` for daily reminders so calendar-day cadence isn't deduped |
| `created_at` | when the audit row was written (≈ Meta acceptance time) |

## How to query

### Free admin API

`GET /admin/notifications` is built into the Medusa Notification module. Filterable by `channel`, `resource_type`, `resource_id`, `receiver_id`, `created_at` ranges.

```bash
# All admin-driven actions on a specific run
curl "$BACKEND/admin/notifications?resource_type=production_run&resource_id=prod_run_01ABC" \
  -H "Authorization: Basic $TOKEN" | \
  jq '.notifications[] | select(.trigger_type | startswith("whatsapp_admin.")) | {trigger_type, created_at, admin: .data.admin_name}'

# Every send in the last 24h on the whatsapp channel
curl "$BACKEND/admin/notifications?channel=whatsapp&limit=200" \
  -H "Authorization: Basic $TOKEN" | \
  jq '.notifications[] | {trigger_type, to, resource_id, external_id, created_at}'
```

### Stats dashboard panels

The audit data fits the `/admin/stats` dashboard system natively — each panel is a saved `read_data` / `aggregate_data` / `time_series` operation pointed at the `notification` entity.

Three panels recommended on the **"Partners & Production"** dashboard (`dash_01KPN994E4BP9M8Y10BRQFS69B` in prod):

#### 1. Recent admin actions on production runs (list)

```json
{
  "name": "Recent admin actions",
  "type": "list",
  "x": 0, "y": 10, "width": 6, "height": 5,
  "operation_type": "read_data",
  "operation_options": {
    "entity": "notification",
    "fields": ["id","to","channel","trigger_type","resource_type","resource_id","data","created_at"],
    "filters": { "channel": "whatsapp", "resource_type": "production_run" },
    "limit": 25
  },
  "display": { "labelField": "trigger_type", "valueField": "resource_id" }
}
```

#### 2. Admin actions by type (bar)

```json
{
  "name": "Admin actions by type",
  "type": "bar",
  "x": 6, "y": 10, "width": 6, "height": 5,
  "operation_type": "aggregate_data",
  "operation_options": {
    "entity": "notification",
    "filters": { "channel": "whatsapp" },
    "groupBy": "trigger_type",
    "aggregate": { "fn": "count" },
    "limit": 20
  },
  "display": { "xAxis": "key", "yAxis": "value" }
}
```

#### 3. Reminder dispatches over time (line, 30 days)

```json
{
  "name": "Reminder dispatches (30 days)",
  "type": "line",
  "x": 0, "y": 15, "width": 12, "height": 5,
  "operation_type": "time_series",
  "operation_options": {
    "entity": "notification",
    "filters": { "channel": "whatsapp", "resource_type": "production_run" },
    "dateField": "created_at",
    "precision": "day",
    "range": { "last_days": 30 },
    "aggregate": { "fn": "count" }
  },
  "display": { "xAxis": "date", "yAxis": "value" }
}
```

POST each to `/admin/stats/dashboards/<dashboard_id>/panels`. Dry-run any of them first against `/admin/stats/panels/preview` to validate without persisting.

### Direct SQL (for ad-hoc reporting)

```sql
-- All cancellations via WhatsApp in the last 7 days
SELECT created_at,
       resource_id AS run_id,
       data->>'admin_name' AS admin
FROM notification
WHERE trigger_type = 'whatsapp_admin.run_cancelled'
  AND created_at > now() - interval '7 days'
ORDER BY created_at DESC;

-- Reminder dispatch volume per template, last month
SELECT template, count(*) AS sends
FROM notification
WHERE channel = 'whatsapp'
  AND trigger_type LIKE 'production_run.reminder_%'
  AND created_at > now() - interval '30 days'
GROUP BY template
ORDER BY sends DESC;

-- Cross-store reconciliation: notification rows missing a wamid
SELECT id, trigger_type, resource_id, created_at
FROM notification
WHERE channel = 'whatsapp'
  AND (external_id IS NULL OR external_id LIKE 'wa-audit-%');
```

## Operational properties

### Failures are best-effort

- The WhatsApp send **always** completes regardless of the audit write. The helper wraps `createNotifications` in `try/catch` and logs warnings — it never throws back into `sendRequest`.
- If the notification module is misconfigured (provider not registered for the channel), the send still succeeds; you'll see `[whatsapp-audit] notification create failed` warnings in logs.
- Reconciliation: every successful send also writes a `messaging_message` row. If the notification row is missing, you can backfill from `messaging_message` (matching `wa_message_id` → `external_id`).

### Idempotency

Three idempotency-key shapes are conventional in this codebase:

| Use case | Key shape | Why |
|---|---|---|
| Transactional template (sent_to_partner, cancelled, completed) | `<context_type>:<context_id>` | One row per logical event |
| Reminder template (daily cadence) | `<run_id>:reminder:YYYY-MM-DD` | Same run reminded daily — calendar-day suffix lets each day's reminder write its own row |
| Image follow-up (after a template) | `<context_type>:<context_id>:image` | Image is a distinct send from the template body it follows |

Skipping the key entirely is fine — Medusa won't dedup, but each create produces one row. Pass it explicitly when you want the framework's idempotency semantics.

### `_already_sent` semantics

The audit provider's `send()` short-circuits when `data._already_sent: true` is present. If a caller invokes `notificationModuleService.createNotifications({ channel: "whatsapp", ... })` **without** the flag, the provider logs a warning and returns a synthesized id. **Never construct a `whatsapp` notification expecting the framework to deliver it** — that's not what this provider does. Use `WhatsAppService` instead.

### Status meaning

Notification rows always show `status: "success"` because the audit write happens **after** Meta accepted the message. That's "the WhatsApp send was accepted by Meta", not "the partner received it". Real delivery status (delivered → read → failed) lives on `messaging_message.status` and is updated by the inbound webhook over time. To answer "was this notification actually delivered?", join via `external_id ↔ wa_message_id`:

```sql
SELECT n.id, n.trigger_type, n.created_at, m.status AS delivery_status
FROM notification n
LEFT JOIN messaging_message m ON m.wa_message_id = n.external_id
WHERE n.channel = 'whatsapp'
  AND n.created_at > now() - interval '24 hours';
```

## What this enables next

- **Email reminders.** Same pattern, different channel — register an `email-audit` provider OR (preferred) call existing email providers normally with `resource_type` / `resource_id` set, and the same query patterns work across channels.
- **Cross-channel admin audit.** Every channel that flows through the Notification Module — WhatsApp, email, SMS — populates the same table. One query gives the complete outbound history per resource.
- **Anomaly alerts.** A scheduled visual flow can read recent notification counts (e.g. "all reminder dispatches in last 24h"), classify outliers, and emit a `notification.anomaly_detected` event picked up by the existing alert dispatcher.
- **Replays.** The `external_id` carries the wamid; combined with `messaging_message`, you can trace any send end-to-end without log grep.

## What this deliberately doesn't do

- **Doesn't replace `messaging_message`.** Inbound replies, button-tap routing, and status timeline updates stay there. The notification row is one-write at send time.
- **Doesn't cover scaffolding sends.** Help text, "Usage:" hints, list dumps, error replies — none of these get audited. Adding them adds 5× volume for zero recall value.
- **Doesn't track real-world delivery status.** That's `messaging_message`'s job. Notification rows are about "did our system attempt to send this and accept Meta's response", not "did the partner read it".
- **Doesn't auto-clean.** Notification rows are permanent unless deleted explicitly. If retention becomes a concern, schedule a soft-delete on rows older than N days.

## File index

| Path | Role |
|---|---|
| `src/modules/notification-whatsapp-audit/index.ts` | Audit provider module registration |
| `src/modules/notification-whatsapp-audit/service.ts` | `WhatsappAuditNotificationProviderService` — short-circuit logic |
| `src/modules/messaging/lib/record-whatsapp-notification.ts` | Helper that creates the notification row from an audit context |
| `src/modules/social-provider/whatsapp-service.ts` | Adds `WhatsAppAuditContext` type + threads `audit` through every leaf send method to `sendRequest` |
| `src/modules/visual_flows/operations/send-whatsapp.ts` | Builds audit per mode; passes to leaf method |
| `src/workflows/whatsapp/whatsapp-message-handler.ts` | Wrapper attaches default audit to every send |
| `src/workflows/whatsapp/whatsapp-admin-handler.ts` | 6 action-confirmation call sites with explicit per-action audit |
| `medusa-config.ts` / `.dev.ts` / `.prod.ts` | Registers `whatsapp-audit` provider against the `whatsapp` channel |

## See also

- [Notification Module Tradeoffs](./notification-module-tradeoffs.md) — design rationale for the secondary-store approach
- [Partner WhatsApp — Production Run Flow](./whatsapp-partner-run-flow.md) — outbound flow that originated this audit work
- [Production Run Reminders](./production-run-reminders.md) — scheduled reminders that produce most reminder audit rows
