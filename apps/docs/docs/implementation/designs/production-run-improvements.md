---
title: "Production Run Improvements"
sidebar_label: "Improvements"
sidebar_position: 4
---

# Production Run Improvements

_Last updated: 2026-03-24_

Issues and improvements identified during the send-to-partner convergence analysis. Organized by severity.

---

## Fixed

### Subtask completion now triggers production run completion

**Problem**: When a partner completed subtasks via `POST /partners/assigned-tasks/:taskId/subtasks/:subtaskId/complete`, the parent task auto-completion called `taskService.updateTasks()` directly without going through `updateTaskWorkflow`. While `MedusaService` does auto-emit `tasks.task.updated`, the parent task completion wasn't reliably reaching the `production-run-task-updated` subscriber.

**Fix**: Added `updateTaskWorkflow` call after the direct `taskService.updateTasks()` on parent task completion, ensuring the event is emitted through the workflow path consistently.

**File**: `src/api/partners/assigned-tasks/[taskId]/subtasks/[subtaskId]/complete/route.ts`

### Race condition guard in completion subscriber

**Problem**: If two tasks completed simultaneously, both subscriber invocations could pass the status check and both call `updateProductionRuns` with `status: "completed"`. No idempotency guard between read and write.

**Fix**: Added a fresh re-read of the production run status immediately before the completion write. If another concurrent invocation already set it to `completed`, the second one bails out.

**File**: `src/subscribers/production-run-task-updated.ts`

### Silent skip when order product has no design

**Problem**: In `order-placed` subscriber, if a product had no design linked (no variant-level or product-level link), the item was silently skipped with `continue` — no log, no warning. Made it hard to debug why production runs weren't created.

**Fix**: Added `logger.info` message logging the `productId`, `variantId`, and `lineItemId` when skipping.

**File**: `src/subscribers/order-placed.ts`

---

## To Do — Metadata Cleanup (Move to Proper Columns)

The current system stores operational state in `metadata` JSON fields on both production runs and tasks. This is fragile — no schema enforcement, no type safety, no queryability, and silent data loss if a key is misspelled or overwritten. These should become proper model columns.

### Production Run metadata → columns

| Current metadata key | Should become | Why |
|---|---|---|
| `metadata.acceptance.accepted_at` | `accepted_at: model.dateTime().nullable()` | Timestamp for when partner accepted. Currently written but never read — adding a column makes it queryable and visible. |
| `metadata.dispatch.state` | `dispatch_state: model.enum(["idle", "awaiting_templates", "completed"]).default("idle")` | Used by `ProductionPolicyService.assertCanStartDispatch()` to prevent double-dispatch. A proper enum column is type-safe and filterable. |
| `metadata.dispatch.started_at` | `dispatch_started_at: model.dateTime().nullable()` | Currently written but never read. A column makes it available for admin dashboards. |
| `metadata.dispatch.completed_at` | `dispatch_completed_at: model.dateTime().nullable()` | Same — audit visibility. |
| `metadata.dispatch_template_names` | `dispatch_template_names: model.json().nullable()` | Read by 3 places (approve route, designs route, task subscriber) for auto-dispatch. Already effectively a column — making it explicit prevents accidental overwrite by other metadata writes. |
| `metadata.source` | Keep as metadata | Informational/audit only, not read by any logic. Fine as metadata. |

### Task metadata → columns or links

| Current metadata key | Should become | Why |
|---|---|---|
| `metadata.production_run_id` | Module link: `production_run ↔ task` | **Critical.** The task-updated subscriber reads this to find which production run to update. A link is queryable via `query.graph` and doesn't depend on JSON structure. The link already exists (`production-runs-tasks.ts`) — the subscriber should use it instead of reading metadata. |
| `metadata.comments` | Separate `task_comment` model | Comments stored as a JSON array in metadata have no individual IDs (current IDs are `comment_${Date.now()}_random`), can't be queried, paginated, or deleted individually. A proper model supports pagination, deletion, and admin moderation. |
| `metadata.workflow_config` | Keep as metadata | Template-driven config that varies per task. Appropriate for JSON. |
| `metadata.workflow_type` | `workflow_type: model.text().nullable()` | Used for filtering in inventory-order routes. A column enables proper index-based queries. |
| `metadata.design_id`, `metadata.partner_id`, `metadata.role` | Remove | Redundant — these values exist on the production run record itself, and the task is already linked to the run. No code reads these from task metadata. |
| `metadata.transaction_id` | Keep on task model (already `task.transaction_id` column) | Already a proper column. Remove the duplicate write to metadata. |

### Design metadata partner keys (do NOT carry over)

The send-to-partner system stores 7 partner state keys in `design.metadata`:

- `partner_status`, `partner_phase`, `partner_started_at`, `partner_finished_at`, `partner_completed_at`, `partner_redo_at`, `assignment_notes`

**None of these should exist in the production run system.** Production runs have proper `status` and `role` columns. The convergence plan must not replicate the metadata-as-state pattern. Timestamps should be proper columns on the production run model:

```typescript
// New columns on ProductionRun model
accepted_at: model.dateTime().nullable(),
started_at: model.dateTime().nullable(),
finished_at: model.dateTime().nullable(),
completed_at: model.dateTime().nullable(),
dispatch_state: model.enum(["idle", "awaiting_templates", "completed"]).default("idle"),
dispatch_started_at: model.dateTime().nullable(),
dispatch_completed_at: model.dateTime().nullable(),
dispatch_template_names: model.json().nullable(),
```

### Migration approach

1. Add the new columns to the production run model
2. Write a migration that copies existing metadata values into the new columns
3. Update workflows and routes to read/write columns instead of metadata
4. Update the subscriber to use the `production_run ↔ task` link instead of `metadata.production_run_id`
5. Stop writing redundant keys (`design_id`, `partner_id`, `role`, `transaction_id`) to task metadata
6. Keep `metadata` for truly unstructured data (admin notes, custom tracking)

