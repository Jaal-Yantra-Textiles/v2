---
title: "Production Run Improvements"
sidebar_label: "Improvements"
sidebar_position: 4
---

# Production Run Improvements

_Last updated: 2026-03-23_

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

1. Remove old `/partners/tasks/` routes (security)
2. Add cancel endpoint (operational necessity)
3. Add production runs list page in admin (visibility)
4. Wire up `production_run.sent_to_partner` subscriber (partner notifications)
5. Show design details in partner-ui (partner experience)
6. Surface task comments in partner-ui (communication)
7. Add status history to metadata (audit trail)
8. Add progress visualization (partner experience)
9. Add partner reassignment (operational)
10. Add dependency visibility (partner experience)

---

## Related

- [Design Production Lifecycle](./design-production-lifecycle.md) — Overview and retirement recommendation
- [Production Run Convergence Plan](./production-run-convergence-plan.md) — Gap analysis and implementation steps
- [Send-to-Partner Migration Guide](./send-to-partner-migration.md) — Migration steps
