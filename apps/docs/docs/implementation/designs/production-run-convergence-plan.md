---
title: "Production Run Convergence Plan"
sidebar_label: "Convergence Plan"
sidebar_position: 2
---

# Production Run Convergence Plan

_Last updated: 2026-03-24_

This document details how to retire the `send-to-partner` design workflow and converge all partner production work into the Production Runs system. It covers the gap analysis, the specific changes needed, and the partner API/UI surface that needs to be unified.

---

## Gap Analysis: What Send-to-Partner Has That Production Runs Doesn't

### 1. Long-running workflow tied to partner milestones

**Send-to-Partner**: Uses a single durable workflow (`send-design-to-partner`, `store: true`) with 6 async gate steps. Each partner action (start, finish, redo, refinish, inventory, complete) resumes the workflow via `setStepSuccess`. The workflow is the source of truth for progress — deterministic, ordered.

**Production Runs**: The `dispatchProductionRunWorkflow` only pauses for admin template selection (1-hour timeout). After tasks are created, the workflow completes immediately. Partner progress is tracked by the `tasks.task.updated` subscriber — eventually consistent, not workflow-driven.

**Gap**: Production Runs need a long-running workflow that spans the full partner execution lifecycle, not just dispatch.

### 2. Partner milestone endpoints

**Send-to-Partner** has dedicated partner endpoints:

| Endpoint | Action |
|---|---|
| `POST /partners/designs/:id/start` | Partner starts work, updates design status to `In_Development` |
| `POST /partners/designs/:id/finish` | Partner marks work done, design → `Technical_Review` |
| `POST /partners/designs/:id/redo` | Partner requests rework, creates redo child tasks |
| `POST /partners/designs/:id/refinish` | Partner completes rework |
| `POST /partners/designs/:id/complete` | Partner submits inventory consumption, design → `Approved` |

**Production Runs** only has:

| Endpoint | Action |
|---|---|
| `POST /partners/production-runs/:id/accept` | Partner accepts run, status → `in_progress` |

After acceptance, all interaction goes through generic task endpoints (`/partners/assigned-tasks/`). There is no production-run-scoped start, finish, redo, or complete endpoint.

**Gap**: Production Runs need run-scoped partner milestone endpoints that mirror the design flow.

### 3. Consumption logging

**Send-to-Partner**: Partners can log material consumption at any time during `in_progress` via `POST /partners/designs/:id/consumption-logs`. Logs track `inventory_item_id`, `quantity`, `unit_of_measure`, `consumption_type` (sample/production/wastage), and `consumed_by`.

**Production Runs**: No consumption logging endpoints exist on the partner side for production runs.

**Gap**: Add consumption log endpoints scoped to production runs.

### 4. Inventory adjustment on completion

**Send-to-Partner**: `completePartnerDesignWorkflow` adjusts inventory (negative quantities) and records consumption links on the design.

**Production Runs**: No inventory adjustment on run completion.

**Gap**: The production run completion flow needs to adjust inventory based on the run's snapshot and consumption logs.

### 5. Media upload by partner

**Send-to-Partner**: Partners can upload images and attach them to the design via `/partners/designs/:id/media` and `/media/attach`.

**Production Runs**: No media upload endpoint scoped to production runs.

**Gap**: Add media endpoints or reuse the existing design media flow (since production runs already have `design_id`).

### 6. Redo cycle

**Send-to-Partner**: Full redo loop — partner calls `/redo`, on-demand redo child tasks are created (`partner-design-redo-log`, `redo-apply`, `redo-verify`), partner works through them, then calls `/refinish`. Limited to one redo cycle per design. All-or-nothing — no per-piece granularity.

**Production Runs**: No explicit redo concept, but the task template system already supports it naturally.

**Resolution (no gap)**: Redo in production runs = **add more tasks from redo templates to the same run**. The admin or partner creates new tasks from redo-specific templates (e.g., `redo-inspect`, `redo-fix`, `redo-verify`) and links them to the production run. The `production-run-task-updated` subscriber already checks all linked tasks before marking the run as complete — so new redo tasks automatically block completion until they're done.