---

## To Do — Bugs / Security

### Old `/partners/tasks/` routes lack partner ownership checks

**Severity**: Medium (security)

The routes at `POST /partners/tasks/:taskId/accept` and `POST /partners/tasks/:taskId/finish` are still registered in `middlewares.ts` (lines 431-445) with partner authentication. However, they do **not** verify the task is linked to the authenticated partner — any authenticated partner can accept or finish any task by ID.

The newer `/partners/assigned-tasks/` routes do have ownership checks via `query.index` + partner link verification.

**Recommendation**: Remove the old `/partners/tasks/:taskId/accept` and `/partners/tasks/:taskId/finish` routes. The `/partners/assigned-tasks/` equivalents are the correct versions.

**Files**:
- `src/api/partners/tasks/[taskId]/accept/route.ts` — remove
- `src/api/partners/tasks/[taskId]/finish/route.ts` — remove
- `src/api/middlewares.ts` lines 431-445 — remove registrations

---

## To Do — Operational Gaps

### No admin cancel endpoint

`cancelled` is a valid status in the production run model but there is no API to transition a run to it. If a run needs to be cancelled (partner unavailable, design changed, order cancelled), there's no way to do it via the API.

**Recommendation**: Add `POST /admin/production-runs/:id/cancel` that:
- Validates the run is not already `completed` or `cancelled`
- Sets status to `cancelled`
- Cancels any pending linked tasks
- If child run, checks impact on parent/sibling runs

### No admin production runs list page

Runs are only visible as a section on the design detail page. There's no cross-design operational view.

**Recommendation**: Add `src/admin/routes/production-runs/page.tsx` — a data table with columns: Run ID, Design, Partner, Status, Quantity, Run Type, Created. Filters by status, partner, run_type. Links to detail page.

### No partner reassignment

Once a run is assigned to a partner, there's no way to move it to a different partner.

**Recommendation**: Add `POST /admin/production-runs/:id/reassign` that:
- Validates the run is in `approved` or `sent_to_partner` status
- Updates `partner_id`
- Re-links tasks to the new partner
- Cancels any pending task assignment workflows for the old partner

### `production_run.sent_to_partner` event has no subscriber

The event is emitted in `sendProductionRunToProductionWorkflow` but nothing listens. Partner gets no notification when work is assigned.

**Recommendation**: Create `src/subscribers/production-run-sent-to-partner.ts` that:
- Sends an email/notification to the partner
- Creates an admin feed entry
- This becomes more important as send-to-partner is retired

### No status change audit trail

Each `updateProductionRuns` overwrites the `status` field. Previous statuses are lost. Only `metadata.acceptance.accepted_at` and `metadata.dispatch.*` timestamps exist.

**Recommendation**: Two options:
1. **Simple**: Write `metadata.status_history` as an array of `{ status, changed_at, changed_by }` on every status update
2. **Full**: Create a `production_run_events` table for a proper audit log

### Admin detail page shows raw IDs

The production run detail page shows `partner_id` and `parent_run_id` as raw ID strings. The snapshot tab renders raw JSON in a `<pre>` tag.

**Recommendation**:
- Resolve `partner_id` to partner name
- Make `parent_run_id` a clickable link
- Format the snapshot tab with sections for design info, specs, colors, sizes

---

## To Do — Partner Experience

### Partner sees no design details

The production run detail in partner-ui shows `design_id` as a plain ID string. No design name, no specs, no colors, no sizes, no moodboard, no images.

**Recommendation**: Update `GET /partners/production-runs/:id` to include:
- `design.name`, `design.description`, `design.thumbnail_url`
- The run's `snapshot` (which already contains specs, colors, sizes)
- Design media files

Update the partner-ui detail page to render these.

### No dependency visibility for partners

Partners can't see what runs depend on theirs or what they're waiting on. The dependency chain (`depends_on_run_ids`, `parent_run_id`) is server-side only.

**Recommendation**: Add a "Related Runs" section to the partner detail page showing:
- Parent run status
- Sibling runs and their statuses (same parent)
- Dependent runs waiting on this one

### Task comments exist but aren't shown

The `GET/POST /partners/assigned-tasks/:taskId/comments` API works, but the production run task drawer in partner-ui doesn't render comments.

**Recommendation**: Add a comments section to the task drawer and the task detail page in partner-ui. This is the primary partner-to-admin communication channel.

### No progress visualization

The partner sees an activity sidebar with raw timestamps. No progress bar, no timeline, no visual indication of how far along the run is.

**Recommendation**: Add a simple progress indicator based on `completed tasks / total tasks` with a progress bar on the detail page.

---

## Priority Order

1. **Metadata → proper columns** on production run model (schema safety, queryability)
2. **Subscriber: use link instead of `metadata.production_run_id`** (reliability)
3. Remove old `/partners/tasks/` routes (security)
4. Add cancel endpoint (operational necessity)
5. Add production runs list page in admin (visibility)
6. Wire up `production_run.sent_to_partner` subscriber (partner notifications)
7. Show design details in partner-ui (partner experience)
8. Surface task comments in partner-ui (communication)
9. Remove redundant task metadata keys (`design_id`, `partner_id`, `role`)
10. Add progress visualization (partner experience)
11. Add partner reassignment (operational)
12. Add dependency visibility (partner experience)

---

## Related

- [Design Production Lifecycle](./design-production-lifecycle.md) — Overview and retirement recommendation
- [Production Run Convergence Plan](./production-run-convergence-plan.md) — Gap analysis and implementation steps
- [Send-to-Partner Migration Guide](./send-to-partner-migration.md) — Migration steps
