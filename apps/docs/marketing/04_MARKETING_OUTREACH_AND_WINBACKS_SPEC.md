# Slice 4 — `marketing_outreach` + `WinbacksView` + provider sync (build spec)

> **#659 AI VP of Marketing — net-new item §12 #5 (LAST of the daemon priority list).**
> Analysis-only doc. No feature code is written here. Every cited path/symbol was
> grep-verified against `apps/backend` on 2026-06-23. PR-by-PR build order at the end.
> Mirrors the cadence of slices 1–3 (`01_…`, `02_…`, `03_…_SPEC.md`).

## 0. What this slice is

The spec's "Hand-tuned outbound (Winbacks / Exec Outreach)" surface
(report §5, §12 #5). JYT is **furthest ahead** on the operator/script layer, so this
is genuinely net-new but small: a durable table of hand-crafted outbound, an admin
view to manage it, and a guarded "Sync from \<email provider\>" action that reconciles
engagement (opened / replied / bounced) from the provider.

Three deliverables:
1. **`marketing_outreach`** typed model — already declared in slice-1
   (`01_MARKETING_MODULE_AND_MODELS_SPEC.md`, PR #666). This slice **adds the routes,
   workflows, sync job, and UI** on top of that model; if slice 1 hasn't merged when this
   builds, the model migration ships with **this** slice instead (see §7 dependency note).
2. **`WinbacksView`** admin component — a `DataTable` of outreach rows with inline status,
   "Log Outreach" create form, and a "Sync from provider" button. Lives under the
   `/admin/marketing` tab created in slice 3.
3. **Provider sync** — a guarded, dry-run/apply reconciliation of outreach engagement from
   the email provider, modelled on the **existing `inbound-emails` Resend integration**
   (real, shipped) and registered as a **#457 maintenance job** so it's audited + idempotent.

> **Honesty rule from the spec (carry into the UI):** bounce status from email providers is
> **unreliable**. The `WinbacksView` must surface a **yellow warning** next to any
> `bounced` badge ("provider bounce signals are best-effort — verify before suppressing").

---

## 1. Data model — `marketing_outreach` (typed columns, NOT metadata)

Declared in slice 1 (`marketing` module). Restated here as the authoritative shape for the
routes/UI that consume it. Mirror the `model.define()` + json + `.index()` pattern of
`src/modules/analytics/models/analytics-daily-stats.ts` and the module skeleton of
`src/modules/ops_audit/` (index.ts / service.ts / models / migrations) — both verified.

```
marketing_outreach
  id                 model.id().primaryKey()       // mko_*
  recipient_email    model.text().index()          // who we contacted (lower-cased on write)
  recipient_name     model.text().nullable()
  company            model.text().nullable().index()
  channel            model.enum(["email","whatsapp","call","linkedin","other"]).default("email")
  kind               model.enum(["winback","exec_outreach","sponsor","partner_activation","other"]).default("winback")
  status             model.enum(["queued","sent","opened","replied","bounced","unsubscribed","failed"]).default("queued").index()
  subject            model.text().nullable()
  notes              model.text().nullable()        // free-text operator notes (NOT load-bearing)
  sent_at            model.dateTime().nullable()
  opened_at          model.dateTime().nullable()
  replied_at         model.dateTime().nullable()
  bounced_at         model.dateTime().nullable()
  provider           model.text().nullable()        // "resend" | "maileroo" | null (manual)
  provider_message_id model.text().nullable().index() // join key for sync reconciliation
  bounce_reason      model.text().nullable()        // best-effort, surfaced with a warning
  owner_user_id      model.text().nullable()        // operator who logged it
  last_synced_at     model.dateTime().nullable()
```

**Rationale for typed columns:** these mutate independently (status transitions, sync
stamps), so per the standing rule (no load-bearing data in metadata — Medusa replaces the
whole metadata blob on update) every field is a real column. `notes` is the only free-text
field and is explicitly non-load-bearing.

**Migration:** hand-written `create table if not exists` + per-column `add column if not
exists` ALTERs (the create-if-not-exists hazard: editing an existing create-table migration
never lands on existing DBs). Migration **class name is GLOBAL across modules** — grep the
repo before stamping. Ships in slice 1's migration; if this slice runs first, add it here.

---

## 2. API routes (mirror admin patterns — do not invent)

All under `src/api/admin/marketing/outreach/`. Mirror the validated-route + `query.graph`
conventions used across `src/api/admin/**` and the maintenance-jobs routes
(`src/api/admin/ops/maintenance-jobs/route.ts`, verified).

| Method & path | Purpose | Mirror |
|---|---|---|
| `GET /admin/marketing/outreach` | list + filter (`status`, `kind`, `company`, `q`) + paginate | `src/api/admin/abandoned-carts/route.ts` (verified; list+filter+paginate) |
| `POST /admin/marketing/outreach` | "Log Outreach" — create a row | maintenance-jobs `route.ts` validator pattern |
| `GET /admin/marketing/outreach/:id` | single row | `src/api/admin/inbound-emails/[id]/route.ts` (verified) |
| `POST /admin/marketing/outreach/:id` | update status / notes (operator override) | same |
| `DELETE /admin/marketing/outreach/:id` | soft-remove | same |
| `POST /admin/marketing/outreach/sync` | trigger provider sync (dry-run/apply) | `src/api/admin/inbound-emails/sync/route.ts` (verified — exact analog) |

**Validation:** `wrapSchema()` + `validateAndTransformBody()` (CLAUDE.md rule). The list `q`
filter must be honoured server-side via a pure helper (the recurring partner-search bug:
several `/partners/*` routes silently dropped `q` — see memory #484; read `q`, filter in-app,
`count = matched`).

**Search-as-`q` gotcha:** an unknown query param on a *validated* Medusa route **400s** (it's
not ignored) — see memory #508 (All-runs tab dropped `batch_id` until the route accepted it).
Declare every filter in the query validator.

---

## 3. Provider sync — the only non-trivial piece

**The exact, already-shipped analog is the `inbound-emails` Resend integration.** Reuse its
shape rather than inventing a provider client:

- Webhook receiver precedent: `src/api/webhooks/inbound-email/resend/route.ts` (verified).
- Provider-side webhook setup precedent: `src/api/admin/inbound-emails/setup-resend-webhook/route.ts`.
- Manual reconcile precedent: `src/api/admin/inbound-emails/sync/route.ts`.
- Module precedent: `src/modules/inbound_emails/` (index/service/models/migrations) and the
  provider modules `src/modules/resend/` + `src/modules/maileroo/` + the
  `src/modules/email-provider-manager/` (usage tracking) — all verified.

**Two sync mechanisms (build the pull job first; webhook is optional follow-up):**

1. **Pull/reconcile job (primary)** — a **#457 maintenance job** registered in
   `src/api/admin/ops/maintenance-jobs/registry.ts` (verified; `MaintenanceJobResult` /
   `MaintenanceChange` types, dry-run default, idempotent apply, per-entity `errors[]`,
   audited via `ops_audit`). Job id e.g. `sync-marketing-outreach-engagement`:
   - For each `marketing_outreach` row with a `provider_message_id` and a non-terminal
     status, query the provider's message-events API, map → `{opened_at, replied_at,
     bounced_at, status}`, and `diff` vs persisted (pure `diffOutreachEngagement(before,
     event)` → `MaintenanceChange[]`, unit-tested).
   - **Bounce caveat:** never auto-suppress on a bounce signal. Set `status=bounced` +
     `bounce_reason` but leave the operator to act. The job summary must say so.
   - Registering it as a maintenance job means the **existing Data Plumbing UI (#485/#508)
     already runs it** (dry-run preview → apply → run history) for free — no new UI for sync
     scheduling, and it inherits batch + audit. The `WinbacksView` "Sync" button can either
     deep-link to that console or `POST /admin/marketing/outreach/sync` which invokes the
     same registry entry with `dry_run:false`.

2. **Webhook receiver (optional follow-up)** — `POST /api/webhooks/marketing-outreach/resend`
   mirroring `webhooks/inbound-email/resend/route.ts`: verify signature, match
   `provider_message_id`, stamp engagement. Lower priority — the pull job covers correctness;
   the webhook only reduces latency.

**Why a maintenance job, not a plain scheduled job:** outreach is hand-curated and
low-volume; the operator wants a **preview before writing** and an **audit trail**, which is
exactly the #457 contract. (A `src/jobs/*.ts` cron could *also* call the same registry entry
nightly with `dry_run:false` for hands-off reconciliation — optional, server-TZ is UTC in
prod, adjust for IST. Jobs are auto-discovered from `src/jobs/*.ts`, no config edit.)

---

## 4. Workflows

Thin — most logic is in pure libs + the registry job. Mirror
`src/modules/partner_billing/compute-fee.ts` (pure lib + unit, NOT under a `lib/` dir).

- `logOutreachWorkflow` — validate + lower-case email + stamp `owner_user_id` from the
  authenticated admin + `createMarketingOutreaches`. Compensation: delete the created row.
- `syncMarketingOutreachWorkflow` — wraps the registry job's reconcile so the route and the
  optional cron share one path. Returns `MaintenanceJobResult` (dry-run preview or applied).
- Pure libs (unit-tested, no container):
  - `diff-outreach-engagement.ts` → `diffOutreachEngagement(row, providerEvent)` →
    `MaintenanceChange[]` + next status. Encodes the status state machine
    (`queued→sent→opened→replied`; `bounced`/`unsubscribed`/`failed` terminal).
  - `outreach-list-lib.ts` → `filterAndPaginateOutreach(rows, {q,status,kind,company,page})`
    (the `q`-honouring + page-vs-set fix from memory #484: filter the SET then paginate, so
    `count` is total matched, not per-page).

---

## 5. Admin UI — `WinbacksView`

Lives as a tab/section inside the `/admin/marketing` route created in slice 3
(`03_DAILY_REFRESH_JOB_AND_ADMIN_TAB_SPEC.md`). Mirror the verified `DataTable` pattern in
`src/admin/routes/ads/_components/ads-tab.tsx` (`DataTable`, `useDataTable`,
`createColumnHelper`, `DataTablePaginationState`, `StatusBadge` from `@medusajs/ui`,
URL-param pagination via `useSearchParams`). Data hook mirrors
`src/admin/hooks/api/analytics.ts` + the react-query `staleTime` precedent
(`messaging.ts:201` / `currency.ts:36`).

Components:
- **`WinbacksView`** — `DataTable` columns: recipient (name/email), company, kind,
  `StatusBadge` (tone-mapped; `bounced`→`orange` **with a tooltip/inline warning** per the
  honesty rule), `sent_at` / `replied_at`, notes-preview. Pagination + `q` search +
  `status`/`kind` filters wired to URL params.
- **`LogOutreachForm`** — drawer/modal create form (recipient, company, channel, kind,
  subject, notes). On submit → `POST /admin/marketing/outreach`. Use `toast` from
  `@medusajs/ui` (NOT sonner — memory: sonner silently never renders).
- **"Sync from provider" button** — calls `POST /admin/marketing/outreach/sync`
  (dry-run first → show a confirm with the change count → apply), or deep-links to the Data
  Plumbing console for the registry job. Show a **yellow banner** explaining bounce
  unreliability before apply.
- Loading states use **Skeletons** (memory: never plain "Loading…"); Medusa `--ui-*` /
  `--elevation-*` tokens so dark mode follows (memory: medusa-native styling).

**UI verification gate:** per daemon rules, the render slice MUST be Playwright-driven
against a live `yarn dev` with a screenshot — unit tests don't count for UI. The headless
analysis daemon **cannot** boot Medusa + Playwright, so the render PR is **deferred / flagged
for a session that can run the browser**, exactly as slices 1–3 deferred their render slices.
The verifiable hooks + pure libs ship before it.

---

## 6. Tests to write

- **Unit (pure libs — `TEST_TYPE=unit` for specs under `src/api`/`src/modules`):**
  - `diff-outreach-engagement` — every status transition, terminal-status no-op, bounce
    sets reason but not suppression, idempotency (re-diff after apply = no changes).
  - `outreach-list-lib` — `q` matches recipient/company, filter SET then paginate
    (`count`=total matched not per-page — the #484 regression test).
- **Integration (per-file only — `pnpm test:integration:http:shared -- <one spec>`; never
  the whole dir, CREATE INDEX CONCURRENTLY vs TRUNCATE deadlock):**
  - `outreach.http.spec.ts` — create (lower-cases email, stamps owner), list+filter+paginate,
    update status, delete.
  - `outreach-sync.http.spec.ts` — sync dry-run returns changes + writes nothing; apply
    stamps engagement + writes an `ops_audit` row; second apply is a no-op (idempotent).
    Provider client is **mocked** — never hit a live provider or live LLM in CI; base
    `medusa-config.ts` test config only has local + whatsapp providers (memory: tests assert
    the row, not delivery).
- **Registry unit** — extend `src/api/admin/ops/maintenance-jobs/__tests__/registry.unit.spec.ts`
  to assert the new job id is registered with a param schema.

---

## 7. Dependency note & blocking decisions

- **Depends on slice 1** (`marketing` module + `marketing_outreach` model). Build order:
  slice 1 → slice 4. If slice 1's PR (#666) is unmerged when this builds, fold the
  `marketing_outreach` model + migration into **this** slice's first PR.
- **Depends on slice 3** for the `/admin/marketing` host route (the tab `WinbacksView`
  mounts into). The pure libs + routes + sync job do **not** depend on slice 3 and can ship
  first.
- **One Goal (the standing blocking decision, §1 of the report) does NOT block this slice.**
  Outreach is goal-agnostic (it's CRM-style outbound tracking, not a headline metric). The
  One Goal only gates slice-3 headline rendering. ✅ Build-unblocked.
- **Genuine product decisions for THIS slice (surface, don't decide):**
  1. **Which email provider** backs sync — `resend` (webhook precedent exists) vs `maileroo`
     vs the `email-provider-manager` abstraction. Recommend **Resend first** (only provider
     with a shipped inbound-webhook integration to mirror).
  2. **Auto-suppress on bounce?** Spec says bounce is unreliable → default **NO** (operator
     acts). Confirm.
  3. **Nightly hands-off reconcile cron, or manual-only** via the Data Plumbing console.
     Recommend manual-first (low volume), add cron later.

---

## 8. Ordered PR list (one slice per PR, mirror #457/#559 cadence)

1. **4a — model + migration** (only if slice 1 unmerged; else skip). `marketing_outreach`
   `model.define` + hand-written `if not exists` migration, registered in **both**
   `medusa-config.ts` + `.prod.ts` (NOT `.dev.ts`). Grep migration class name first.
2. **4b — pure libs + unit tests.** `diff-outreach-engagement.ts`, `outreach-list-lib.ts`
   + unit specs. No container, fully CI-safe. **Build first** (highest verifiability).
3. **4c — CRUD routes + workflows + integration tests.** `GET/POST/:id/DELETE` +
   `logOutreachWorkflow` + per-file `outreach.http.spec.ts`.
4. **4d — provider sync job (registry entry) + sync route + integration test.** Register in
   `maintenance-jobs/registry.ts` (mocked provider), `POST .../outreach/sync`,
   `outreach-sync.http.spec.ts`. Inherits Data Plumbing UI + `ops_audit` for free.
5. **4e — `WinbacksView` + `LogOutreachForm` UI** (render slice, **Playwright-gated** →
   deferred to a browser-capable session). Mount into the slice-3 `/admin/marketing` tab.
6. **4f — webhook receiver (optional follow-up).** `webhooks/marketing-outreach/resend`
   mirroring the inbound-email webhook. Lowest priority.

---

## 9. Existing JYT primitives reused (all paths verified 2026-06-23)

| Need | Reuse (real path) |
|---|---|
| New module skeleton | `src/modules/ops_audit/` (index/service/models/migrations) |
| `model.define` + json + index | `src/modules/analytics/models/analytics-daily-stats.ts` |
| Guarded dry-run/apply + audit + run history | `src/api/admin/ops/maintenance-jobs/registry.ts` (#457) + `ops_audit` (#480) |
| Sync UI for free | Data Plumbing console (#485/#508) consuming the registry |
| Provider sync analog (Resend) | `src/api/admin/inbound-emails/sync/route.ts`, `.../setup-resend-webhook/route.ts`, `src/api/webhooks/inbound-email/resend/route.ts`, `src/modules/inbound_emails/`, `src/modules/resend/`, `src/modules/email-provider-manager/` |
| List+filter+paginate route | `src/api/admin/abandoned-carts/route.ts` |
| Single-row route shape | `src/api/admin/inbound-emails/[id]/route.ts` |
| Admin `DataTable` | `src/admin/routes/ads/_components/ads-tab.tsx` |
| Admin data hook + `staleTime` | `src/admin/hooks/api/analytics.ts`, `messaging.ts:201`, `currency.ts:36` |
| Pure lib + unit convention | `src/modules/partner_billing/compute-fee.ts` |
| Toast | `toast` from `@medusajs/ui` (never sonner) |

---

*Slice 4 of 4 in the #659 analysis wave. With slices 1–4 specced, the daemon's priority
list (report §12 #1–#5 net-new items) is complete. Remaining §12 items — newsletter draft
generator (#4), verified subdomain + Slack/WhatsApp summary (#6), public chatbot (#7) — are
lower priority and out of the daemon's stated scope; spec them on operator request.*