This is better than send-to-partner's approach because:
- **Per-piece granularity**: Each task can target a specific piece or step, not the whole design
- **Multiple redo cycles**: No limit — add as many redo tasks as needed
- **Template-driven**: Redo templates are configurable per category, not hardcoded to 3 fixed steps
- **No workflow gates needed**: The existing subscriber-based completion check handles it

---

## Proposed Convergence: Unified Partner API

### New partner endpoints for Production Runs

Keep the existing task-based interaction (`/partners/assigned-tasks/`) as-is — it works well for granular task management. Add run-scoped endpoints for lifecycle operations:

| Endpoint | Action | Workflow step signaled |
|---|---|---|
| `POST /partners/production-runs/:id/accept` | Already exists. Accept run, status → `in_progress` | — |
| `POST /partners/production-runs/:id/start` | Partner starts work on the run | `await-run-start` |
| `POST /partners/production-runs/:id/finish` | Partner marks run work as done | `await-run-finish` |
| `POST /partners/production-runs/:id/complete` | Partner submits final consumption, adjusts inventory | `await-run-complete` |
| `POST /partners/production-runs/:id/consumption-logs` | Log material usage during `in_progress` | — |
| `GET /partners/production-runs/:id/consumption-logs` | Read consumption logs | — |
| `POST /partners/production-runs/:id/media` | Upload media files | — |
| `POST /partners/production-runs/:id/media/attach` | Attach uploaded URLs to the run's design | — |

