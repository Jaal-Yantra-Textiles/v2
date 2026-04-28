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

## April 28 Iteration — Reminder Pipeline Hardening + Media Templates

A second pass driven by a specific symptom on prod: every reminder dispatch produced a `read template + failed media` pair in `messaging_message`. A targeted audit surfaced 14 candidate issues, 12 validated. The high-impact ones shipped here in PRs #162, #164, #165, #167 (plus #166 and #168 for CI infra).

### What the audit found

Numbers below match the audit list (kept here so future readers can reproduce the diagnosis path).

| # | File:line | Severity | Symptom |
|---|---|---|---|
| 1 | `send-whatsapp.ts:519-524` | **Critical** | `pending_run_id` was being written as the synthetic `<run_id>:reminder:DATE` form. Inbound webhook reads that value verbatim to route Accept/Decline taps → 404 → "I couldn't tell which run this Accept refers to". Every reminder overwrote a previously-correct value, breaking later button taps on the assignment template. |
| 3 | `send-whatsapp.ts:478-530` | **High** | Persist-after-send: Meta call succeeded → DB row write failed (transient pool exhaustion) → operation returned `success: true` with no dedup row → next event-bus retry double-sent the template. |
| 5 | `send-whatsapp.ts:551-557` | **High** | Send failures (`template_not_found` during a Meta replace window, recipient-side rejections, etc.) were caught by the outer try/catch but **no `messaging_message` row was written**. Operators had no queryable trail keyed on `context_id` / `partner_id` — only the visual-flow execution log. |
| 4 | `send-whatsapp.ts:283-288` | Medium | First reminder to a brand-new partner always defaulted to Hindi. The language chain was `option → conversation metadata → phone-prefix heuristic → env → "hi"`. A new partner has no conversation row yet, so chain fell through to `+91 → "hi"` regardless of the admin's `preferred_language`. |
| 8 | `seed-partner-run-whatsapp-flow.ts:96-108` | Medium | `pickUrl` trimmed the string branch but **not** the object branch. A moodboard entry like `{url: "  "}` returned the whitespace verbatim, made `has_image` take the success branch, then `send_image` exited via `skip_if_no_image` — partner got the template but never the link-text fallback with the portal URL. |

Audit items deferred (not in this iteration):

- **#2 Skip `send_image` for reminder events** — depends on whether image goes into the template header (now done — see *Media-Header Reminder Templates* below). Still open: cleanly removing the `send_image` follow-up node from the seed flow once `_v2` is wired.
- **#9 `production-run-activity-recorder` writes `reminder_sent` at event-emission time** — needs a new enum value (`reminder_attempted` → `reminder_delivered`) which is a schema migration.
- **#13** the agent-flagged Hindi grammar bug was a false positive: `X में से Y` is "Y out of X" in Hindi (reversed from English), so `{{5}} में से {{4}}` correctly renders as "120 out of 250" when `{{4}}=120, {{5}}=250`.
- **#6** the agent flagged the discoverer's `status: { $in: [...] }` filter as missing an `accepted` state, but the production-run model has no such state — `accepted_at` is set while `status` stays `sent_to_partner`. Filter is correct.

### Fixes shipped

#### A. `pending_run_id` strip — PR #165

`send-whatsapp.ts` now passes `contextId` through a new `stripDedupSuffix()` helper before writing it to `conversation.metadata.pending_run_id`. Splits at the first `:reminder:` substring; everything after is dropped. Run ids are ULIDs and never legitimately contain `:reminder:`, so the trim is safe even when the upstream caller passes a clean id. Verified on prod: 0 conversations have a synthetic-id `pending_run_id` after the deploy.

#### B. Outbox pattern + audit on send failure — PR #165

Restructured `send-whatsapp.ts` so the dedup row exists *before* the Meta call, not after. Order is now:

