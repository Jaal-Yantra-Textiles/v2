# AUDIT: Maintenance-Job Run Route Callers (`dry_run` vs `preview`)

Audit of every caller of `POST /admin/ops/maintenance-jobs/:id/run` after the change that made the request body accept BOTH `dry_run` and a new `preview` flag (resolved by `resolveDryRun()`), while the admin MCP tool `run_maintenance_job` now forwards `preview` instead of `dry_run`.

**Verdict up front: no existing caller is broken.** Every HTTP caller in this repo sends `dry_run` (true or false), and the route still accepts `dry_run` unchanged. The only behavioural change is on the MCP tool path, where `dry_run` never reached the route anyway (the dispatcher intercepts it). Details and citations below.

## 1. The change under audit

- **Body schema** — `OpsMaintenanceRunSchema` accepts `dry_run: z.boolean().optional()` (`apps/backend/src/api/admin/ops/maintenance-jobs/validators.ts:9`) AND `preview: z.boolean().optional()` (`apps/backend/src/api/admin/ops/maintenance-jobs/validators.ts:21`), plus `params` (`apps/backend/src/api/admin/ops/maintenance-jobs/validators.ts:26`). The schema comment states `preview` exists because the MCP dispatcher eats `dry_run` (`apps/backend/src/api/admin/ops/maintenance-jobs/validators.ts:10-20`).
- **Resolution rule** — `resolveDryRun()` (`apps/backend/src/api/admin/ops/maintenance-jobs/validators.ts:129-135`): returns `true` (preview) if EITHER flag is explicitly `true`; otherwise `preview ?? dry_run ?? true` (safe-by-default). A contradictory `{preview: false, dry_run: true}` resolves to the SAFE reading (preview), never the write (`apps/backend/src/api/admin/ops/maintenance-jobs/validators.ts:120-127`).
- **Route** — `POST` in `apps/backend/src/api/admin/ops/maintenance-jobs/[id]/run/route.ts:18` calls `resolveDryRun(body)` at `apps/backend/src/api/admin/ops/maintenance-jobs/[id]/run/route.ts:33` and passes the result as `dry_run` to `job.run(req.scope, { dry_run, params })` (`apps/backend/src/api/admin/ops/maintenance-jobs/[id]/run/route.ts:36`).
- **Middleware validation** — the route body is validated by `validateAndTransformBody(wrapSchema(OpsMaintenanceRunSchema))` on matcher `/admin/ops/maintenance-jobs/:id/run` (`apps/backend/src/api/middlewares.ts:4721-4726`). The schema comment notes `validateAndTransformBody` strips unknown keys but won't inject one, hence the route-level default (`apps/backend/src/api/admin/ops/maintenance-jobs/validators.ts:5-7`).
- **MCP tool** — `run_maintenance_job` (`apps/backend/src/api/admin/mcp/lib/registry.ts:4868-4900`) POSTs to `/admin/ops/maintenance-jobs/:id/run` (`apps/backend/src/api/admin/mcp/lib/registry.ts:4872`) and forwards `bodyParams: ["preview", "params"]` — explicitly NOT `dry_run` (`apps/backend/src/api/admin/mcp/lib/registry.ts:4874-4877`).
- **Why `dry_run` never reached the route via MCP** — the shared dispatcher treats `dry_run` as its own flag: `const dryRun = args.dry_run === true` (`apps/backend/src/lib/mcp-core/dispatch.ts:193`); when set it returns the planned request WITHOUT calling the route (`apps/backend/src/lib/mcp-core/dispatch.ts:327-342`); only args listed in `bodyParams` are forwarded to the route (`const body = pick(def.bodyParams, args)` at `apps/backend/src/lib/mcp-core/dispatch.ts:281`). So through a tool, `dry_run: true` returned a plan and `dry_run: false` was a blind write with no preview — the defect `preview` fixes (`apps/backend/src/api/admin/ops/maintenance-jobs/validators.ts:13-19`).
- **Unit tests covering the change** — `apps/backend/src/api/admin/ops/maintenance-jobs/__tests__/resolve-dry-run.unit.spec.ts:9-38` (both spellings, safe reading on disagreement, legacy `dry_run: false` still applies) and `apps/backend/src/api/admin/mcp/lib/__tests__/run-review-preview-reachable.unit.spec.ts:67-89` (tool forwards `preview`, does NOT forward `dry_run`, advertises nothing it does not forward).

