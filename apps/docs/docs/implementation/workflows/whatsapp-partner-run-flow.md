---
title: "Partner WhatsApp — Production Run Flow"
sidebar_label: "WhatsApp Partner Run Flow"
sidebar_position: 10
---

# Partner WhatsApp — Production Run Flow

End-to-end overview of how production-run events reach partners via WhatsApp, the visual-flow that dispatches them, the webhook that ingests partner replies, and the hardening done in this iteration.

**Scope of this doc:** work done in the April 2026 hardening pass on visual flow `Partner WhatsApp — Production Run (all events)` (id: `vflow_01KPJJ6G6YDE6EY4FJCFCKQ1XA` in prod) plus the surrounding subscribers, webhook, and operation registry.

## System Overview

```
┌─────────────────────────────────┐
│ Production-run workflow         │
│ (send / accept / finish /       │
│  complete / cancel / decline)   │
└─────────────────┬───────────────┘
                  │ emits production_run.* event
                  ▼
┌─────────────────────────────────┐
│ visual-flow-event-trigger       │
│ subscriber                      │ ← matches active flows by event_pattern
└─────────────────┬───────────────┘
                  │
                  ▼
┌─────────────────────────────────┐
│ executeVisualFlowWorkflow       │
│  → read_run                     │
│  → read_partner                 │
│  → read_design                  │
│  → resolve_template (code)      │
│  → has_template (condition)     │
│  → send (template)              │ ← Meta-approved template (e.g. jyt_production_run_assigned_v3)
│  → gen_link (JWT)               │
│  → send_image (follow-up)       │ ← design image + no-login deep-link
└─────────────────────────────────┘
                  ▼
          Partner's WhatsApp
                  │
                  │ Accept / Decline / Start / Finish / Complete tap
                  ▼
┌─────────────────────────────────┐
│ /webhooks/social/whatsapp       │
│ → parseWebhookMessage           │
│ → handleIncomingMessage         │
│ → acceptProductionRunWorkflow   │
│   (or decline / start / etc.)   │
└─────────────────────────────────┘
```

## Key Components

| Role | File |
|---|---|
| Outbound event emitter | `src/workflows/production-runs/send-production-run-to-production.ts` (and siblings for accept/start/finish/complete) |
| Event → flow dispatcher | `src/subscribers/visual-flow-event-trigger.ts` |
| Flow execution workflow | `src/workflows/visual-flows/execute-visual-flow.ts` |
| Seed script for the flow | `src/scripts/seed-partner-run-whatsapp-flow.ts` |
| Webhook entry point | `src/api/webhooks/social/whatsapp/route.ts` |
| Partner message handler | `src/workflows/whatsapp/whatsapp-message-handler.ts` |
| Deep-link JWT helpers | `src/modules/social-provider/whatsapp-deeplink.ts` |
| Deep-link verification route | `src/api/partners/wa-auth/route.ts` |
| Visual-flow operations | `src/modules/visual_flows/operations/` |

## What Was Fixed This Iteration

### 1. Wrong entity names in the seeded flow
`read_run` used `entity: "production_run"`, `read_partner` used `"partners"` — the registered model names are `production_runs` and `partner`. The wrong `production_run` name returned empty datasets; `partners` worked by accident via Medusa's plural auto-resolution.

**Fix:** matched the seed's entity strings to `model.define()` names.

### 2. `design.id`/`design.name` nested fields on `read_run`
No module link exists between `production_runs` and `designs` (`src/links/` has no such link file), so `query.graph({entity: "production_runs", fields: ["design.name", ...]})` silently drops the nested fields.

**Fix:** removed the nested fields, added a dedicated `read_design` step that queries `entity: "design"` with the `design_id` from the trigger payload.

