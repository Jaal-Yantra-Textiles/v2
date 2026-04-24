---
title: "Production Run Reminders — Daily Discoverer"
sidebar_label: "Production Run Reminders"
sidebar_position: 11
---

# Production Run Reminders — Daily Discoverer

Sister flow to [Partner WhatsApp — Production Run Flow](./whatsapp-partner-run-flow.md). The transactional flow only fires on lifecycle events (assigned / cancelled / completed). This doc covers the **scheduled daily reminder** that nudges partners on production runs that have stalled.

## Why this exists

The transactional flow handles the happy path: when a run is sent to a partner, they get a WhatsApp template, tap Accept, work it, and complete. In practice runs sit in three stuck states:

| Bucket | Condition | Why it stalls |
|---|---|---|
| `assignment_pending` | `status='sent_to_partner'` AND `accepted_at IS NULL` AND `created_at < now − 24h` | Partner saw the message but never tapped Accept |
| `not_started` | `accepted_at IS NOT NULL` AND `started_at IS NULL` AND `accepted_at < now − 24h` | Partner accepted but never tapped Start in the portal |
| `idle` | `status='in_progress'` AND `started_at < now − 72h` | Run is in progress, no produced-quantity update for days |

Without an automated nudge, ops manually chase partners by phone. This flow does the chasing on a fixed weekday cadence and reuses the existing wildcard WhatsApp dispatcher to send the message.

## System Overview

```
                      ┌─────────────────────────────────────┐
                      │ Cron: 30 4 * * 1-5 (10:00 IST M-F)  │
                      └─────────────────┬───────────────────┘
                                        ▼
┌──────────────────────────────────────────────────────────────────┐
│ NEW scheduled visual flow                                        │
│ "Production Run Reminders — Daily Discoverer"                    │
│                                                                  │
│   read_active_runs   read_data                                   │
│        ↓             { status: { $in: [sent_to_partner,          │
│                                       in_progress] } }, limit 500│
│   classify           execute_code                                │
│        ↓             buckets rows into 3 reminder kinds          │
│                      drops rows missing partner_id               │
│   dispatch           bulk_trigger_workflow                       │
│        ↓             workflow_name = emit-production-run-reminder│
│   log_summary        log                                         │
└─────────────────┬────────────────────────────────────────────────┘
                  │ once per overdue run
                  ▼
┌──────────────────────────────────────────────────────────────────┐
│ NEW Medusa workflow `emit-production-run-reminder`               │
│ Single step:                                                     │
│   eventBus.emit({                                                │
│     name: "production_run.reminder_<kind>",                      │
│     data: { production_run_id, partner_id, design_id,            │
│             reminder_kind }                                      │
│   })                                                             │
└─────────────────┬────────────────────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────────────────────┐
│ EXISTING wildcard flow                                           │
│ "Partner WhatsApp — Production Run (all events)"                 │
│ trigger_config.event_pattern: "production_run.*"                 │
│                                                                  │
│   read_run → read_partner → read_design                          │
│   → resolve_template (extended map adds the 3 reminder events)   │
│   → has_template → send_whatsapp (template)                      │
│                  → gen_link → send_image                         │
└─────────────────┬────────────────────────────────────────────────┘
                  ▼
          Partner's WhatsApp
```

The reminder flow does not send any messages itself. It only **discovers stuck runs** and **emits events**. The existing wildcard dispatcher does the actual WhatsApp send. Same `send_whatsapp` operation, same dedup story, same partner phone resolution, same deep-link generation — we just add three new event→template mappings to its existing transform node.

## Key Components

| Role | File |
|---|---|
| Scheduled discoverer seed | `src/scripts/seed-production-run-reminders-flow.ts` |
| Per-run event emitter workflow | `src/workflows/production-runs/emit-production-run-reminder.ts` |
| Existing wildcard dispatcher (extended) | `src/scripts/seed-partner-run-whatsapp-flow.ts` |
| Event → flow subscriber (registers new event names) | `src/subscribers/visual-flow-event-trigger.ts` |
| Cron evaluator | `src/jobs/run-scheduled-visual-flows.ts` |
| Bulk dispatch operation | `src/modules/visual_flows/operations/bulk-trigger-workflow.ts` |

## What Was Added This Iteration

### 1. New scheduled flow seed
`src/scripts/seed-production-run-reminders-flow.ts` creates an idempotent visual flow with `trigger_type: "schedule"` and `trigger_config.cron: "30 4 * * 1-5"`. Four operations chained linearly:

1. **`read_active_runs`** (`read_data`) — single query with `{ status: { $in: ["sent_to_partner", "in_progress"] } }`, limit 500. Pulls the columns needed for bucketing: `id, partner_id, design_id, status, accepted_at, started_at, finished_at, created_at, updated_at, produced_quantity, quantity`.
2. **`classify`** (`execute_code`) — pure JS that walks the rows, drops anything without a `partner_id`, and buckets each remaining row into one of `assignment_pending` / `not_started` / `idle`. Returns `{ items: [...], counts: {...}, total_inspected: N }`.
3. **`dispatch`** (`bulk_trigger_workflow`) — calls `emit-production-run-reminder` once per item in `classify.items`. `max_items: 500` (matches the read limit), `continue_on_error: true` so a single bad row doesn't stop the rest.
4. **`log_summary`** (`log`) — single info-level line with all the counts and dispatch result.

The flow is created with `status: "draft"` — operators flip it to active in the admin UI once the templates are approved (see Activation Gate below).

### 2. New event-emitter workflow
`src/workflows/production-runs/emit-production-run-reminder.ts` registers a Medusa workflow named `"emit-production-run-reminder"`. Single step that maps `reminder_kind` → event name and emits via `Modules.EVENT_BUS`. No DB writes. No reads. No retries. The event payload deliberately mirrors the shape of `production_run.sent_to_partner` so the existing wildcard flow's `read_run`/`read_partner`/`read_design` filters work unchanged:

```ts
{
  production_run_id: string,
  partner_id: string,
  design_id: string | null,
  reminder_kind: "assignment_pending" | "not_started" | "idle",
}
```

### 3. Three new event→template mappings on the existing wildcard flow
`src/scripts/seed-partner-run-whatsapp-flow.ts` was extended in the `RESOLVE_TEMPLATE_CODE` node:

| Event | Template | Variables |
|---|---|---|
| `production_run.reminder_assignment_pending` | `jyt_production_run_reminder_pending_v1` | `[partnerName, designName, runId, daysSinceAssignment]` |
| `production_run.reminder_not_started` | `jyt_production_run_reminder_not_started_v1` | `[partnerName, designName, runId, daysSinceAccepted]` |
| `production_run.reminder_idle` | `jyt_production_run_reminder_idle_v1` | `[partnerName, designName, runId, producedQty, quantity]` |

Day-age helpers (`daysSinceAssignment`, `daysSinceAccepted`, `daysSinceStarted`) are derived inline from the run's timestamps so the message body reads "2 days ago" rather than a raw ISO string.

### 4. Per-day dedup `context_id` for reminder events
`send_whatsapp` dedups on `(context_type, context_id)` for 60 minutes by default. With the standard `context_id = run_id`, the second day's reminder would still fall inside that window only if it fired within an hour of the first — but since reminders fire at the same time of day, the more important property is that **today's reminder must be allowed to land even though yesterday's reminder used the same run_id**. The existing 60-minute window is fine for that. What we *do* need is to keep same-day retries (subscriber crash + Bus replay, etc.) deduplicated.

The fix: for reminder events only, `resolve_template` returns `context_id = "<runId>:reminder:<YYYY-MM-DD>"`. Same-day retries dedup; next-day reminders carry a fresh suffix and are not blocked.

### 5. Separate `run_id` field on `resolve_template`
With `context_id` carrying a per-day suffix, downstream nodes that *display* the run id needed a clean copy:
- `gen_link.run_id` → uses `resolve_template.run_id` (the raw run id, not the suffixed `context_id`). The deep-link JWT must encode the actual run id or the partner portal won't resolve it.
- `send_image.caption` → uses `resolve_template.run_id` so partners see "Run prod_run_…" rather than "Run prod_run_…:reminder:2026-04-25".

### 6. Three new event names registered with the visual-flow subscriber
`src/subscribers/visual-flow-event-trigger.ts` was extended to subscribe to `production_run.reminder_assignment_pending`, `.reminder_not_started`, `.reminder_idle`. Without this, the eventBus wouldn't deliver the new events to the visual-flow trigger machinery — even though the existing flow's `event_pattern: "production_run.*"` would otherwise match.

## Cron timing — read this before activating

The repo's cron evaluator (`src/jobs/run-scheduled-visual-flows.ts:82-103`) uses `date.getMinutes()` and `date.getHours()` — that is, **the container's local time**, not UTC. The seed script uses `30 4 * * 1-5`, which is 10:00 IST Mon-Fri **only if the container runs in UTC**.

