---
title: "Visual Flows — Production Plan"
sidebar_label: "Production Plan"
sidebar_position: 8
---

# Visual Flows — Production Plan

Operational playbook for the visual-flow-driven partner WhatsApp
notification system, plus the backlog of next steps. Pick up here when
resuming the work.

---

## What's been built

**Backend features**
- `send_whatsapp` visual-flow operation with multi-number routing,
  partner-resolution guard, pinned-sender honoring, template/text modes,
  per-partner language resolution, context-based dedup, audit persistence
  (`src/modules/visual_flows/operations/send-whatsapp.ts`)
- Subscriber wildcard triggers — `event_pattern: "production_run.*"`, or
  `event_types: [...]` (`src/subscribers/visual-flow-event-trigger.ts`)
- Engine exposes real event name on `$trigger.event` even for
  wildcard-triggered flows (`src/modules/visual_flows/execution-engine.ts`)
- Partner decline endpoint `POST /partners/production-runs/:id/decline`
  with reason enum, started-at guard, event emission, task cascade
- WhatsApp inbound handler — `Decline` button + reason list, run-scoped
  media attach (button-driven + auto-match to single in-progress run),
  scrap/notes parsing on `finish`, localized template-button title map
- Template management script — `src/scripts/manage-whatsapp-templates.ts`
  with `dry-run` / `upsert` / `replace` / `cleanup` modes, per-platform
  language policy, encrypted-token reuse
- Single dispatcher flow seed — `src/scripts/seed-partner-run-whatsapp-flow.ts`
- Canonical template spec — `src/scripts/whatsapp-templates/partner-run-templates.ts`
  (currently on `_v3` suffix; bumpable via sed)
- Legacy `whatsapp-partner-notifications.ts` subscriber — gated behind
  `DISABLE_LEGACY_WHATSAPP_PARTNER_SUBSCRIBER=1`, but updated to read
  canonical template names from the spec so it degrades to "double-send"
  (fixable) rather than "no-send" (invisible) if the gate is forgotten
- Integration test spec for decline —
  `integration-tests/http/partners-decline-run.spec.ts`

**Meta state** (at time of writing, check before activating)
- `_v3` templates in various PENDING / APPROVED states; `_v2` names are
  locked for ~30 days post-delete
- 4 templates in spec: `jyt_partner_welcome_v1`, and the three run events
  (`_assigned_v3`, `_cancelled_v3`, `_completed_v3`)

---

## Activation checklist (one-time, in order)

1. **Approve all templates in Meta**
   ```bash
   MODE=upsert npx medusa exec ./src/scripts/manage-whatsapp-templates.ts
   ```
   Confirm status in the admin templates panel or:
   ```bash
   MODE=dry-run npx medusa exec ./src/scripts/manage-whatsapp-templates.ts
   ```

2. **Seed the dispatcher flow** (creates as draft)
   ```bash
   npx medusa exec ./src/scripts/seed-partner-run-whatsapp-flow.ts
   ```

3. **Set env flags + restart**
   ```
   DISABLE_LEGACY_WHATSAPP_PARTNER_SUBSCRIBER=1
   WHATSAPP_BUSINESS_NAME=JYT Textiles   # optional, defaults inline
   WHATSAPP_TEMPLATE_LANG=hi              # legacy fallback
   ```

4. **Smoke test**
   - Admin UI → partners → "Connect on WhatsApp" with a test number →
     expect `jyt_partner_welcome_v1` arrives
   - Reply → expect consent buttons (free-form)
   - Tap Agree → expect language buttons
   - Tap English or हिंदी → expect welcome + commands
   - Send a production run to the test partner → expect
     `jyt_production_run_assigned_v3` with Accept/Decline/View buttons
   - Tap Decline → reason list → pick one → run is cancelled, receipt
     template fires

5. **Flip flow status: draft → active** in the admin.