## 2. Callers of `POST /admin/ops/maintenance-jobs/:id/run`

| # | Caller | Flag sent | Broken? |
|---|--------|-----------|---------|
| 1 | Admin dashboard hook `useRunMaintenanceJob` | `dry_run` | No |
| 2 | Visual-flow operation `run_maintenance_job` | n/a — in-process, no HTTP | No (unaffected) |
| 3 | Batch executor (`POST .../batches`) | n/a — in-process, different route | No (unaffected) |
| 4 | `apps/backend/src/scripts/` | **not found** (no HTTP callers) | n/a |
| 5 | Integration tests (12 spec files) | `dry_run` (true and/or false) | No |
| 6 | E2E spec `order-shipment-gate.spec.ts` | `dry_run` (true and false) | No |
| 7 | Admin MCP tool `run_maintenance_job` | `preview` (the change itself) | n/a — this IS the change |

### 2.1 `apps/backend/src/admin/` (admin dashboard UI) — **1 caller found**

- `useRunMaintenanceJob` (`apps/backend/src/admin/hooks/api/ops-maintenance.ts:257-286`) POSTs to `/admin/ops/maintenance-jobs/${id}/run` (`apps/backend/src/admin/hooks/api/ops-maintenance.ts:270-272`) with `body: { dry_run, params: params ?? {} }` (`apps/backend/src/admin/hooks/api/ops-maintenance.ts:274`). The mutation variable is typed `dry_run: boolean` (`apps/backend/src/admin/hooks/api/ops-maintenance.ts:261-268`).
- **Still works unchanged**: `dry_run` remains in `OpsMaintenanceRunSchema` (`apps/backend/src/api/admin/ops/maintenance-jobs/validators.ts:9`) and `resolveDryRun` honours it (`apps/backend/src/api/admin/ops/maintenance-jobs/validators.ts:133-134`). `dry_run: true` still previews; `dry_run: false` still applies.
- This hook is consumed only by the Data Plumbing console page (`apps/backend/src/admin/routes/settings/ops-data-plumbing/page.tsx:52` inside `JobRunner`; grep for `useRunMaintenanceJob` in `apps/backend/src/admin` matches only `apps/backend/src/admin/routes/settings/ops-data-plumbing/page.tsx:29,52`).

### 2.2 `apps/backend/src/modules/visual_flows/operations/run-maintenance-job.ts` — **no HTTP caller; in-process**

- The operation does NOT POST to the route. It lazy-imports the registry (`apps/backend/src/modules/visual_flows/operations/run-maintenance-job.ts:114-116`) and calls `job.run(context.container, { dry_run: dryRun, params })` directly (`apps/backend/src/modules/visual_flows/operations/run-maintenance-job.ts:122-125`).
- Its own `dry_run` option defaults to FALSE (apply) — deliberately the inverse of the HTTP route's safe-by-default (`apps/backend/src/modules/visual_flows/operations/run-maintenance-job.ts:31-36`, coercion in `resolveDryRunOption` at `apps/backend/src/modules/visual_flows/operations/run-maintenance-job.ts:50-55`).
- **Unaffected** by the route-body change: it never goes through the HTTP body or `resolveDryRun()`.
- Registered as built-in operation `run_maintenance_job` in `apps/backend/src/modules/visual_flows/operations/index.ts:41,80,118`.

### 2.3 `apps/backend/src/api/admin/ops/maintenance-jobs/batches/` — **no HTTP call to the run route; calls `job.run()` directly**