### 3. Filters chained through read results instead of the trigger payload
`read_partner` filtered by `{{ read_run.records[0].partner_id }}`. If any upstream step returned an unexpected shape, the filter evaluated to undefined and read_data fell back to returning the first row in the table (see #4 below).

**Fix:** every read now filters straight off `$trigger.payload.{production_run_id, partner_id, design_id}`. Reads no longer depend on each other's output.

### 4. `read_data` silently returned arbitrary rows on null filters
`src/modules/visual_flows/operations/read-data.ts` previously dropped filter keys whose interpolated value was null/undefined/"" and warned. With `limit: 1`, a dropped `id` filter meant the first row in the table came back — the downstream `send_whatsapp` would then deliver a template to an unrelated partner.

**Fix:** refuses to query when any filter key resolves to empty. Returns `{records: [], count: 0, warning: "..."}` instead. No more silent misdelivery.

### 5. `$trigger.event` was empty for wildcard event_pattern flows
`executeVisualFlowWorkflow` at `src/workflows/visual-flows/execute-visual-flow.ts:82` originally populated `$trigger.event` only from `flow.trigger_config.event`. Flows using `event_pattern: "production_run.*"` got an empty event name, so the `resolve_template` code couldn't discriminate between `sent_to_partner` / `cancelled` / `completed`.

**Fix:** fallback chain — `metadata.event_name` (passed by `visual-flow-event-trigger.ts`) → `trigger_config.event` → `trigger_config.event_type`.

### 6. Replays lost `event_name`
`POST /admin/visual-flows/:id/execute` with `replay_execution_id` only copied `trigger_data`, never `metadata.event_name`. Replays of wildcard-triggered flows ended up with empty `$trigger.event`.

**Fix:** replay branch at `src/api/admin/visual-flows/[id]/execute/route.ts:85` now selects `metadata` too and forwards `prev.metadata.event_name` to the new run (caller-supplied metadata still wins).

### 7. Template `send_whatsapp` delivered zero variables
Flow stored `"variables": "{{ resolve_template.variables }}"` as a string. The operation only ran `Array.isArray(options.variables)` (false for a string) and sent zero template params — Meta rejected with error code 132000: *"number of localizable_params (0) does not match the expected number of params (4)."*

**Fix:** runs `interpolateVariables()` first so a full-string `{{ }}` resolves to the actual array.

### 8. WhatsApp decline didn't cancel linked tasks
`handleDecline` in `src/workflows/whatsapp/whatsapp-message-handler.ts:742` duplicated the HTTP decline route's logic inline but skipped the task-cancel loop. Partners declining via WhatsApp saw the run move to `cancelled` but their task list still showed pending work.

**Fix:** added the same task-cancel loop the HTTP route uses. Future WhatsApp declines also cancel all linked non-terminal tasks.

### 9. Template button taps were dropped by the webhook
`parseWebhookMessage` handled `type: "interactive"` (button_reply, list_reply) but not `type: "button"` — Meta sends the latter for **template** quick-reply taps. All Accept/Decline taps on `jyt_production_run_assigned_v3` hit `default: Unsupported message type: button` and were discarded.

**Fix:** new `case "button":` normalizes the template-button shape (`msg.button.{payload,text}`) into the same `interactive` structure downstream handlers already understand (uses the title-based `BUTTON_TITLE_ACTIONS` map).

### 10. Raw webhook bodies weren't logged
When parsing failed, only `{from, type, id}` was logged. The full `msg` body (including `button.payload`) was lost forever — Meta has no API to re-fetch past webhook bodies (confirmed against the Cloud API, the `Message-History-ID/events` endpoint, and the BSP-onboarding `webhooks/reference/history`).

**Fix:** webhook now logs `JSON.stringify(msg)` at receive time and warns (not just logs) on parser gaps with a pointer to `parseWebhookMessage` for future type additions.

### 11. Legacy subscriber retired
`src/subscribers/whatsapp-partner-notifications.ts` was the pre-visual-flow path. Gated behind `DISABLE_LEGACY_WHATSAPP_PARTNER_SUBSCRIBER=1` on both Railway services (verified). Once the visual flow proved reliable, the file was deleted and the env-var references removed from the seed script instructions.

### 12. Deploy pipeline: removed Railway DB migrations
`.github/workflows/deploy-to-railway.yml` previously ran `medusa db:migrate --skip-links` + `db:sync-links --execute-all-links` on every push. Too risky for a production DB. Removed the `migrate` job (and the `changes` gating job, `force_migrate`/`skip_migrate` inputs). Deploys now only build + redeploy. Migrations are manual: `npx medusa db:migrate`.

## What Was Added This Iteration

### Images + no-password deep-links in the WhatsApp send

**Goal:** when the template lands on the partner's phone, follow up with an image of the design and a link they can tap to land in the partner portal already authenticated.

Three pieces:

1. **`send_whatsapp` gained `mode: "image"`**
   New options: `image_url`, `caption` (up to 1024 chars), `skip_if_no_image` (default `true`). Dispatches via `WhatsAppService.sendImageMessage()`. Persists as `messaging_message` with `message_type='media'`. When `image_url` is empty and `skip_if_no_image` is true, exits cleanly via the `failure` branch instead of erroring — designs without images don't break the flow.

2. **New operation `generate_partner_deeplink`**
   Wraps `generatePartnerDeeplink()` from `src/modules/social-provider/whatsapp-deeplink.ts`. Signs a 24h JWT with `{partner_id, run_id, type}` and returns `{url, token}`. Default base URL: `PARTNER_PORTAL_URL` env → `https://partner.jaalyantra.com`. The partner portal's `/partners/wa-auth?wa_token=…` route validates the token and issues a session — no password prompt.

3. **Migration `Migration20260420090000.ts`**
   Extends the `visual_flow_operation.operation_type` CHECK constraint to include `generate_partner_deeplink`. Without this, seed scripts fail with: `violates check constraint "visual_flow_operation_operation_type_check"`.

**Flow nodes added** (success branch, after the template send):

```
send_template
  ↓ success
gen_link            (generate_partner_deeplink)
  ↓
send_image          (send_whatsapp, mode="image")
```

### Design image resolver
`resolve_template` in the seed now picks ONE image URL from available sources in priority order:

1. `design.thumbnail_url` (string)
2. `design.moodboard[i]` (JSON array — accepts `string`, `{url}`, `{image}`, `{src}`)
3. `design.media_files[i]` (same shapes)
4. `design.design_files[i]` (same shapes)

Returns `null` if nothing matches — `send_image` then short-circuits via its failure branch.

### Defensive guards in `resolve_template`
- Skip with `missing_production_run_id_in_payload` when payload is empty (catches test executions)
- Skip with `no_partner_on_event` for parent/bundle re-run rows (no partner_id)
- Skip with `id_mismatch` when a read returned a row whose id doesn't match the expected payload id (double-checks the read_data fix)

## Operational Runbook

### Deploy flow changes
1. Push code to `main` — Railway redeploys automatically (see `.github/workflows/deploy-to-railway.yml`)
2. Run migrations locally (or via a one-off Railway shell): `npx medusa db:migrate`
3. Re-seed or re-sync the flow (see below)

### Re-seed the flow (clean slate)
```bash
# 1. Rename the existing flow in admin UI to preserve executions:
#    "Partner WhatsApp — Production Run (all events) [OLD]"
#    Set status to draft.

# 2. Seed a fresh flow from the latest script:
npx medusa exec ./src/scripts/seed-partner-run-whatsapp-flow.ts

# 3. In admin UI, flip new flow to active.
```

The seed refuses to overwrite an existing flow with the same name — that's why step 1 renames rather than deletes.

### Test end-to-end
1. Find a real event execution in `visual_flow_execution` (e.g. `triggered_by LIKE 'event:%'`)
2. Copy its id, then:
   ```bash
   curl -X POST "$BACKEND/admin/visual-flows/<flow_id>/execute" \
     -H "Authorization: <admin-auth>" \
     -H "Content-Type: application/json" \
     -d '{"replay_execution_id": "<prev_exec_id>"}'
   ```
3. Replay restores both `trigger_data` and `metadata.event_name` so `$trigger.event` populates correctly.

Or build a synthetic:
```json
{
  "trigger_data": {
    "production_run_id": "prod_run_…",
    "partner_id": "01K…",
    "design_id": "01J…"
  },
  "metadata": { "event_name": "production_run.sent_to_partner" }
}
```

### Debug a dropped webhook message
Check Railway worker logs:
```bash
railway logs --service medusa-worker | grep -E "\[whatsapp-webhook\]"
```
Every inbound `msg` is now logged as `[whatsapp-webhook] Incoming message (raw): {...}` before parsing. If a new Meta type appears, you'll see `[whatsapp-webhook] Unsupported message type — add case to parseWebhookMessage: <type>`. Add a `case "<type>":` to `parseWebhookMessage` in `src/api/webhooks/social/whatsapp/route.ts`.

## Known Gaps & Future Work

### WhatsApp template UX
- **Template v4 with dynamic image header + URL button** — currently the image comes as a follow-up text-with-caption message. Moving it into the template header (media-header template) shows the partner the design *before* the Accept/Decline buttons, which is better UX. Requires Meta re-approval (1-3 days).

### Data consistency
- **Duplicate conversation rows per partner** — e.g. `393933806825` and `+393933806825` both exist for the same partner. `sendImageMessage` + dedup logic search by digit-normalized phone, so it doesn't break anything, but the duplicates confuse admin UI. A one-off normalization script merging duplicates by digit-compared phone would clean this up.
- **Parent/bundle run events** — events fired on the parent run have no `partner_id`. Today we skip them entirely. Future: fan out to each child run's partner (one WhatsApp send per child). Needs either a loop node in the visual flow runtime or a dedicated subscriber.

### Raw webhook persistence
- **Dedicated `whatsapp_webhook_event` table** — logs are ephemeral; storing every raw webhook body in a tabled keyed by wamid enables proper replays, metrics, and audit. Current state: rely on Railway log retention.

### Visual flow runtime
- **Admin UI controls for new `send_whatsapp` image mode** — the Zod schema gets most of this automatically, but the node editor may need explicit wiring to surface `image_url`, `caption`, `skip_if_no_image` in the forms panel.
- **Condition branches on `send_whatsapp`** — the operation declares `hasMultipleOutputs` with `success`/`failure` handles. Flows that want to react to a skipped/failed send should use a downstream condition; documented in each send node's own comment.

### Drift prevention
- **Live flow vs seed drift** — the production flow has manual admin-UI edits (operation keys like `read_data_1776635248714` instead of the seed's `read_design`, extra canvas nodes with `vfop_…` ids). Re-seeding is the cleanest reconciliation but discards UI tweaks. Options: (a) always edit via the seed script and treat admin UI as read-only for seeded flows, (b) add a "sync from DB to seed script" command so UI edits can be captured back. No implementation yet.

### Unrelated warnings seen during seeding
- `subscriber in src/subscribers/inventory-created.ts is not a function. skipped.` — file doesn't default-export a function. Pre-existing, unrelated to the WhatsApp work. Worth cleaning up but not blocking.

## File Index

Changed this pass:

| Path | Purpose |
|---|---|
| `src/modules/visual_flows/operations/send-whatsapp.ts` | Added `mode: "image"`; fixed variable interpolation |
| `src/modules/visual_flows/operations/generate-partner-deeplink.ts` | **New** — signs 24h deep-link JWT |
| `src/modules/visual_flows/operations/read-data.ts` | Refuses query on null filter keys (no more arbitrary rows) |
| `src/modules/visual_flows/operations/index.ts` | Registered new operation |
| `src/modules/visual_flows/migrations/Migration20260420090000.ts` | **New** — CHECK constraint adds `generate_partner_deeplink` |
| `src/workflows/visual-flows/execute-visual-flow.ts` | `$trigger.event` fallback chain |
| `src/api/admin/visual-flows/[id]/execute/route.ts` | Replay restores `event_name` |
| `src/api/webhooks/social/whatsapp/route.ts` | Raw body logging + `type: "button"` parsing |
| `src/workflows/whatsapp/whatsapp-message-handler.ts` | Decline cancels linked tasks |
| `src/scripts/seed-partner-run-whatsapp-flow.ts` | Entity fixes, design image resolver, gen_link + send_image nodes |
| `src/subscribers/whatsapp-partner-notifications.ts` | **Deleted** — legacy retired |
| `.github/workflows/deploy-to-railway.yml` | Removed `migrate` and `changes` jobs |