6. **Post-delete cleanup** (once stable for a week, optional)
   ```bash
   MODE=cleanup CONFIRM_REPLACE=1 npx medusa exec ./src/scripts/manage-whatsapp-templates.ts
   ```
   Removes legacy non-suffixed templates. Keep `_v3` as canonical
   until the next structural change forces a `_v4`.

---

## Day-2 operations

**Editing in production without redeploy**
- Change template → variable mapping or event wiring: open the flow in
  admin → edit the `resolve_template` `execute_code` node → save
- Add a new event → template mapping: edit the same `execute_code` map
- Pause during an incident: set flow status to `draft` (events stop
  firing it; legacy subscriber stays off unless env flag is unset)

**Requires a code change + restart**
- New template (body text, variables, buttons): edit
  `src/scripts/whatsapp-templates/partner-run-templates.ts`, run
  `MODE=upsert`, then wait for Meta approval before activating
- Changing the inbound handler logic (new button, new text command)

**Monitoring**
- `visual_flow_execution` + `visual_flow_execution_log` rows carry full
  per-step input / output / error / duration
- Admin UI → flow detail page → executions tab
- Terminal: `FLOW_ID=<id> npx medusa exec ./src/scripts/inspect-visual-flow.ts`
- `messaging_message` rows with `context_type = 'production_run'` are
  the audit trail of every outbound WhatsApp

---

## Backlog — next steps

These are the four things proposed at the end of the last session.
Pick up in any order.

### (a) Second dispatcher flow for a non-WhatsApp use case

Prove pattern portability — e.g. order confirmation emails triggered by
`order.placed`. Same shape: event → read data → transform → send_email.
Would confirm the subscriber + engine changes work for email flows too.

### (b) Operational tooling

- Scheduled cleanup of old `visual_flow_execution` + log rows (DB bloat
  prevention). 30-day retention by default.
- Failure alerting — emit `visual_flow.execution.failed` event, or poll
  `WHERE status='failure'` and surface on an admin dashboard.
- Minimal dashboard: executions-per-flow, success rate, recent failures,
  with drill-down to logs.

### (c) Finish the `schedule` trigger

Currently partial. Wiring it up unlocks cron-style flows:
- Overdue-run reminders (daily cron → find runs past ETA → send template)
- Weekly partner summary templates
- Housekeeping (cache warmers, data syncs)

Subscriber would need a scheduler integration (e.g. BullMQ + `@nestjs/schedule`).

### (d) Flow-authoring conventions for the team

Short guide covering:
- When to create a new flow vs extend an existing one
- Naming rules (`{domain}.{action}.{purpose}`)
- Dedup defaults on sends
- Node-splitting heuristics (one concern per node)
- Error-handling patterns (condition-based branching on `.success`)

---

## Known limits to plan around

| Limit | Impact | Mitigation direction |
|---|---|---|
| No step-level retry | Transient Meta 500 drops a message | `send_whatsapp` has 60-min dedup, re-fire the event to retry |
| No rate limiting on event fan-out | Bulk ops can storm the flow | Throttle at the event source; future: flow-level concurrency cap |
| Execution logs grow unbounded | DB bloat over months | Build cleanup job (backlog item b) |
| No built-in failure alerting | Silent rot | Emit failure events, wire to notification (b) |
| `schedule` trigger partial | No cron flows yet | Finish it (backlog item c) |

---

## Ready-state reminders

- All four canonical templates end in `_v3` right now. If you need to
  change structure (new variable, remove a button), bump to `_v4` in
  both the spec and `seed-partner-run-whatsapp-flow.ts` map, then run
  `MODE=upsert`.
- Button title map lives in `partner-run-templates.ts` — add both
  English and Hindi strings when adding a new button to a template.
- `send_whatsapp` will refuse to send to unknown recipients unless
  `require_partner: false` is set on the node. Default is `true` for
  partner-facing flows; flip it for admin alerts or test sends.