1. Resolve language (template mode only).
2. `findOrCreateConversation` (was previously after Meta).
3. Pre-flight `messaging_message.create` with `status='pending'`, `wa_message_id=null`, placeholder content `[pending]`.
4. Per-mode dispatch wrapped in a try/catch:
   - On Meta success: update preflight row to `status='sent'` with the real `wa_message_id`, content preview, and `metadata.template_name`.
   - On Meta failure: update preflight to `status='failed'` with the error string in `metadata.error`, then re-throw to the outer catch.
5. `findRecentOutboundByContext` was extended to also match `status='pending'` so a concurrent retry sees the in-flight preflight row and short-circuits.

The outbox is what makes #3 and #5 both go away in one structural change. A retry within the dedup window now finds the preflight row and does not double-send. A failure leaves a queryable row with the underlying error.

#### C. Pin language on conversation create — PR #165

`findOrCreateConversation` gained an optional `initialLanguage` argument. When set (template mode passes the resolved `lang`), the new conversation row is created with `metadata.language = lang`. The next reminder to that partner finds the row in `resolveLanguageFromConversation` and skips the phone-prefix heuristic.

Set only on **create**, never on find — admins changing language manually via the consent flow won't be trampled.

#### D. `pickUrl` trims object-branch URLs — PR #165

The string branch trimmed already; the object branch `{url, image, src}` did not. Now every candidate is run through `.trim()` and falsy results return `null`. Eliminates a class of "design has a thumbnail but partner gets no link" cases.

### What was added

#### E. Media-header reminder templates (_v2) — PR #164 + PR #167

WhatsApp Cloud API blocks raw media (free-form `mode='image'`) outside the 24-hour customer-care window. For partners who hadn't replied recently, every reminder produced a `template (read)` + `media (failed)` pair in `messaging_message`. Templates with an `IMAGE` header are *exempt* from the 24h rule.

Three coordinated changes:

1. **`HeaderSpec` type and `header` field on `TemplateLanguageVariant`** — `partner-run-templates.ts`. Today only `IMAGE` format; VIDEO/DOCUMENT slot in at the same field.
2. **`header_image_url` runtime parameter on `send_whatsapp`** — when set and non-empty after interpolation, the operation prepends a header parameter (`{type: "image", image: {link: ...}}`). When empty/missing, Meta uses the template's example URL fallback. The seed pipes `{{ resolve_template.design_image_url }}` through, so each reminder lands with the actual design photo, not the example.
3. **`uploadHeaderHandle()` helper in the template manager** — Meta's Cloud API requires a *handle* (returned by their app-scoped resumable upload endpoint) in `example.header_handle`, not a public URL. Subcode `2388273` ("Templates with IMAGE header type need an example/sample, but it was not provided") was the giveaway. The helper does the 2-step pre-upload (POST to `/<META_APP_ID>/uploads` for a session id, then POST the binary to that session) before each `createTemplate` call. Reads `META_APP_ID` or `FACEBOOK_CLIENT_ID` from env.