No `/redo` or `/refinish` endpoints needed — redo is handled by adding new tasks from redo templates to the run (see [Redo via Task Templates](#redo-via-task-templates) below).

### New long-running workflow: `run-production-run-lifecycle`

Replace the current "fire-and-forget" dispatch with a durable workflow that spans the partner execution lifecycle:

```
sendProductionRunToProductionWorkflow (existing, creates tasks)
  │
  ▼
runProductionRunLifecycleWorkflow (NEW, store: true)
  │
  ├─ await-run-start        (async, 23-day timeout)
  │   Partner calls POST /start
  │   → run status: "in_progress"
  │   → design status: "In_Development" (if sampling)
  │
  ├─ await-run-finish       (async, 23-day timeout)
  │   Partner calls POST /finish
  │   → run metadata: finished_at
  │   → design status: "Technical_Review" (if sampling)
  │
  ├─ await-run-complete     (async, 23-day timeout)
  │   Partner calls POST /complete
  │   → adjusts inventory
  │   → records consumption
  │   → run status: "completed"
  │   → design status: "Approved" (if sampling)
  │
  └─ cascadeCompletionStep
      → check parent run
      → auto-dispatch dependent siblings
      → mark parent complete if all children done
```

This workflow is started by `sendProductionRunToProductionWorkflow` after task creation. It has no redo gates — redo is handled at the task level, outside the workflow.

### Redo via Task Templates

Redo doesn't need workflow gates or dedicated endpoints. It's just **more tasks from redo templates added to the same run**.

```
Run dispatched with templates: [cutting, stitching, finishing]
  │
  ├─ Partner completes cutting ✓
  ├─ Partner completes stitching ✓
  ├─ Finishing has issues
  │
  │  Admin adds redo tasks from templates: [redo-inspect, redo-fix, redo-verify]
  │  (linked to the same production run)
  │
  ├─ Partner completes redo-inspect ✓
  ├─ Partner completes redo-fix ✓
  ├─ Partner completes redo-verify ✓
  ├─ Partner completes finishing ✓
  │
  └─ All tasks done → subscriber marks run as completed
```

This works because:

1. **The subscriber checks all linked tasks.** `production-run-task-updated` fetches every task linked to the run (excluding the container task) and only marks the run as `completed` when all are done. New redo tasks automatically become blockers.

2. **No model changes needed.** The `Task` model, the link table, and the subscriber all support arbitrary numbers of tasks per run already.

3. **Admin endpoint for adding redo tasks.** Use the existing `POST /admin/production-runs/:id/send-to-production`-style flow or add a simpler `POST /admin/production-runs/:id/tasks` that creates tasks from template names and links them to the run + partner + design.

4. **Better than send-to-partner's redo** because:
   - Per-piece or per-step granularity (not all-or-nothing)
   - Multiple redo rounds (not limited to one cycle)
   - Template-driven (configurable per category, not hardcoded to 3 steps)
   - No workflow gate overhead

### How this interacts with existing task flow

The two systems coexist:

- **Run-level milestones** (start/finish/complete) are signaled via the lifecycle workflow and update the run's status and metadata
- **Task-level granularity** (accept/finish individual tasks, complete subtasks, redo tasks) continues via `/partners/assigned-tasks/` and the `tasks.task.updated` subscriber
- The lifecycle workflow's `await-run-complete` step is the authoritative completion gate — the subscriber is the secondary check that handles the task→run completion cascade

This means a partner can either:
1. Work through individual subtasks → auto-complete parent tasks → then call `/complete` on the run, OR
2. Call `/finish` on the run directly (which bulk-completes remaining tasks)

Both paths lead to the same outcome.

### Partner UI changes

The partner-ui currently has two separate sections:

- **Designs** (`/designs/*`) — uses design milestone endpoints
- **Production Runs** (`/production-runs/*`) — uses accept + task endpoints

After convergence, the **Designs section is retired** from the partner portal. Everything lives under **Production Runs**:

```
/production-runs                    → List all assigned runs (sampling + production)
/production-runs/:id                → Run detail with:
                                       - Run info (status, quantity, role, snapshot)
                                       - Action buttons (Start, Finish, Redo, Complete)
                                       - Task list with accept/finish per task
                                       - Subtask checkboxes
                                       - Consumption logs section
                                       - Media upload section
/production-runs/:id/complete       → Completion modal (inventory consumption form)
/production-runs/:id/media          → Media upload drawer
```

The action buttons follow the same status-gating logic as the current design actions:

| Run status | Actions available |
|---|---|
| `sent_to_partner` | Accept |
| `in_progress` (not started) | Start, Log Consumption, Upload Media |
| `in_progress` (started) | Finish, Log Consumption, Upload Media |
| `finished` | Complete |
| `completed` | View only |

Redo tasks appear in the task list like any other task — no separate phase or action button needed.

### Sampling vs Production distinction

Add a `run_type` field to the `ProductionRun` model:

```typescript
run_type: model.enum(["production", "sample"]).default("production")
```

Behavioral differences:

| | Sample run | Production run |
|---|---|---|
| **Created by** | Admin manually from design page | Auto from `order.placed` or admin manually |
| **Order linked** | No | Yes |
| **Design status updates** | Yes (In_Development → Technical_Review → Approved) | No (design already Commerce_Ready) |
| **Quantity** | Typically 1 | From order line item |
| **Listed in partner UI** | Under "Sampling" tab/filter | Under "Production" tab/filter |

The lifecycle workflow checks `run_type` to decide whether to update design status at each milestone.

---

## Implementation Status

### Step 1 — Add `run_type` + proper columns to ProductionRun model ✅

- `run_type` enum (`production` | `sample`, default `production`)
- Lifecycle timestamps: `accepted_at`, `started_at`, `finished_at`, `completed_at`
- Dispatch columns: `dispatch_state`, `dispatch_started_at`, `dispatch_completed_at`, `dispatch_template_names`
- Migration `Migration20260324022553.ts` with backfill from metadata
- Validators and routes updated to accept `run_type`
- Workflows updated to use columns instead of `metadata.acceptance.*` and `metadata.dispatch.*`

### Step 2 — `runProductionRunLifecycleWorkflow` ✅

- `src/workflows/production-runs/run-production-run-lifecycle.ts` — durable workflow (`store: true`)
- 3 async gate steps: `await-run-start`, `await-run-finish`, `await-run-complete`
- 23-day timeout per step (configurable via `PRODUCTION_RUN_AWAIT_TIMEOUT_SECONDS`)
- Stamps `metadata.lifecycle_transaction_id` on the run for partner endpoint signaling
- Cascade completion step checks parent run
- Started fire-and-forget from `sendProductionRunToProductionWorkflow` via `startLifecycleWorkflowStep`
- Signal utility: `src/workflows/production-runs/production-run-steps.ts`

### Step 3 — Partner milestone endpoints ✅

- `POST /partners/production-runs/:id/start` — sets `started_at`, signals `await-run-start`
- `POST /partners/production-runs/:id/finish` — sets `finished_at`, signals `await-run-finish`
- `POST /partners/production-runs/:id/complete` — sets `completed_at` + status `completed`, signals `await-run-complete`
- All validate partner ownership (`.catch(() => null)` on retrieve), status guards, duplicate-action prevention
- Registered in `middlewares.ts` with partner CORS + auth

### Step 4 — Redo via task templates ✅ (no new endpoint needed)

- Redo = admin adds more tasks from redo templates to the same run
- The `production-run-task-updated` subscriber checks all linked tasks before marking run complete
- New redo tasks automatically block completion

### Step 5 — Consumption log endpoints on production runs ✅

- `POST /partners/production-runs/:id/consumption-logs` — logs via the run's `design_id`, adds `production_run_id` to metadata
- `GET /partners/production-runs/:id/consumption-logs` — lists consumption logs
- Validates partner ownership + run must be `in_progress`
- Zod validator at `src/api/partners/production-runs/[id]/consumption-logs/validators.ts`

### Step 6 — Media endpoints on production runs ✅

- `POST /partners/production-runs/:id/media` — multipart file upload via `uploadFilesWorkflow`
- `POST /partners/production-runs/:id/media/attach` — attach URLs to the run's design with de-duplication
- Validates partner ownership
- Registered with multer for upload, JSON parser for attach

### Step 7 — Partner-ui updates ✅

- **List page**: `run_type` filter (Production/Sample dropdown) + Type column
- **Detail page**: Start, Mark Finished, Complete action buttons with status-gating
- **Detail page**: Activity timeline uses proper columns (`accepted_at`, `started_at`, `finished_at`, `completed_at`) instead of metadata
- **Detail page**: Type (run_type) shown in General section
- **Hooks**: `useStartPartnerProductionRun`, `useFinishPartnerProductionRun`, `useCompletePartnerProductionRun` added via `createRunMilestoneHook` factory. `PartnerProductionRun` type updated with new fields.

### Step 8 — Admin UI updates ✅

- **Detail page**: Type field added to Overview tab
- **Design section**: `run_type` badge (blue=Sample, grey=Production) on each run card
- **Hooks**: `AdminProductionRun` type updated with `run_type`

### Step 9 — Deprecate send-to-partner (pending)

- Send-to-partner remains active for existing designs
- New designs should use production runs
- When ready: guard the route, remove admin UI entry points
- See [Migration Guide](./send-to-partner-migration.md)

### Step 10 — Remove send-to-partner (pending)

- After all in-flight workflows are completed
- Remove workflow, routes, validators, admin UI components
- Remove partner design endpoints and partner-ui design routes
- See [Migration Guide](./send-to-partner-migration.md)

---

## Files Created

| File | Purpose |
|------|---------|
| `src/workflows/production-runs/run-production-run-lifecycle.ts` | Long-running lifecycle workflow (3 async gates) |
| `src/workflows/production-runs/production-run-steps.ts` | Signal utility for lifecycle workflow steps |
| `src/modules/production_runs/migrations/Migration20260324022553.ts` | Add `run_type`, lifecycle timestamps, dispatch columns + backfill |
| `src/api/partners/production-runs/[id]/start/route.ts` | Partner start endpoint |
| `src/api/partners/production-runs/[id]/finish/route.ts` | Partner finish endpoint |
| `src/api/partners/production-runs/[id]/complete/route.ts` | Partner complete endpoint |
| `src/api/partners/production-runs/[id]/consumption-logs/route.ts` | Consumption log POST + GET |
| `src/api/partners/production-runs/[id]/consumption-logs/validators.ts` | Zod schema |
| `src/api/partners/production-runs/[id]/media/route.ts` | Multipart file upload |
| `src/api/partners/production-runs/[id]/media/attach/route.ts` | Attach media URLs to design |
| `integration-tests/http/production-run-lifecycle.spec.ts` | Integration tests (4 tests) |

## Files Modified

| File | Change |
|------|--------|
| `src/modules/production_runs/models/production-run.ts` | Added 9 columns: `run_type`, lifecycle timestamps, dispatch fields |
| `src/workflows/production-runs/send-production-run-to-production.ts` | Fire-and-forget lifecycle workflow after task creation |
| `src/workflows/production-runs/accept-production-run.ts` | Use `accepted_at` column instead of metadata |
| `src/workflows/production-runs/dispatch-production-run.ts` | Use `dispatch_state`/`dispatch_started_at`/`dispatch_completed_at` columns |
| `src/workflows/production-runs/approve-production-run.ts` | Use `dispatch_template_names` column, pass `run_type` |
| `src/workflows/production-runs/create-production-run.ts` | Accept and pass `run_type` |
| `src/modules/production_policy/service.ts` | Read `dispatch_state` from column |
| `src/api/admin/production-runs/validators.ts` | Added `run_type` to create schema |
| `src/api/admin/production-runs/route.ts` | Pass `run_type`, support `run_type` filter |
| `src/api/admin/production-runs/[id]/approve/route.ts` | Read `dispatch_template_names` from column |
| `src/api/admin/designs/[id]/production-runs/route.ts` | Read `dispatch_template_names` from column |
| `src/api/partners/production-runs/validators.ts` | Added `run_type` filter |
| `src/api/partners/production-runs/route.ts` | Support `run_type` filter |
| `src/api/middlewares.ts` | Register all new partner routes |
| `src/subscribers/production-run-task-updated.ts` | Race condition guard + column read for `dispatch_template_names` |
| `src/subscribers/order-placed.ts` | Added logging when product has no design linked |
| `src/api/partners/assigned-tasks/[taskId]/subtasks/[subtaskId]/complete/route.ts` | Added `updateTaskWorkflow` call for event emission |
| `apps/partner-ui/src/hooks/api/partner-production-runs.tsx` | Added milestone hooks, updated types |
| `apps/partner-ui/src/routes/production-runs/production-run-list/production-run-list.tsx` | Added `run_type` filter + column |
| `apps/partner-ui/src/routes/production-runs/production-run-detail/production-run-detail.tsx` | Added milestone buttons, activity timeline from columns |
| `src/admin/hooks/api/production-runs.ts` | Updated `AdminProductionRun` type |
| `src/admin/components/designs/design-production-runs-section.tsx` | Added `run_type` badge |
| `src/admin/routes/production-runs/[id]/page.tsx` | Added Type field |
| `src/modules/maileroo/service.ts` | Fixed ESM import for maileroo-sdk |

## Files to Remove (Steps 9-10, when ready)

| File | Reason |
|------|--------|
| `src/workflows/designs/send-to-partner.ts` | Replaced by production run lifecycle |
| `src/api/admin/designs/[id]/send-to-partner/` | Deprecated endpoint |
| `src/admin/components/designs/batch-send-to-partner-drawer.tsx` | UI for deprecated flow |
| `src/api/partners/designs/[designId]/start/` | Replaced by run milestone |
| `src/api/partners/designs/[designId]/finish/` | Replaced by run milestone |
| `src/api/partners/designs/[designId]/redo/` | Replaced by run milestone |
| `src/api/partners/designs/[designId]/refinish/` | Replaced by run milestone |
| `src/api/partners/designs/[designId]/complete/` | Replaced by run milestone |
| `apps/partner-ui/src/routes/designs/` | Replaced by production runs UI |

---

## Related

- [Design Production Lifecycle](./design-production-lifecycle.md) — Overview and retirement recommendation
- [Send-to-Partner Migration Guide](./send-to-partner-migration.md) — In-flight workflow handling, data migration, and cleanup checklist
- [Production Status and Next Steps](../../reference/status/production-status.md) — Current implementation status
