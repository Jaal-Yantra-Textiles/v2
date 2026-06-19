# #508 Data Plumbing v2 — UI redesign spec (the LAST slice)

> Status: backend 100% done (slices 1–6, PRs #510–#515). This is the only
> remaining #508 slice. It is **Playwright-gated** — it touches a React surface
> (`apps/backend/src/admin/...`), so per the daemon rules it MUST be driven with
> the `playwright-skill`/`webapp-testing` skill against a live `yarn dev` and a
> screenshot captured. A headless daemon chunk without a bootable Medusa stack
> (Postgres + Redis + admin build) cannot verify it — hence this spec, so the
> next UI-capable session executes fast.

## What already exists (do not rebuild)

- **Route:** `apps/backend/src/admin/routes/settings/ops-data-plumbing/page.tsx`
  — Settings → Data Plumbing console (PR #507). Today it is a single `Container`
  with a `Tabs` ("Run a job" / "Run history"): a job `Select`, a dynamic param
  form (`JobRunner`), Preview(dry-run)/Apply buttons, a `ChangesTable` diff, and
  a flat `RunHistory` table over `GET .../runs`.
- **Data hooks:** `apps/backend/src/admin/hooks/api/ops-maintenance.ts`.
  - Existing: `useMaintenanceJobs`, `useMaintenanceRuns({limit,...})`,
    `useRunMaintenanceJob` (single-job POST mutation).
  - **Added by the foundation PR (feat/508-ui-batch-history-hooks):**
    `useMaintenanceBatches(query)` → `GET /admin/ops/maintenance-jobs/batches`
    (`{batches,count,limit,offset}`, filter `dry_run`/`actor_id`), and
    `useMaintenanceBatch(id)` → `GET .../batches/:id`
    (`{batch, jobs: MaintenanceRun[]}`, child runs in `job_index` order;
    `enabled` gated on id). Types `MaintenanceBatch`, `BatchDetailResponse`,
    `BatchesQuery`, `ListBatchesResponse` exported.

## Backend contract the UI consumes (all live on `main`)

| Endpoint | Returns | Use |
|---|---|---|
| `GET /admin/ops/maintenance-jobs` | `{jobs,count}` | job picker + param schema |
| `POST /admin/ops/maintenance-jobs/:id/run` | `{result, audit}` | single-job preview/apply |
| `GET /admin/ops/maintenance-jobs/runs` | `{runs,count,limit,offset}` | flat run history (incl. single-job + batch children) |
| `POST /admin/ops/maintenance-jobs/batches` | `{batch, results[]}` | run N jobs as one sequential batch (`dry_run` default true, `stop_on_error` opt) |
| `GET /admin/ops/maintenance-jobs/batches` | `{batches,count,limit,offset}` | **batch** history index, newest-first |
| `GET /admin/ops/maintenance-jobs/batches/:id` | `{batch, jobs[]}` | batch detail + its child runs |

`MaintenanceBatch` rollup columns: `name, actor_id, dry_run, stop_on_error,
job_count, applied_count, failed_count, change_count, error_count, summary,
created_at`. `MaintenanceRun` (child) adds `batch_id, job_index` plus per-entity
`changes[]`/`errors[]`.

## Target design (per #508 decisions + the handoff)

> "Root = **exportable Data Table of ALL runs** → click a run → **detail with
> grouped/card ↔ table view toggle**; consumes `GET .../batches` + `/batches/:id`
> + `GET .../runs`."

Recommended structure (keep "Run a job" + the batch runner as-is; redesign the
**history** surface):

1. **Root history view** — replace the flat `RunHistory` table with a Medusa
   `DataTable` (`@medusajs/ui` `DataTable` + `useDataTable`) of **batches**
   (newest-first), columns: When · Name · Jobs (`job_count`) · Applied · Failed ·
   Changes · dry-run/applied `Badge` · Actor. Add pagination (`limit`/`offset`
   via `useMaintenanceBatches`) and an **Export** action (CSV of the visible
   rows — Medusa has no built-in export; serialize client-side). Single-job runs
   (`batch_id = null`) are still visible via a secondary "All runs" tab over
   `useMaintenanceRuns`, OR fold single-job runs into a synthetic 1-job batch row
   — pick the tab approach (simpler, no backend change).
2. **Row click → batch detail** (drawer/`FocusModal` or nested route
   `ops-data-plumbing/batches/[id]`). Uses `useMaintenanceBatch(id)`. Header =
   the rollup (summary, counts, badges). Body = the child jobs.
3. **Detail view toggle** — a segmented control (`@medusajs/ui` Button group or
   Tabs) toggling:
   - **Grouped/card view** — one card per child job (`job_id`, badge, summary,
     change/error counts), expandable to its `ChangesTable` (reuse the existing
     `ChangesTable` component — extract it to a shared file).
   - **Table view** — flat `DataTable` of every `change` across all child jobs
     (cols: Job · Entity · ID · Field · Before · After), plus an errors section.

## Implementation notes / gotchas

- **Reuse**: extract `ChangesTable`, `RunBadge`, `formatValue` from `page.tsx`
  into a sibling (e.g. `ops-data-plumbing/components.tsx`) so both the single-job
  result and the batch-detail card/table reuse them. Don't duplicate.
- **Styling**: Medusa-native only (`--ui-*`/`--elevation-*`); use `DataTable`'s
  built-in skeleton or a `Skeleton` shape while loading — never "Loading…" text
  (current code violates this — fix it in the redesign).
- **Export**: build a CSV string from the loaded rows and trigger a Blob
  download; gate to the current page or refetch with a large `limit` for
  "export all". Log/disclose any cap (no silent truncation).
- **Nested route caveat**: admin runs inside a BrowserRouter; if a sub-route is
  needed prefer a `FocusModal`/drawer over nested routers (see memory:
  React-Router-nested gotcha). A drawer keyed on the selected batch id is the
  lowest-risk path.
- **No batch-run UI yet**: the "Run a job" tab still runs single jobs. A
  multi-select "Run as batch" composer over `POST .../batches` is a *follow-up*,
  not part of this slice — the slice is the **history/detail read** redesign.

## Verification (required before merge)

- `yarn dev` (apps/backend) → log into admin → Settings → Data Plumbing.
- Drive with Playwright: load history, click a batch, toggle card↔table, run an
  export. Capture screenshots of the root table + the detail toggle.
- Seed data: run a batch first (`POST .../batches` with 2 jobs, `dry_run:false`)
  so the history isn't empty. (Dry-runs are NOT persisted to history.)