**Naming:** the spec was bumped `_v1 → _v2` in the seed and template references so Meta could approve the new headers alongside the live `_v1` (zero-downtime). Live traffic kept using `_v1` until the operator re-ran the partner-run flow seed. After that, `_v1` can be deleted manually from Meta Business Manager (the script's `cleanup` mode strips trailing `_vN` suffixes, so it targets the un-versioned base name — not `_v1`).

#### F. WhatsApp deep-link auto-auth in partner-ui — PR #162

A reminder's link `https://partner.jaalyantra.com/production-runs/<run>?wa_token=<jwt>` was landing on the login page. The `partner-ui` `ProtectedRoute` ran its `useMe()` check before noticing the `wa_token` query param, found no session, redirected to `/login` — and the deep-link's JWT was silently dropped.

Three patches:

1. **Strip `:reminder:DATE` suffix at URL build time** — `whatsapp-deeplink.ts`. Defensive: even if upstream passes a synthetic id, the URL path and JWT `run_id` claim stay clean.
2. **`/partners/wa-auth` actually issues a Medusa session bearer** — was previously a verify-only endpoint that returned JSON. Now it looks up the partner's auth_identity (filtered by `app_metadata.partner_id` — set by `setAuthAppMetadataStep` to `partner.id`), and signs a Medusa-shaped bearer with the configured `http.jwtSecret` matching the payload layout produced by `generateJwtTokenForAuthIdentity`. Strips `:reminder:DATE` from the redirect path.
3. **`ProtectedRoute` consumes `?wa_token`** — exchanges the deep-link for a session bearer at `/partners/wa-auth`, stores it in `localStorage` at `partner_ui_auth_token` (the SDK's configured `jwtTokenStorageKey`), strips the token from the URL via `navigate(replace)`, then resumes the normal flow. On exchange failure, falls through to `/login` with a structured error banner that distinguishes `expired` / `invalid_signature` / `wrong_issuer` / `malformed` / `other`.

#### G. visual_flows execute_code validator — PR #160

Tangentially related but flushed out by the cart-recovery flow's classify code. The validator's identifier extraction had two bugs:

1. **`//` inside string literals** (e.g. `"https://example.com"`) was eaten by the line-comment regex, mangled the closing quote, and the next string-strip pass walked across multiple lines — leaking string content into the identifier list. Fixed by reordering the pipeline: strings first, comments after.
2. **`v.includes("_")` flagged any snake_case identifier as a probable npm package**, blocking valid user code (`cart_id`, `send_items`, etc.) with `Undefined package(s)` errors. Narrowed to a known-package whitelist.

Affects every `execute_code` node in every visual flow, including the partner-run-whatsapp flow's `resolve_template`.

#### H. CI infra: jest tokenx ESM transform — PR #166 + PR #168

`@mastra/core`'s CJS bundle requires the ESM-only `tokenx` package; Jest's CommonJS runtime can't `require()` ESM. Fixed in two passes:

1. **PR #166**: added a `.mjs`-specific transform with swc's `ecmascript` parser, and a `transformIgnorePatterns` negative-lookahead so tokenx reaches the transform.
2. **PR #168**: the actual blocker — without `module.type: "commonjs"` in the swc config, `target: "es5"` only changes JS *syntax*, not module *format*. swc was preserving `export` statements, so Node still saw ESM and `require()` still threw. Added explicit `module.type` to both transforms.

Verified empirically by running `@swc/core` directly on `tokenx@1.3.0/dist/index.mjs`:

| swc config | output |
|---|---|
| `target: "es5"` only | `export { approximateTokenSize, ... };` (still ESM) |
| `target: "es5"` + `module.type: "commonjs"` | `Object.defineProperty(exports, "__esModule", ...)` (real CJS) |

### Operator runbook for this iteration

1. **Confirm `_v2` templates are APPROVED on every WABA you target:**
   ```bash
   cd apps/backend && set -a && . ./.env 2>/dev/null && set +a && \
     MODE=dry-run npx medusa exec ./src/scripts/manage-whatsapp-templates.ts | grep _v2
   ```
   All 6 India variants (`pending_v2 / not_started_v2 / idle_v2` × `en/hi`) and 3 Australia variants (`× en`) should show `EXISTS (status=APPROVED)`.

2. **Re-seed the partner-run-whatsapp flow** so it picks up the `_v2` names and the `header_image_url` parameter:
   ```bash
   # In the admin UI: rename the existing flow to "...[OLD]" and set status=draft.
   cd apps/backend
   npx medusa exec ./src/scripts/seed-partner-run-whatsapp-flow.ts
   # In admin UI: flip the new flow to active.
   ```

3. **Spot-check after the next reminder cron fires** (UTC 04:30):
   ```sql
   SELECT id, message_type, status, context_id,
          metadata->>'error' AS error, created_at
   FROM messaging_message
   WHERE direction='outbound' AND context_type='production_run'
     AND created_at > NOW() - INTERVAL '2 hours'
   ORDER BY created_at DESC LIMIT 10;

   -- Confirm no synthetic id in pending_run_id
   SELECT count(*) FROM messaging_conversation
   WHERE metadata->>'pending_run_id' LIKE '%:reminder:%';  -- expect 0
   ```

4. **Cleanup of `_v1`** is still manual (delete each variant from Meta Business Manager UI). The script's `cleanup` mode targets the un-versioned base name, not `_v1`. Wait until `_v2` has been live for a few days before pulling the rug.

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
- ~~**Template v4 with dynamic image header + URL button**~~ — **shipped in the April 28 iteration**. Reminder templates (`pending / not_started / idle`) are now `_v2` with an `IMAGE` header; `send_whatsapp` accepts a per-message `header_image_url` and the seed pipes the design's thumbnail through it. See *Media-Header Reminder Templates* above. The `assigned / cancelled / completed` templates (`_v3`) are still text-only — same upgrade pattern applies if/when needed.
- **`send_image` follow-up node is now redundant** for reminder events (image is in the template header). Currently still wired in the seed for backward compat with non-reminder events; cleanly gating it on `!resolve_template.is_reminder` is open work (audit item #2).

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

### April 2026 (initial hardening)

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

### April 28 iteration (reminder pipeline + media templates)

| Path | PR | Purpose |
|---|---|---|
| `src/modules/visual_flows/operations/send-whatsapp.ts` | #165, #164 | Outbox pattern (preflight write before Meta call); audit row on send failure (`status=failed` + `metadata.error`); `pending_run_id` strip via `stripDedupSuffix()`; `header_image_url` runtime parameter; `findOrCreateConversation` accepts `initialLanguage` |
| `src/modules/visual_flows/operations/execute-code.ts` | #160 | String-strip before comment-strip in identifier extraction; narrowed package-detection heuristic to a known whitelist |
| `src/modules/social-provider/whatsapp-deeplink.ts` | #162 | `stripDedupSuffix()` on URL build; `verifyPartnerDeeplinkResult` returns structured error (`expired` / `invalid_signature` / `wrong_issuer` / `malformed` / `other`) |
| `src/api/partners/wa-auth/route.ts` | #162 | Issues a Medusa-shaped session bearer (was verify-only); strips `:reminder:DATE` from redirect path; surfaces specific error reasons |
| `src/scripts/whatsapp-templates/partner-run-templates.ts` | #164, #167 | `HeaderSpec` type; `header` field on language variants; `_v1 → _v2` rename for the 3 reminder templates; shared `REMINDER_HEADER_EXAMPLE_URL` (env-overridable via `WHATSAPP_REMINDER_HEADER_EXAMPLE_URL`) |
| `src/scripts/manage-whatsapp-templates.ts` | #164, #167 | `buildComponents()` emits `HEADER` first when set; `uploadHeaderHandle()` does Meta's resumable upload pre-step (returns the handle for `example.header_handle`); reads `META_APP_ID` / `FACEBOOK_CLIENT_ID` from env |
| `src/scripts/seed-partner-run-whatsapp-flow.ts` | #164, #165, #167 | `pickUrl` trims object-branch URLs; `_v2` template name references; `send_whatsapp` node passes `header_image_url: "{{ resolve_template.design_image_url }}"` |
| `src/scripts/seed-production-run-reminders-flow.ts` | #167 | Operator-facing log line bumped to `_v2` template names |
| `apps/partner-ui/src/components/authentication/protected-route/protected-route.tsx` | #162 | Consumes `?wa_token`, exchanges for bearer, strips token from URL, falls through to `/login` with structured error message on failure |
| `apps/partner-ui/src/routes/login/login.tsx` | #162 | Renders `state.waAuthError` as a warning Alert above the form |
| `apps/backend/jest.config.js` | #166, #168 | `.mjs` transform with swc `ecmascript` parser; `module.type: "commonjs"` on both transforms (forces CJS output regardless of source format); `transformIgnorePatterns` punches a hole for `tokenx` |
| `apps/backend/integration-tests/setup.js` | #166 | Defensive null-guard on the patched `waitWorkflowExecutions` so a teardown call with no container surfaces a clean noop instead of crashing |
