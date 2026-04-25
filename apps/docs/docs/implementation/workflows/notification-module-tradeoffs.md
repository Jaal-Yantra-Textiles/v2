---
title: "Notification Module vs. our messaging + activity stack — research"
sidebar_label: "Notification Module Tradeoffs"
sidebar_position: 12
---

# Notification Module vs. our messaging + activity stack — research

> **Status:** research draft. Open question: should outbound partner communications flow through the Medusa Notification Module (with WhatsApp implemented as a Notification Module Provider), or should we keep the current dedicated `messaging` module + the new `production_run_activity` log? This doc surveys both shapes and recommends a hybrid.

## Setting

We currently have **three** semi-overlapping persistence stores for partner-facing comms and run history:

| Module | Owner of | Today |
|---|---|---|
| `messaging` (custom) | Conversation graph: every inbound + outbound WhatsApp message, status callbacks (delivered/read), partner phone identity, button-tap mapping | Active. Source of truth for two-way WhatsApp |
| `production_run_activity` (new — see [Production Run Reminders](./production-run-reminders.md#activity-log--first-class-not-metadata)) | Run timeline: lifecycle transitions + reminder dispatches as first-class rows | Active. Written by `production-run-activity-recorder` subscriber |
| `@medusajs/medusa/notification` (Medusa core) | Outbound notifications across channels (email today, SMS/WhatsApp possible) | Configured in `medusa-config.ts:137` with the `local` provider only — used for blog-subscriber email and design-promoted-to-product email. **Not** wired to WhatsApp. |

The question: should outbound WhatsApp move under the Notification Module umbrella, with the WhatsApp send implemented as a custom Notification Module Provider? And if so, what becomes of the messaging module and the activity log?

## What the Notification Module gives us

Every `notificationModuleService.createNotifications(...)` call **persists a row** to the `notification` table and **dispatches** to a registered provider's `send()` method. Storage shape (from the AdminNotification type):

```
notification {
  id                        text PK
  to                        text          recipient (email / phone / username)
  channel                   text          "email" | "sms" | "whatsapp" | …
  template                  text          provider-side template id
  data                      jsonb         template variables
  trigger_type              text          event/workflow name that fired this
  resource_type             text          "order" | "production_run" | …
  resource_id               text
  receiver_id               text          user/customer/partner id
  provider_id               text          which provider handled the send
  status                    text          "pending" | "success" | "failure"
  external_id               text          provider's id (e.g. Meta wamid)
  original_notification_id  text          for retries
  idempotency_key           text          dedup at create-time
  attachments               jsonb         array of {url, content, content_type}
  sender                    text          optional from-address
  created_at                timestamptz
}
```

Notable wins:
- **`trigger_type` + `resource_type` + `resource_id`** — exactly the shape we built into `production_run_activity`. The notification table already covers it.
- **`idempotency_key`** — first-class dedup, no need for the per-day `<run_id>:reminder:YYYY-MM-DD` `context_id` trick.
- **`status` + `external_id`** — built-in delivery tracking.
- **`provider_id`** — channel routing (multi-WABA + email + SMS coexist cleanly).
- **Free admin API** at `GET /admin/notifications` and `GET /admin/notifications/:id`.
- **`sendNotificationsStep`** — drop-in workflow step that integrates with workflow compensation.

The Provider interface (from [Create a Notification Module Provider](https://docs.medusajs.com/resources/references/notification-provider-module)):

```ts
class WhatsappProviderService extends AbstractNotificationProviderService {
  static identifier = "whatsapp"

  async send(
    notification: ProviderSendNotificationDTO
  ): Promise<ProviderSendNotificationResultsDTO> {
    // notification.to, notification.template, notification.data, …
    // call into our existing send infra
    return { id: wamid }
  }
}
```

Registered in `medusa-config.ts` alongside `notification-local`.

## What we'd lose by collapsing into Notification Module

The notification model is **one-way, send-only**. The messaging module models a **two-way conversation graph** that the notification model deliberately doesn't:

| Concern | Notification module | Our messaging module |
|---|---|---|
| Outbound message | ✓ (one row per send) | ✓ |
| Inbound message (partner reply) | ✗ | ✓ — webhook writes a row, button-tap maps to action |
| Conversation thread / message history per partner | ✗ — flat list | ✓ — `conversation` parent, `message.direction` |
| Delivery-status callbacks (delivered → read → failed) | `status` is single-valued | ✓ — status updates over time, webhook-driven |
| `wa_message_id` correlation for status updates | `external_id` (one-shot at create) | ✓ — indexed, used by status webhook |
| Button-tap routing (`BUTTON_TITLE_ACTIONS`) | ✗ | ✓ — action map keyed off conversation context |
| Attachments | ✓ but flat array — fine for one image, awkward for an inbound media archive | ✓ — `media_url`/`media_mime_type` on each message |
| Provider `send()` argument shape | `{ to, template, data, channel }` — narrower | Our `send_whatsapp` op takes `mode (template/text/image), partner_id, dedup_window, require_partner, image_url, caption, skip_if_no_image, context_type, context_id` — wider |

Specifically, the existing wildcard flow's `send_image` follow-up (design thumbnail + portal deep-link as a second WhatsApp message after the template) — that's a sequence of two distinct outbound messages with linked context. The notification model can do this as two `createNotifications` calls but loses the natural conversation grouping.

**Verdict so far:** the notification module is the right home for **send semantics + audit trail**, but the wrong home for **conversation modeling**.

## What about `production_run_activity`?

Three categories of rows it carries today:
1. **Lifecycle events** — `sent_to_partner`, `accepted`, `started`, `finished`, `completed`, `cancelled`. These are state transitions, not messages. They have nothing to do with notifications conceptually — even if a WhatsApp template happens to be sent on top.
2. **Reminder dispatches** — `assignment_pending`, `not_started`, `idle`. These ARE notifications, semantically.
3. **Future** — admin notes, comments, system markers (no associated message).

Rows of type (2) overlap heavily with notification-module rows. (1) and (3) don't.

## Recommended target architecture (hybrid)

```
┌─────────────────────────────────────────────────────────────────┐
│  Outbound channel: WhatsApp / email / SMS / in-app              │
│                                                                 │
│  Caller →  notificationModuleService.createNotifications({      │
│              channel: "whatsapp",                               │
│              to: "+91...",                                      │
│              template: "jyt_production_run_reminder_pending_v1",│
│              resource_type: "production_run",                   │
│              resource_id: "prod_run_…",                         │
│              receiver_id: "partner_…",                          │
│              trigger_type: "production_run.reminder_assignment_pending",│
│              idempotency_key: "<run_id>:reminder:2026-04-25",   │
│              data: { partner_name, design_name, days, … },      │
│           })                                                    │
│         ↓                                                       │
│  notification table — row persisted (status="pending")          │
│         ↓                                                       │
│  WhatsappProviderService.send(notification)                     │
│     → reuses today's send-whatsapp infra (multi-WABA routing,   │
│       template var building, partner phone resolution)          │
│     → writes a messaging_message row (conversation graph)       │
│     → returns { id: wamid } → notification.external_id, status  │
│                                                                 │
│  Status webhook                                                 │
│     → updates messaging_message.status (delivered/read/failed)  │
│     → optionally syncs notification.status via wamid join       │
└─────────────────────────────────────────────────────────────────┘
                            ▲
                            │
                            │ inbound (button taps, replies)
                            │
┌─────────────────────────────────────────────────────────────────┐
│  Inbound webhook: ONLY messaging module                         │
│  Notification module is not involved.                           │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  production_run_activity                                        │
│  Keeps lifecycle_event + note + system rows ONLY.               │
│  reminder_sent rows MOVE to notification table                  │
│  (queryable as: resource_type='production_run' +                │
│   trigger_type LIKE 'production_run.reminder_%')                │
└─────────────────────────────────────────────────────────────────┘
```

Three modules, three clear responsibilities:

1. **Notification Module** — outbound send semantics + audit. One row per send attempt. Pluggable provider per channel.
2. **Messaging Module** — conversation graph (inbound + outbound + status timeline + webhook ids). Unchanged.
3. **`production_run_activity`** — domain timeline (state transitions, notes, system events). Trims to non-message activity.

The run timeline UI becomes a **union query**:

```sql
-- lifecycle + notes + system, from the activity table
SELECT 'activity' AS source, kind, summary, occurred_at, payload
FROM production_run_activity
WHERE production_run_id = $1 AND deleted_at IS NULL
UNION ALL
-- outbound communications, from the notification table
SELECT 'notification' AS source, trigger_type, template, created_at AS occurred_at, data
FROM notification
WHERE resource_type = 'production_run' AND resource_id = $1
ORDER BY occurred_at DESC;
```

## Tradeoffs

### Pro — moving outbound to Notification Module
- **Free admin UI** at `GET /admin/notifications` for ops + support.
- **Multi-channel ready.** Email reminders, SMS reminders — same code path, different `channel` value, different provider.
- **Idempotency** as a first-class field. Drops our per-day `context_id` hack — replace with `idempotency_key`.
- **Retries / status visibility** built in. Today our `messaging_message` has `status` but it's WhatsApp-specific.
- **Workflow integration.** `sendNotificationsStep` plays nicely with workflow compensation; today we hand-roll dedup in `send_whatsapp`.
- **Removes the `reminder_sent` row category from `production_run_activity`** — that table simplifies to lifecycle + notes only, more cohesive.

### Con — moving outbound to Notification Module
- **Build cost.** WhatsApp Notification Provider needs to wrap the existing send infra without losing image-mode, dedup-window, partner-validation, multi-WABA routing. Estimate: 1-2 days for the provider + maybe 1 day to migrate the visual-flow `send_whatsapp` operation to delegate.
- **Two-write coupling.** Provider's `send()` writes both notification (via the framework) and `messaging_message` (manually). Failure modes: notification persists but messaging_message write fails → partial state. Mitigation: write `messaging_message` first, then notification with the wamid in `external_id`; or wrap both writes in a transaction.
- **Re-implementation surface.** `send_whatsapp` operation has knobs (`mode: image`, `skip_if_no_image`, `caption`, `image_url`) that don't map cleanly to `ProviderSendNotificationDTO`. They'd ride in `data` but lose IDE-time type checks.
- **Visual-flow integration churn.** The flow node's options panel surfaces those knobs today. If we change the underlying call to `notificationModuleService.createNotifications`, the options might reshuffle.
- **Replay semantics differ.** Today re-running a flow execution either dedups (60-min window on `context_id`) or sends fresh. Notification's idempotency_key is stricter — same key returns the existing row. Need to design re-send semantics if ops want manual "send again" buttons.

### Con — keeping the status quo (do nothing)
- Three persistence layers stay overlapping. Reminder rows are written **once per emission** to `production_run_activity`, but the actual WhatsApp send writes a separate row in `messaging_message`. Correlating them requires the per-day `context_id` heuristic.
- Email reminders (Phase 5+ in the [reminder doc](./production-run-reminders.md#known-gaps--future-work) tier) would either spawn another module or stuff into `messaging_message` (which is WhatsApp-specific).
- No free admin UI for "what comms went to this partner across channels".
- The bookkeeping in `send_whatsapp` (dedup window, partner_id validation, context_id) is reinvented per channel if we go multi-channel.

## Recommendation

**Adopt the hybrid in two phases. Don't do it all at once.**

### Phase 1 — Notification Provider for WhatsApp (low-risk wedge)
1. Build a `whatsapp` Notification Module Provider (`src/modules/notification-whatsapp/`) that internally calls the existing send-WhatsApp helpers. **Do not** rewire the visual-flow `send_whatsapp` operation yet — keep it talking to messaging directly. The provider is purely additive.
2. Migrate **one** caller as a pilot: change the `production-run-activity-recorder` subscriber to ALSO write a `notification` row with `channel="whatsapp"`, `resource_type="production_run"`, `idempotency_key=<run_id>:<event_suffix>:<date>` whenever it sees a reminder event. Provider's `send()` is a no-op at this stage (returns `{ id: "no-op" }`); we're just dual-writing to evaluate the schema fit.
3. Verify the notification table captures everything the activity table does + the messaging_message table does. Find what's missing, iterate.

### Phase 2 — Switch over (after Phase 1 validates)
1. Promote the WhatsApp provider's `send()` from no-op to actually call our send infra. Visual-flow `send_whatsapp` continues to work against messaging directly — but new code paths (subscribers, scheduled jobs) call `notificationModuleService.createNotifications` instead.
2. Drop `reminder_sent` rows from `production_run_activity` — query notifications instead. The `production-run-activity-recorder` subscriber stops writing reminder rows; lifecycle + note rows stay.
3. Update the admin API at `GET /admin/production-runs/:id/activities` to UNION the activity table with the notifications scoped to the run.
4. Long-term: migrate the visual-flow `send_whatsapp` operation to call notificationModuleService too, so visual-flow-driven sends also flow through the unified pipeline. **This is the riskiest step** — defer until the rest is proven.

### Don't do
- **Don't** absorb the messaging module into notifications. Two-way conversation modeling is a real need that notifications don't solve.
- **Don't** delete `production_run_activity`. It still owns lifecycle + notes + system rows. The reminder rows graduate to notifications; everything else stays.
- **Don't** flip the visual-flow `send_whatsapp` operation in Phase 1 — that's the riskiest single change because it's used by every existing partner notification flow.

## Open questions

- **Receiver_id semantics for partners.** The notification model's `receiver_id` is documented as a customer/user id. We'd reuse it for `partner_id` — semantically slightly off but pragmatically fine. Consider whether to override the meaning or add a `partner_id` column via a custom subentity.
- **Idempotency window vs. per-day reminder cadence.** Today the seed sets `context_id = "<run_id>:reminder:YYYY-MM-DD"` so daily reminders aren't deduped against each other. With idempotency_key, we'd use the same per-day suffix — works the same way, but we should document that the key is **calendar-day-scoped, not run-scoped**, or new operators will assume "one reminder per run forever".
- **Inbound reply attribution to a notification.** When a partner replies to a reminder template via WhatsApp, the inbound webhook writes a `messaging_message` row. Should we also annotate the original `notification` with `replied_at`? That's a small custom column on a subentity, or a join table. Useful for "did this reminder actually convert to action?" analytics.
- **Backfill story.** Existing `messaging_message` rows wouldn't backfill into notifications. If ops needs unified "all communications" history pre-cutover, write a one-time backfill script that reads messaging_message and creates notification rows for every outbound send.

## Reference

- [Notification Module — Medusa docs](https://docs.medusajs.com/resources/infrastructure-modules/notification)
- [Create a Notification Module Provider — Medusa docs](https://docs.medusajs.com/resources/references/notification-provider-module)
- [`sendNotificationsStep` reference](https://docs.medusajs.com/resources/references/medusa-workflows/steps/sendNotificationsStep)
- Internal: [Production Run Reminders](./production-run-reminders.md), [Partner WhatsApp — Production Run Flow](./whatsapp-partner-run-flow.md)
- Code: `medusa-config.ts:137` (notification module config), `src/modules/messaging/models/message.ts` (messaging module schema), `src/modules/production_runs/models/production-run-activity.ts` (activity log)