Before flipping the flow to active:

```bash
railway run --service medusa-server -- date
# Expect: Sat Apr 25 14:30:00 UTC 2026  (or similar UTC stamp)
```

If the container runs in IST, edit the flow in the admin UI and change the cron to `0 10 * * 1-5`.

## Activation Gate

1. **Templates approved on every WABA.** Three new templates:
   - `jyt_production_run_reminder_pending_v1` (4 vars)
   - `jyt_production_run_reminder_not_started_v1` (4 vars)
   - `jyt_production_run_reminder_idle_v1` (5 vars)

   Check status:
   ```bash
   MODE=dry-run npx medusa exec ./src/scripts/manage-whatsapp-templates.ts
   ```

2. **Existing wildcard flow re-seeded** so the new template mappings are live in DB. The seed refuses to overwrite — rename the existing flow to `… [OLD]` first (preserves execution history) and re-run:
   ```bash
   npx medusa exec ./src/scripts/seed-partner-run-whatsapp-flow.ts
   ```

3. **New scheduled flow created.**
   ```bash
   npx medusa exec ./src/scripts/seed-production-run-reminders-flow.ts
   ```

4. **Container TZ confirmed** (see above).

5. **Both flows flipped draft → active** in the admin UI.

## Production Test Playbook

Reminders chase real partners. **Do not flip the new flow to active before testing.** Run the steps below against the production DB with the flow still in `draft` and the dispatch wired up so you can observe end-to-end behavior without spamming partners.

### Step 1 — Sanity-check the reads in isolation

Pick a known stuck run from prod. Then synthesize a run of just the read step using the admin replay endpoint, against a freshly seeded reminder flow in `draft`:

```bash
# Get the new flow id
curl -s "$BACKEND/admin/visual-flows?name=Production+Run+Reminders+%E2%80%94+Daily+Discoverer" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r '.flows[0].id'
# → vflow_…

# Manually execute it once (Run Now in the admin UI, or POST to /execute with empty body)
curl -X POST "$BACKEND/admin/visual-flows/<flow_id>/execute" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Inspect the latest execution in the admin UI:
- `read_active_runs.count` should match the number of rows in
  ```sql
  SELECT count(*) FROM production_run
  WHERE status IN ('sent_to_partner', 'in_progress');
  ```
- `classify.counts` should sum to (or be less than) that count. The delta is `skipped_no_partner + skipped_not_overdue`.
- `classify.items` should contain only rows older than the bucket thresholds. Spot-check 2-3 against the DB.

If these match, the discovery half works.

### Step 2 — Dry-run dispatch

Because the new wildcard mappings might still be missing in DB (you haven't re-seeded yet), the events fire but the existing flow hits the `no_template_for_event` skip branch and sends nothing. Use this to your advantage:

1. Make sure the existing wildcard flow has **not** yet been re-seeded with the reminder mappings.
2. Re-run the scheduled flow as in Step 1.
3. Confirm:
   - `dispatch.triggered` equals `classify.items.length`
   - `dispatch.failed` is 0
   - For each emitted event there's a matching execution on the existing wildcard flow (admin UI, filter by `triggered_by LIKE 'event:production_run.reminder_%'`)
   - Each of those wildcard executions terminates at the `log_skip` node with reason `no_template_for_event`
   - `messaging_message` table has **no new rows** from these executions

This proves: dispatch wires correctly, the events route to the existing flow, the flow correctly skips when no template is configured, and most importantly **no WhatsApp messages were sent**. You've now verified everything except the actual send.

### Step 3 — Smoke-test one real send to an internal partner

Pick (or create) a partner record whose `whatsapp_number` belongs to someone on the engineering team — not a real customer. Make sure that partner has a stuck run in one bucket, e.g. `status='sent_to_partner'`, `accepted_at IS NULL`, `created_at = now() − 2 days`.

Re-seed the existing wildcard flow with the new template mappings:

```bash
# In admin UI: rename "Partner WhatsApp — Production Run (all events)"
#   to "… [OLD]" and set status=draft.
npx medusa exec ./src/scripts/seed-partner-run-whatsapp-flow.ts
# Flip the new flow to active in the admin UI.
```

Now manually run the scheduled discoverer once via the admin UI (Run Now, or `POST /admin/visual-flows/<id>/execute`). Watch:

1. The internal partner should receive **one** template WhatsApp followed by the design image. The template body should reference the design name and the day-count.
2. Tap the deep-link button. The partner portal should authenticate without a password (24h JWT verified at `/partners/wa-auth`).
3. In `messaging_message`, find the row with `context_type='production_run'`, `context_id='<run_id>:reminder:YYYY-MM-DD'`. Confirm the template name on the row matches the bucket (e.g. `jyt_production_run_reminder_pending_v1`).
4. Re-run the discoverer **immediately** (within the 60-min dedup window). The internal partner should **not** receive a duplicate. The new wildcard execution should still log a `messaging_message` row, but the WhatsApp dispatch should be skipped — confirm the `meta_message_id` is null and the row carries the dedup marker.
5. Roll the system clock forward by a day (or wait a day) and re-run. The dedup `context_id` now has a different date suffix. The internal partner **should** receive a fresh reminder. This is the per-day resend property — confirm it works before letting the cron own it.

### Step 4 — Activate

If steps 1-3 pass:

1. Confirm container TZ matches the cron (see "Cron timing" above).
2. Verify all three templates show `APPROVED` on every target WABA (`MODE=dry-run npx medusa exec ./src/scripts/manage-whatsapp-templates.ts`).
3. Flip the scheduled discoverer to `active` in the admin UI.
4. The first cron tick at the next scheduled time will fire on real partners. Watch Railway logs for the first execution:
   ```bash
   railway logs --service medusa-server | grep "Reminder run —"
   ```
   You should see one log line per cron tick with the inspected/dispatched/failed counts.

### Step 5 — Monitor for 1-2 weeks

- Check `messaging_message` daily for rows whose `context_id` matches `%:reminder:%`. Count by template — anomalous spikes mean a bucket threshold is too aggressive.
- Watch Railway logs for `[bulk_trigger_workflow]` failure entries. These would mean the emit workflow itself is erroring (rare — only emits an event).
- Track partner replies. If the same partner hits the reminder for the same run for ≥7 consecutive days, ops should escalate manually — the reminder system is not a substitute for human intervention on chronic stalls.

## Rollback

If reminders cause partner complaints or send to the wrong people:

1. **Immediate:** flip the scheduled flow to `draft` in the admin UI. The cron won't fire it again. No code deploy needed.
2. **If the wildcard flow itself is the problem:** rename it back to `… [NEW]` and reactivate the previous `… [OLD]` flow you renamed during Step 3 above. Reverts the template mappings without code changes.
3. **Code rollback:** revert the four-file commit. Redeploy. The `emit-production-run-reminder` workflow remains registered but is unused; that's harmless. The three new event names also remain in the subscriber list; harmless.

## Known Gaps & Future Work

### Per-partner aggregation
A partner with five stuck runs gets five WhatsApp messages in one cron tick. Meta business policy and partner UX both prefer one digest message ("You have 3 runs awaiting acceptance, 1 not started, 1 idle"). The current `classify` step emits one item per run; rewriting it to group by `partner_id` and emitting one event per `(partner, bucket)` (with a payload listing the runs) would let us add a "digest" template family.

### Escalation cadence
Today every overdue run gets the same nudge every weekday until it moves on. A more humane policy would be day 1, day 3, day 7, then weekly. Implement by adding a `last_reminder_at` column on `production_run` (or a side table) and filtering rows whose previous reminder was less than the cadence threshold ago.

### Bucket thresholds in config
The 24h / 24h / 72h thresholds are hardcoded in the `classify` execute_code. Promoting them to flow operation options (or to env vars) would let ops tune them without re-seeding.

### Idle detection beyond `started_at`
The `idle` bucket only checks `started_at < now − 72h`. A partner who started two weeks ago and is reporting daily progress would still qualify. Better: check `updated_at` on the latest production-run-task or the latest `produced_quantity` change. Requires a join we don't currently make in the read step.

## File Index

| Path | Purpose |
|---|---|
| `src/workflows/production-runs/emit-production-run-reminder.ts` | **New** — single-step Medusa workflow that emits one of 3 reminder events |
| `src/scripts/seed-production-run-reminders-flow.ts` | **New** — idempotent seed creating the scheduled discoverer flow |
| `src/scripts/seed-partner-run-whatsapp-flow.ts` | Extended `RESOLVE_TEMPLATE_CODE` map with 3 reminder mappings; added per-day `context_id`; added separate `run_id` field for deep-links/captions |
| `src/subscribers/visual-flow-event-trigger.ts` | Registered 3 new event names (`production_run.reminder_*`) |