- `POST /admin/ops/maintenance-jobs/batches` (`apps/backend/src/api/admin/ops/maintenance-jobs/batches/route.ts:31`) maps body jobs to `BatchJobSpec` and calls `runBatch(req.scope, { jobs, dry_run, stop_on_error })` (`apps/backend/src/api/admin/ops/maintenance-jobs/batches/route.ts:59`).
- `runBatch` (`apps/backend/src/api/admin/ops/maintenance-jobs/batch-executor.ts:63-94`) invokes the injectable runner per job; the default `defaultRunSingleJob` resolves the job from the registry and calls `job.run(container, opts)` in-process (`apps/backend/src/api/admin/ops/maintenance-jobs/batch-executor.ts:33-46`).
- The batch body has its own `dry_run` (`OpsMaintenanceBatchSchema`, `apps/backend/src/api/admin/ops/maintenance-jobs/validators.ts:74-90`; batch route reads `body.dry_run ?? true` at `apps/backend/src/api/admin/ops/maintenance-jobs/batches/route.ts:38`). There is no `preview` flag on the batch schema — it doesn't need one because the batch endpoint is not exposed as an MCP tool (no `maintenance-jobs/batches` path in `apps/backend/src/api/admin/mcp/lib/registry.ts`; the MCP registry only references `/admin/ops/maintenance-jobs`, `/admin/ops/maintenance-jobs/runs`, and `/admin/ops/maintenance-jobs/:id/run` at `apps/backend/src/api/admin/mcp/lib/registry.ts:4851,4860,4872`).
- **Unaffected**: the batch path never touches the `:id/run` route or its body schema.

### 2.4 `apps/backend/src/scripts/` — **no HTTP callers found**

- No script in `apps/backend/src/scripts/` POSTs to `/admin/ops/maintenance-jobs/:id/run` (repo-wide grep for `maintenance-jobs/` and `/run` finds no script hits; scripts referencing maintenance jobs only import job objects or seed visual flows).
- Closest references, all in-process:
  - `apps/backend/src/scripts/seed-winback-audience-refresh-flow.ts:73-74` seeds visual-flow nodes of type `run_maintenance_job` with `options: { job_id: ..., dry_run: false }` — these run through the in-process operation (§2.2), not the HTTP route.
  - `apps/backend/src/scripts/backfill-design-energy-costs.ts:45` parses its own CLI `--dry-run` flag and runs a workflow directly.
  - `apps/backend/src/scripts/backfill-classify-products-tax-class.ts:112-115` threads `dry_run` into a workflow input.

### 2.5 `apps/backend/integration-tests/` — **12 spec files, ALL send `dry_run`; none send `preview`**

Every POST body uses `dry_run: true` (preview) and/or `dry_run: false` (apply). All still work because `resolveDryRun` honours `dry_run` (`apps/backend/src/api/admin/ops/maintenance-jobs/validators.ts:133-134`).

