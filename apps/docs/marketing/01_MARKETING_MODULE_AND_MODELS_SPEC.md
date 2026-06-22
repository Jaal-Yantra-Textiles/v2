# 01 — `marketing` module + 5 typed models + migrations (build spec)

**Slice:** §12 net-new item **#1** (the foundation) from
[`AI_VP_MARKETING_JYT_ADAPTATION.md`](./AI_VP_MARKETING_JYT_ADAPTATION.md) §6.
**Tracking issue:** #659. **Status:** build spec (analysis-mode daemon, no code yet).
**Depends on:** nothing — this is the foundation every later slice (snapshot job,
ideas email, outreach) writes into.

> **Every path/symbol in this doc was grep-verified against the repo on 2026-06-23.**
> Models, service, index, migration, and config-registration patterns are copied
> from the **`ops_audit` module** (#457/#480) and the **`analytics` module** (#559)
> — the two closest existing analogues. Build by *mirroring* them, not inventing.

---

## 0. Scope of this slice

Stand up a new `marketing` Medusa module with **5 typed models** and their
hand-written migrations, registered in **both** config files. **No routes, no jobs,
no AI, no UI** in this slice — those are slices 2–6. This slice is pure data
foundation so every later slice has typed columns (not `metadata`) to write into.

Deliverable = a module that boots, migrates cleanly on a fresh DB *and* an existing
DB, and exposes the auto-generated service CRUD (`createMarketing<Model>s`,
`listAndCountMarketing<Model>s`, `retrieveMarketing<Model>`, …).

---

## 1. ⛔ Blocking product decision (do NOT pick this yourself)

**The One Goal** (report §1: platform GMV vs partner activation vs storefront
conversion) shapes ONE field on ONE model — `marketing_metric_snapshot`. The snapshot
table is otherwise goal-agnostic (it stores arbitrary named metrics as rows), so this
slice is **buildable now** with a goal-agnostic snapshot schema (see §3.1). The One
Goal only decides *which* metric is rendered as the headline in slice 3, not the
column shape. **Recommendation: build this slice now** with the generic snapshot shape
and let slice 3 (the headline strip) consume whichever metric key the operator picks.

Other open decisions from the report (§12) are **not** blockers for this slice — they
affect slices 3/5/6 (Slack-vs-WhatsApp, email provider, admin-vs-route).

---

## 2. Where this lives (real paths)

New module dir, mirroring the `ops_audit` layout
(`apps/backend/src/modules/ops_audit/` — verified: `index.ts`, `service.ts`,
`models/`, `migrations/`):

```
apps/backend/src/modules/marketing/
  ├── index.ts                                  # Module() + MARKETING_MODULE const
  ├── service.ts                                # MedusaService({ ...5 models })
  ├── models/
  │   ├── marketing-metric-snapshot.ts
  │   ├── marketing-outreach.ts
  │   ├── marketing-draft.ts
  │   ├── marketing-manual-override.ts
  │   └── marketing-ideas-log.ts
  └── migrations/
      └── Migration<YYYYMMDDHHMMSS>.ts          # ONE migration, 5 create-table stmts
```

Register in **both** config files (verified registration sites):
- `apps/backend/medusa-config.ts` — add a `{ resolve: "./src/modules/marketing" }`
  entry to the `modules` array (alongside `./src/modules/ops_audit` at line ~403 and
  `./src/modules/analytics` at line ~390).
- `apps/backend/medusa-config.prod.ts` — same entry (ops_audit is at line ~465,
  analytics at line ~387). **Prod runs `.prod.ts` (Docker cp-overwrites base); a
  module registered only in the base file is invisible in prod.** (CODEBASE_MAP
  "Two config files"; memory `reference_two_medusa_config_files`.)
- **Do NOT** add to `medusa-config.dev.ts` — partner-payment-config precedent skips
  it (CODEBASE_MAP "New module checklist").

---

## 3. The 5 models (`model.define`)

All five use only DML primitives already proven in-repo:
`model.id().primaryKey()`, `model.text()`, `model.boolean()`, `model.number()`,
`model.float()`, `model.dateTime()`, `model.json()`, `.nullable()`, `.default()`,
`.indexes([{ on, unique }])`. The canonical reference with `.json()` + `.indexes()`
is `apps/backend/src/modules/analytics/models/analytics-daily-stats.ts`; the canonical
reference with plain typed columns + `.json()` payloads is
`apps/backend/src/modules/ops_audit/models/ops-maintenance-run.ts`.

> **`created_at` / `updated_at` / `deleted_at` are auto-added by `model.define()`** —
> never declare them (ops-maintenance-run.ts relies on this; its migration adds the
> three timestamptz columns by hand — see §4). Use the auto `created_at` as the
> snapshot/log timestamp; no separate `captured_at`/`ran_at` column needed.

### 3.1 `marketing_metric_snapshot` (append-only headline/trend rows)

Goal-agnostic: one row per `(metric_key, captured_for_date)` — stores any named
metric so the One Goal decision doesn't gate this slice.

```ts
// models/marketing-metric-snapshot.ts
import { model } from "@medusajs/framework/utils"

const MarketingMetricSnapshot = model.define("marketing_metric_snapshot", {
  id: model.id().primaryKey(),
  metric_key: model.text(),                 // e.g. "platform_gmv" | "partner_activations" | "storefront_conversion"
  value: model.float().default(0),          // the number (float covers currency + ratio; see §3.6 on money)
  unit: model.text().nullable(),            // "INR" | "count" | "ratio" | null
  captured_for_date: model.dateTime(),      // the business day this snapshot is FOR (IST midnight)
  source: model.text().nullable(),          // "daily-refresh" | "manual" | "backfill"
  breakdown: model.json().nullable(),       // optional [{label, value}] for drill-downs
  delta_dod: model.float().nullable(),      // day-over-day delta, precomputed by the job (slice 3)
})
.indexes([
  { on: ["metric_key", "captured_for_date"], unique: true },  // idempotent daily upsert
  { on: ["captured_for_date"] },
])
export default MarketingMetricSnapshot
```
- **append-only + idempotent**: the unique index lets `daily-refresh` (slice 3)
  upsert with the list-then-create/update pattern used by `aggregate-daily-analytics.ts`
  (it `listAnalyticsDailyStats({website_id, date})` then create-or-update).
- The One Goal becomes a *value of `metric_key`*, not a schema change.

### 3.2 `marketing_outreach` (hand-crafted outbound — Winbacks/Exec)

Report §5/§6. Powers slice 5 (`WinbacksView`).

```ts
const MarketingOutreach = model.define("marketing_outreach", {
  id: model.id().primaryKey(),
  recipient_email: model.text(),
  recipient_name: model.text().nullable(),
  company: model.text().nullable(),
  status: model.enum(["queued", "sent", "opened", "replied", "bounced", "unknown"]).default("queued"),
  channel: model.enum(["email", "whatsapp", "manual"]).default("email"),
  campaign: model.text().nullable(),        // free-text grouping ("q3-winbacks")
  sent_at: model.dateTime().nullable(),
  opened_at: model.dateTime().nullable(),
  replied_at: model.dateTime().nullable(),
  bounce_unreliable: model.boolean().default(false),  // report's "bounce status is unreliable" yellow flag
  notes: model.text().nullable(),
  external_id: model.text().nullable(),     // provider message id for sync (slice 5)
})
.indexes([
  { on: ["recipient_email"] },
  { on: ["campaign"] },
  { on: ["status"] },
])
export default MarketingOutreach
```
- `model.enum([...])` → migration emits a `text check (...)` column with default
  (CODEBASE_MAP §"bigNumber migration recipe"; example models:
  `src/modules/ad-planning/models/{ab-experiment,segment-member,sentiment-analysis}.ts`).

### 3.3 `marketing_draft` (newsletter/campaign drafts by name)

Report §4.5. Operator-review, never auto-send.

```ts
const MarketingDraft = model.define("marketing_draft", {
  id: model.id().primaryKey(),
  name: model.text(),                       // human label, e.g. "weekly-2026-06-23"
  kind: model.enum(["newsletter", "campaign", "ideas_email"]).default("newsletter"),
  status: model.enum(["draft", "approved", "sent", "discarded"]).default("draft"),
  payload: model.json(),                    // {subject, preheader, intro, sections[], ...}
  model_used: model.text().nullable(),      // which LLM produced it (for recall/A-B)
  approved_by: model.text().nullable(),
  sent_at: model.dateTime().nullable(),
})
.indexes([
  { on: ["name"] },
  { on: ["kind", "status"] },
])
export default MarketingDraft
```

### 3.4 `marketing_manual_override` (operator corrections to live data)

Report §6. When the operator overrides a computed number, record it *with a reason*
(so the AI guard and dashboard show the human-corrected value, audited).

```ts
const MarketingManualOverride = model.define("marketing_manual_override", {
  id: model.id().primaryKey(),
  metric_key: model.text(),                 // which snapshot metric this overrides
  effective_date: model.dateTime(),         // the day the override applies to
  override_value: model.float(),
  reason: model.text(),                     // required — never a silent override
  actor_id: model.text(),                   // who made the override
  active: model.boolean().default(true),    // soft-disable instead of delete
})
.indexes([
  { on: ["metric_key", "effective_date"] },
])
export default MarketingManualOverride
```
- **Note:** the *audit trail* of guarded actions reuses **`ops_audit`** (`ops_maintenance_run`),
  per report §6 — this table is the *live-data correction state*, not the audit log.

### 3.5 `marketing_ideas_log` (each generated tactical-ideas email)

Report §4.4. One row per generated ideas email — for recall, A/B, and the
hallucination-guard post-mortem (slice 2 writes here).

```ts
const MarketingIdeasLog = model.define("marketing_ideas_log", {
  id: model.id().primaryKey(),
  generated_for_date: model.dateTime(),
  model_used: model.text().nullable(),
  prompt_snapshot: model.json(),            // the ground-truth numbers fed in (guard input)
  output_text: model.text(),                // the generated email body
  guard_passed: model.boolean().default(false),  // did the §7 number-guard pass?
  guard_failures: model.json().nullable(),  // [{token, expected, found}] when it didn't
  regenerated: model.boolean().default(false),
  sent: model.boolean().default(false),     // did it actually go out, or flag-for-review?
})
.indexes([
  { on: ["generated_for_date"] },
  { on: ["guard_passed"] },
])
export default MarketingIdeasLog
```
- `prompt_snapshot` + `guard_failures` make slice 2's hallucination guard auditable
  and replayable — this is *why* it's a typed table, not metadata.

### 3.6 Money note (read before choosing `value` types)

The snapshot/override `value` columns use `model.float()`, **not** `model.bigNumber()`.
Rationale: these are *display/trend* numbers (a daily GMV figure for a headline +
sparkline), not money being arithmetic'd into orders. `model.bigNumber()` forces a
`numeric` + `raw_<col>` jsonb sidecar pair in the migration (CODEBASE_MAP recipe) and
is overkill for a snapshot. **If** the operator later wants exact-decimal GMV, that's a
follow-up migration adding a `bigNumber` column — call it out, don't pre-build it.
(memory `feedback_no_critical_data_in_metadata` confirms typed columns over metadata;
the bigNumber tradeoff is a separate axis.)

---

## 4. The migration (ONE file, hand-written)

Mirror `apps/backend/src/modules/ops_audit/migrations/Migration20260618070634.ts`
**exactly** — `create table if not exists` per model + the soft-delete index. A new
table via `create table if not exists` is SAFE on existing DBs (the hazard is only
*column-adds* to an existing create-if-not-exists table — CODEBASE_MAP "bigNumber
migration recipe" + memory `reference_medusa_migration_create_if_not_exists_hazard`).

**Each `create table` must include the three auto-timestamp columns by hand** (the
ORM adds them to the model but the hand-written migration must emit them — see
ops-maintenance-run.ts migration line 6):
```
"created_at" timestamptz not null default now(),
"updated_at" timestamptz not null default now(),
"deleted_at" timestamptz null,
```
and the soft-delete partial index per table:
```sql
CREATE INDEX IF NOT EXISTS "IDX_marketing_metric_snapshot_deleted_at"
  ON "marketing_metric_snapshot" ("deleted_at") WHERE deleted_at IS NULL;
```
Plus the `.indexes([...])` declared on each model become explicit
`CREATE [UNIQUE] INDEX IF NOT EXISTS` statements (the unique one on
`marketing_metric_snapshot (metric_key, captured_for_date)` is load-bearing for the
idempotent daily upsert).

`enum` columns → `"status" text check ("status" in ('queued','sent',...)) not null
default 'queued'` (CODEBASE_MAP recipe).

### ⚠️ Migration class-name collision (GLOBAL across modules)

Medusa tracks executed migrations by **class name** in a tracking table **shared
across all modules**. Two modules with the same `Migration<stamp>` class → the second
to run is silently skipped and its tables never land (this bit #348-A vs #604-A → PR
#661). **Before committing, pick a timestamp not used by ANY module:**
```bash
grep -rl "class Migration<stamp>" apps/backend/src/modules/*/migrations/
```
(CODEBASE_MAP "Migrations (hand-written ALTERs) — class names are GLOBAL".)

**No `.snapshot-*.json` needed** — that's only for `db:generate` diffing; a
hand-written migration doesn't produce one (CODEBASE_MAP "New module checklist").

---

## 5. `index.ts` + `service.ts` (mirror `ops_audit`)

`index.ts` (copy of `ops_audit/index.ts`):
```ts
import { Module } from "@medusajs/framework/utils"
import MarketingService from "./service"
export const MARKETING_MODULE = "marketing"
export default Module(MARKETING_MODULE, { service: MarketingService })
```

`service.ts` (copy of `ops_audit/service.ts`):
```ts
import { MedusaService } from "@medusajs/framework/utils"
import MarketingMetricSnapshot from "./models/marketing-metric-snapshot"
import MarketingOutreach from "./models/marketing-outreach"
import MarketingDraft from "./models/marketing-draft"
import MarketingManualOverride from "./models/marketing-manual-override"
import MarketingIdeasLog from "./models/marketing-ideas-log"

class MarketingService extends MedusaService({
  MarketingMetricSnapshot,
  MarketingOutreach,
  MarketingDraft,
  MarketingManualOverride,
  MarketingIdeasLog,
}) {}
export default MarketingService
```
`MedusaService` auto-generates per-model CRUD: `createMarketingMetricSnapshots`,
`listAndCountMarketingMetricSnapshots`, `retrieveMarketingDraft`,
`updateMarketingOutreaches`, etc. (same as ops_audit's `createOpsMaintenanceRuns` /
`listAndCountOpsMaintenanceRuns`). **Pluralization gotcha:** Medusa pluralizes the
model class name — verify the generated method names by checking the booted service
(ops_audit → `…Runs`/`…Batches`); `…Snapshots`, `…Outreaches`, `…Drafts`,
`…ManualOverrides`, `…IdeasLogs` are the expected forms.

---

## 6. Cross-module reads (for later slices — note now)

Later slices read orders/analytics/partners to compute snapshots. Per platform
convention, cross-module reads use **Query** (`query.graph`, resolved from the Medusa
container — `const query = container.resolve(ContainerRegistrationKeys.QUERY)`), NOT
the module service. `query.graph` field syntax uses the `relation.*` suffix, not
`*relation` prefix (memory `reference_query_graph_field_syntax`). A single-module read
(e.g. listing this module's own snapshots) can use the module service directly. This
slice ships no reads, but the snapshot model is shaped so slice 3 can upsert via the
service and read cross-module via Query.

---

## 7. Tests to write

Module/data slices are HTTP-integration-light (no routes yet), so cover the service
+ migration with an **integration:modules** test (precedent: ops_audit has
service-level coverage; analytics models are exercised via integration specs).

1. **`integration-tests/modules/marketing/marketing-service.spec.ts`** (or
   `src/modules/marketing/__tests__/`):
   - boot the module, `create*` one row of each of the 5 models, `listAndCount*`
     it back, assert typed columns round-trip (esp. `json` payloads + `enum` defaults).
   - assert the **unique index** on `marketing_metric_snapshot (metric_key,
     captured_for_date)` rejects a duplicate (idempotency contract for slice 3).
   - assert `enum` default values land (`status="queued"`, `kind="newsletter"`).
   - Run: `TEST_TYPE=integration:modules NODE_OPTIONS="--experimental-vm-modules" npx jest --testPathPattern="marketing"`
     (CLAUDE.md module-tests pattern).
2. **Migration sanity** (manual gate, not a jest file): run a real
   `npx medusa db:migrate` against a throwaway DB and confirm all 5 tables + indexes
   land, then run it **again** to confirm idempotency (`if not exists` no-ops). This
   is the §4 collision/landing check — do it before opening the PR (CODEBASE_MAP
   "isolate migration-vs-code").

No unit specs needed — there's no pure logic in this slice (the pure
hallucination-guard logic is slice 2).

---

## 8. Ordered PR list for this slice

This whole slice is **one PR** (it's the foundation; splitting models across PRs just
creates migration-ordering friction). Branch off `origin/main` (independent — does not
stack on any open PR; the config-file edits touch the `modules` array but no other open
PR is editing it).

**PR-1 — `feat(#659): marketing module + 5 models + migration`**
1. `src/modules/marketing/models/*.ts` (5 files, §3).
2. `src/modules/marketing/{index.ts,service.ts}` (§5).
3. `src/modules/marketing/migrations/Migration<unique-stamp>.ts` (§4) — grep the
   stamp first.
4. Register in `medusa-config.ts` **and** `medusa-config.prod.ts` (§2).
5. `integration-tests/.../marketing-service.spec.ts` (§7).
6. Stage files **explicitly** (never `git add -A` — daemon rule; sweeps the SDK
   binary). Typecheck changed files, zero NEW errors (annotate any
   `container.resolve(...)` as `:any` if inference complains — memory
   `reference_ci_build_unknown_container_resolve`).
7. Open PR, **do not merge** (human review).

---

## 9. Acceptance criteria

- [ ] `marketing` module boots; service resolves via `container.resolve("marketing")`.
- [ ] `npx medusa db:migrate` lands all 5 tables + indexes on a fresh DB **and** is a
      no-op on re-run (idempotent).
- [ ] Migration class-name is globally unique (grep clean).
- [ ] Registered in **both** `medusa-config.ts` and `medusa-config.prod.ts`.
- [ ] Integration:modules test green (CRUD round-trip + unique-index rejection + enum
      defaults).
- [ ] Zero new typecheck errors on changed files.
- [ ] No load-bearing data in `metadata` — all state is typed columns.

---

## 10. What this unblocks

- **Slice 2** (AI tactical-ideas email + hallucination guard) writes to
  `marketing_ideas_log`.
- **Slice 3** (`daily-refresh` job + headline strip) upserts `marketing_metric_snapshot`
  and reads `marketing_manual_override`.
- **Slice 4** (newsletter generator) writes `marketing_draft`.
- **Slice 5** (`WinbacksView` + provider sync) reads/writes `marketing_outreach`.

---

### Real-path appendix (all grep-verified 2026-06-23)

| Pattern | Reference file |
|---|---|
| Module `index.ts` (Module + MODULE const) | `apps/backend/src/modules/ops_audit/index.ts` |
| `service.ts` (MedusaService multi-model) | `apps/backend/src/modules/ops_audit/service.ts` |
| `model.define` w/ plain cols + `.json()` | `apps/backend/src/modules/ops_audit/models/ops-maintenance-run.ts` |
| `model.define` w/ `.json()` + `.indexes()` + `.default()` | `apps/backend/src/modules/analytics/models/analytics-daily-stats.ts` |
| `model.enum([...])` examples | `apps/backend/src/modules/ad-planning/models/{ab-experiment,segment-member,sentiment-analysis}.ts` |
| Hand-written `create table if not exists` migration + soft-delete index | `apps/backend/src/modules/ops_audit/migrations/Migration20260618070634.ts` |
| Module registration (base) | `apps/backend/medusa-config.ts` (`ops_audit` ~L403, `analytics` ~L390) |
| Module registration (prod) | `apps/backend/medusa-config.prod.ts` (`ops_audit` ~L465, `analytics` ~L387) |
| Idempotent daily upsert (list-then-create/update) | `apps/backend/src/jobs/aggregate-daily-analytics.ts` |