| Spec file | Representative `file:line` citations (flag) |
|---|---|
| `apps/backend/integration-tests/http/ops-maintenance-jobs.spec.ts` | `:49` (`dry_run: true`), `:59` (`dry_run: true`), `:153` (`dry_run: false`), `:175` (`dry_run: false`), plus ~40 more POSTs across lines 48–775, all `dry_run` |
| `apps/backend/integration-tests/http/platform-tax-identity-deactivate.spec.ts` | `:112` (`dry_run: true`), `:146` (`dry_run: false`), `:190,209,216` (`dry_run: false`), `:227` (`dry_run: true`) |
| `apps/backend/integration-tests/http/ops-remirror-cancelled-run-status.spec.ts` | helper `runJob(params, dry_run)` posts `{ dry_run, params }` at `:127-132`; also `:240` (`dry_run: true`) |
| `apps/backend/integration-tests/http/inventory-order-status-flow-install.spec.ts` | `:55` (`dry_run: true`), `:63,76` (`dry_run: false`), `:88,95` (`dry_run: true`); `RUN_URL` const at `:20` |
| `apps/backend/integration-tests/http/backfill-audience-entries.spec.ts` | `:50,61,92` (`dry_run: false`), `:98` (`dry_run: true`); `RUN` const at `:18` |
| `apps/backend/integration-tests/http/ops-maintenance-run-detail.spec.ts` | `:31-32` (`dry_run: false`) |
| `apps/backend/integration-tests/http/backfill-fulfilled-retail-runs.spec.ts` | `:163-166` (`dry_run: true`), `:175-178` (`dry_run: false`), `:203-206` (`dry_run: false`); `RUN` const at `:22-23` |
| `apps/backend/integration-tests/http/inventory-order-shiprocket-shipment.spec.ts` | `:534-545` (`dry_run: true`), `:556-567` (`dry_run: false`), `:581-588` (`dry_run: false`), `:619-631` (`dry_run: true`), `:639-648` (`dry_run: true`) |
| `apps/backend/integration-tests/http/requires-shipping-fulfillment-gate.spec.ts` | `:546-551` (`dry_run: true`), `:588-593` (`dry_run: false`), `:619-623` (`dry_run: false`), `:647-652` (`dry_run: true`); `RUN` consts at `:532-533,635-636` |
| `apps/backend/integration-tests/http/inventory-order-material-backfill.spec.ts` | `:120-124` (`dry_run: true`), `:153-157` (`dry_run: false`), `:176-180,182-186` (`dry_run: false`), `:200-204` (`dry_run: false`), `:218-222` (`dry_run: true`) |
| `apps/backend/integration-tests/http/payment-submissions-api.spec.ts` | `:1297` (`dry_run: true`), `:1306` (`dry_run: false`), `:1333,1388,1416,1457` (`dry_run: false`); `RUN` const at `:1261` |
| `apps/backend/integration-tests/http/ops-maintenance-batches-history.spec.ts` | `:133-137` (`dry_run: true`), `:158-162` (`dry_run: true`) |

Related but NOT callers of the `:id/run` route: `apps/backend/integration-tests/http/ops-maintenance-batches.spec.ts` POSTs to `/admin/ops/maintenance-jobs/batches` (e.g. `:32,45,55,70,98,127,151,188`) — the batch endpoint (§2.3). `apps/backend/integration-tests/http/visual-flows/install-artisan-approval-flow.spec.ts:2,22` imports the job object and calls `.run()` in-process.

### 2.6 `e2e/` (Playwright specs) — **1 spec found, sends `dry_run`**

- `e2e/specs/order-shipment-gate.spec.ts:90-96` POSTs to `/admin/ops/maintenance-jobs/backfill-open-order-requires-shipping/run` with `data: { dry_run: true, params: { order_id: ... } }` (flag at `e2e/specs/order-shipment-gate.spec.ts:94`).
- `e2e/specs/order-shipment-gate.spec.ts:113-119` POSTs the same route with `dry_run: false` (flag at `e2e/specs/order-shipment-gate.spec.ts:117`).
- This is the ONLY e2e spec referencing maintenance-jobs (grep of `e2e/` for `maintenance-jobs|maintenance_job` matches only this file). **Still works unchanged.**

### 2.7 Other in-process consumers (for completeness — not HTTP callers)

- Scheduled job `apps/backend/src/jobs/sweep-crm-engagement.ts:34-37` calls `crmEngagementSweepJob.run(container, { dry_run: false, params: {} })` directly.
- Scheduled job `apps/backend/src/jobs/check-inventory-level-divergence.ts:4-8` imports pure helpers from `reset-negative-inventory-levels-job` (read-only watcher; no route call).
- No other app in the repo calls the route: grep for `ops/maintenance-jobs` under `apps/` matches only `apps/backend/**` (admin hook, API routes, integration tests, in-process imports); `packages/` has zero matches.

## 3. Admin dashboard UI: job list & params rendering

**URL path:** `/settings/ops-data-plumbing` (Medusa admin custom routes mirror the `src/admin/routes/` directory; the page lives at `apps/backend/src/admin/routes/settings/ops-data-plumbing/page.tsx`, and the in-app navigation to a run detail at `apps/backend/src/admin/routes/settings/ops-data-plumbing/page.tsx:454-455` uses `/settings/ops-data-plumbing/${row.id}`). The sidebar entry is registered via `defineRouteConfig({ label: "Data Plumbing", icon: Tools })` (`apps/backend/src/admin/routes/settings/ops-data-plumbing/page.tsx:499-502`).

**Data flow for the job list:**
1. `GET /admin/ops/maintenance-jobs` (`apps/backend/src/api/admin/ops/maintenance-jobs/route.ts:11-21`) returns `{ jobs: MAINTENANCE_JOBS.map(({id, label, description, params})), count }` — backend-driven, so newly registered jobs appear automatically.
2. `useMaintenanceJobs` (`apps/backend/src/admin/hooks/api/ops-maintenance.ts:154-164`) fetches it via `sdk.client.fetch`.
3. The page's "Run a job" drawer (`RunJobDrawer`, `apps/backend/src/admin/routes/settings/ops-data-plumbing/page.tsx:196-288`) renders a searchable `Combobox` of jobs (`apps/backend/src/admin/routes/settings/ops-data-plumbing/page.tsx:261-279`). The search is CONTROLLED and matches substring against `id`, `label`, AND `description` (`apps/backend/src/admin/routes/settings/ops-data-plumbing/page.tsx:220-230`) — so searching `backfill-parent-run` or the issue number in the description finds the job.

**Params rendering** (inside `JobRunner`, `apps/backend/src/admin/routes/settings/ops-data-plumbing/page.tsx:50-193`):
- Each param renders a `Label` with the param name plus `*` when required (`apps/backend/src/admin/routes/settings/ops-data-plumbing/page.tsx:126-129`).
- `type: "boolean"` params render a `Switch` (`apps/backend/src/admin/routes/settings/ops-data-plumbing/page.tsx:130-144`); `number`/`string` params render an `Input` (`type="number"` for number) (`apps/backend/src/admin/routes/settings/ops-data-plumbing/page.tsx:145-154`).
- The param's `description` renders as muted helper text below the input (`apps/backend/src/admin/routes/settings/ops-data-plumbing/page.tsx:155-157`).
- The job's `id` is shown in mono text (`apps/backend/src/admin/routes/settings/ops-data-plumbing/page.tsx:115-117`) and its `description` below (`:118-120`).
- "Preview (dry-run)" button calls `run(true)` and "Apply" calls `run(false)` (`apps/backend/src/admin/routes/settings/ops-data-plumbing/page.tsx:163-178`); `run()` enforces required params (`:68-71`), prompts for confirmation on apply (`:79-88`), and calls `runJob.mutateAsync({ id: job.id, dry_run, params: buildParams() })` (`:91-95`). `buildParams()` coerces number/boolean string values (`:56-66`).

**Run history & detail:**
- The page root is a `DataTable` of persisted runs (newest first) with columns When/Job/State/Changes/Errors/Summary/Actor (`apps/backend/src/admin/routes/settings/ops-data-plumbing/page.tsx:395-437`), fed by `useMaintenanceRuns` (`apps/backend/src/admin/hooks/api/ops-maintenance.ts:166-181` → `GET /admin/ops/maintenance-jobs/runs`).
- Row click navigates to the run-detail route `/settings/ops-data-plumbing/:runId` (`apps/backend/src/admin/routes/settings/ops-data-plumbing/page.tsx:454-455`), rendered by `apps/backend/src/admin/routes/settings/ops-data-plumbing/[id]/page.tsx:16-104` — job id heading, `RunBadge`, run `params` rendered as mono `Badge` key/value chips (`apps/backend/src/admin/routes/settings/ops-data-plumbing/[id]/page.tsx:66-74`), and the `ChangesTable` diff.
- Shared presentational components live in `apps/backend/src/admin/routes/settings/ops-data-plumbing/components.tsx`: `RunBadge` (`:87-111`), `ChangesTable` (per-entity before/after diff, capped at 200 rows, `:123-181`), `BatchDetailView` (`:299-336`).

**For the newly-added job `backfill-parent-run-produced-quantity`:**
- Job object defined at `apps/backend/src/api/admin/ops/maintenance-jobs/backfill-parent-run-produced-quantity-job.ts:74-93` — `id: "backfill-parent-run-produced-quantity"` (`:75`), label "Backfill produced_quantity on parent production runs" (`:76`), params `run_ids` (string, optional) and `limit` (number, optional) (`:79-93`).
- Registered in `MAINTENANCE_JOBS` at `apps/backend/src/api/admin/ops/maintenance-jobs/registry.ts:5916` (import at `:143`), so it appears automatically in `GET /admin/ops/maintenance-jobs` (`apps/backend/src/api/admin/ops/maintenance-jobs/route.ts:13-18`) and therefore in the UI drawer — no frontend change needed.
- On screen: open **Settings → Data Plumbing** (`/settings/ops-data-plumbing`), click **Run**, search `backfill-parent-run-produced-quantity` in the Combobox; its two params render as a text `Input` (`run_ids`) and a number `Input` (`limit`) per the rendering rules above.

## 4. Gotchas / invariants

- **Safe reading on contradiction**: `{preview: false, dry_run: true}` previews (never writes) — `resolveDryRun` returns true if either flag is explicitly true (`apps/backend/src/api/admin/ops/maintenance-jobs/validators.ts:133`). Unit-tested at `apps/backend/src/api/admin/ops/maintenance-jobs/__tests__/resolve-dry-run.unit.spec.ts:31-34`.
- **`dry_run` is dead on the MCP path by design**: the dispatcher consumes it before the route (`apps/backend/src/lib/mcp-core/dispatch.ts:193,327-342`) and only `bodyParams` are forwarded (`apps/backend/src/lib/mcp-core/dispatch.ts:281`). A tool caller that sends `dry_run: false` gets a real (blind) apply with no job change set — which is why the tool now advertises `preview` (`apps/backend/src/api/admin/mcp/lib/registry.ts:4870,4877`).
- **The batch endpoint has its own `dry_run` and no `preview`** (`apps/backend/src/api/admin/ops/maintenance-jobs/validators.ts:74-90`; `apps/backend/src/api/admin/ops/maintenance-jobs/batches/route.ts:38`). It is not MCP-exposed, so it doesn't need the alias.
- **The visual-flow op's default is the inverse of the route's**: op defaults to APPLY (`dry_run: false`, `apps/backend/src/modules/visual_flows/operations/run-maintenance-job.ts:31-36,84`), HTTP route defaults to PREVIEW (`apps/backend/src/api/admin/ops/maintenance-jobs/validators.ts:119`).
- **Unknown body keys are stripped by validation** (`validateAndTransformBody`), so the route must default `dry_run` itself rather than rely on the schema (`apps/backend/src/api/admin/ops/maintenance-jobs/validators.ts:5-7`).
- **zod v4 record gotcha**: `params` must use the two-arg `z.record(z.string(), z.any())` form or a non-empty params object crashes (`apps/backend/src/api/admin/ops/maintenance-jobs/validators.ts:22-25`).
- **Dry-runs are not persisted** to `ops_maintenance_run` — only applied runs are (the admin UI empty state says so at `apps/backend/src/admin/routes/settings/ops-data-plumbing/page.tsx:483-489`; the run-detail spec applies with `dry_run: false` to seed a row, `apps/backend/integration-tests/http/ops-maintenance-run-detail.spec.ts:29-34`).

## 5. Open questions / (unverified)

- **Out-of-repo callers**: curl/HTTP clients outside this repository (operator runbooks, Postman collections, external scripts) cannot be audited from source. The in-repo operator doc `apps/docs/notes/OPS_DATA_PLUMBING_HOWTO.md:77-88` shows curl examples using `dry_run` — those keep working under the new schema, but live usage is (unverified).
- **`scripts/agent-daemon/`**: `scripts/agent-daemon/CODEBASE_MAP.md:97,625-626` references the registry as a map for adding jobs, but no daemon code POSTs to the run route (repo-wide grep found no code hits under `scripts/agent-daemon/` for the route; only the markdown map). (Read-only check; that directory was not modified.)
