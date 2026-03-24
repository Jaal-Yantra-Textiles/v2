---
title: "Send-to-Partner Migration Guide"
sidebar_label: "Migration Guide"
sidebar_position: 3
---

# Send-to-Partner Migration Guide

_Last updated: 2026-03-24_

This document covers how to migrate from the `send-to-partner` design workflow to Production Runs.

The approach is straightforward: mark all existing send-to-partner workflows as finished, deprecate the API, then move everything to production runs.

---

## What Exists Today

Each send-to-partner assignment creates these data artifacts:

| Artifact | Location |
|---|---|
| Design↔Partner link | `design_partner` link table |
| 4–7 Task records | `task` table (start, redo, finish, completed + redo children) |
| Design↔Task links | `design_task` link table |
| `transaction_id` on tasks | `task.transaction_id` column |
| Partner state on design | `design.metadata` (`partner_status`, `partner_phase`, timestamps) |
| Design status changes | `design.status` (In_Development → Technical_Review → Approved) |
| Inventory consumption | `design_inventory_item` link extra columns + `consumption_log` records |
| Workflow engine transaction | Medusa workflow engine storage (`store: true`) |

---

## Migration Steps

### Step 1 — Mark all in-flight workflows as finished

Find all active send-to-partner workflows:

```sql
SELECT DISTINCT t.transaction_id, t.title, t.status, t.created_at,
       t.metadata->>'design_id' as design_id,
       t.metadata->>'partner_id' as partner_id
FROM task t
WHERE t.transaction_id IS NOT NULL
  AND t.metadata->>'workflow_type' = 'partner_design_assignment'
  AND t.status != 'completed'
  AND t.status != 'cancelled'
ORDER BY t.created_at DESC;
```

For each in-flight workflow, fast-forward all async gates to completion:

```typescript
import { Modules } from "@medusajs/framework/utils"
import { TransactionHandlerType } from "@medusajs/framework/orchestration"

async function finishDesignWorkflow(container, transactionId: string) {
  const engineService = container.resolve(Modules.WORKFLOW_ENGINE)
  const workflowId = "send-design-to-partner"

  // Signal success on all remaining gates
  for (const stepId of [
    "await-design-start",
    "await-design-finish",
    "await-design-inventory",
    "await-design-completed",
  ]) {
    try {
      await engineService.setStepSuccess({
        idempotencyKey: {
          action: TransactionHandlerType.INVOKE,
          transactionId,
          stepId,
          workflowId,
        },
      })
    } catch (e) {
      // Step already completed or not yet reached — safe to ignore
    }
  }

  // Fail the redo gates (skip them)
  for (const stepId of ["await-design-redo", "await-design-refinish"]) {
    try {
      await engineService.setStepFailure({
        idempotencyKey: {
          action: TransactionHandlerType.INVOKE,
          transactionId,
          stepId,
          workflowId,
        },
      })
    } catch (e) {
      // Safe to ignore
    }
  }
}
```

Then mark the design and its tasks as completed:

```typescript
async function markDesignCompleted(container, designId: string) {
  const designService = container.resolve("designs")
  const taskService = container.resolve("tasks")
  const query = container.resolve("query")

  // Update design status and metadata
  await designService.updateDesigns({
    id: designId,
    status: "Approved",
    metadata: {
      partner_status: "completed",
      partner_completed_at: new Date().toISOString(),
      migration_note: "fast-forwarded during send-to-partner retirement",
    },
  })

  // Complete all pending partner tasks
  const { data: [design] } = await query.graph({
    entity: "designs",
    filters: { id: designId },
    fields: ["tasks.*"],
  })

  const pendingTasks = design.tasks?.filter(
    (t) => t.status !== "completed" && t.status !== "cancelled"
  ) || []

  for (const task of pendingTasks) {
    await taskService.updateTasks({
      id: task.id,
      status: "completed",
      completed_at: new Date(),
      transaction_id: null,
    })
  }
}
```

:::info
This doesn't trigger compensation handlers (unlike `engineService.cancel()`), so the design-partner links and all existing data stay intact.
:::

### Step 2 — Deprecate the send-to-partner API

Replace the route handler with a deprecation notice:

```typescript
// src/api/admin/designs/[id]/send-to-partner/route.ts
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  throw new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    "send-to-partner is deprecated. Use POST /admin/designs/:id/production-runs instead."
  )
}
```

Remove admin UI entry points:
- Remove "Send to Partner" button from design detail page
- Remove batch send drawer (`src/admin/components/designs/batch-send-to-partner-drawer.tsx`)

### Step 3 — Move to Production Runs

All new partner work goes through production runs. For sampling:

- Admin creates a production run from the design detail page with `run_type: "sample"`, `quantity: 1`
- Admin approves with partner assignment
- Admin dispatches with task templates
- Partner works through the production run lifecycle

For designs that were previously assigned via send-to-partner and need continued work, create a replacement production run:

```typescript
await createProductionRunWorkflow(scope).run({
  input: {
    design_id: design.id,
    partner_id: originalPartnerId,
    quantity: 1,
    run_type: "sample",
    metadata: {
      migrated_from: "send-to-partner",
    },
  },
})
```

### Step 4 — Move to new Production Run system

Once the [Convergence Plan](./production-run-convergence-plan.md) is implemented (lifecycle workflow, partner milestone endpoints, consumption logs, media), the production run system fully replaces everything send-to-partner did.

At this point, remove the old code:

**API routes to remove:**
```
src/api/admin/designs/[id]/send-to-partner/
src/api/partners/designs/[designId]/start/
src/api/partners/designs/[designId]/finish/
src/api/partners/designs/[designId]/redo/
src/api/partners/designs/[designId]/refinish/
src/api/partners/designs/[designId]/complete/
src/api/partners/designs/[designId]/consumption-logs/
src/api/partners/designs/[designId]/media/
```

Keep `GET /partners/designs` and `GET /partners/designs/:id` as read-only for backward compatibility until partners have fully transitioned.

**Workflows to remove:**
```
src/workflows/designs/send-to-partner.ts
```

Keep `src/workflows/designs/design-steps.ts` — remove only the `cancelWorkflowTransactionWorkflow` (hardcoded to send-to-partner).

**Admin UI to remove:**
```
src/admin/components/designs/batch-send-to-partner-drawer.tsx
```

Remove `useSendDesignToPartner` hook from `src/admin/hooks/api/designs.ts`.

**Partner UI to remove:**
```
apps/partner-ui/src/routes/designs/
apps/partner-ui/src/hooks/api/partner-designs.tsx
```

Remove Designs nav item from partner-ui sidebar.

**Optional cleanup — design metadata:**

```sql
UPDATE design
SET metadata = metadata
  - 'partner_status'
  - 'partner_phase'
  - 'partner_started_at'
  - 'partner_finished_at'
  - 'partner_completed_at'
  - 'partner_redo_at'
  - 'assignment_notes'
WHERE metadata ? 'partner_status';
```

**Optional cleanup — task transaction IDs:**

```sql
UPDATE task
SET transaction_id = NULL
WHERE metadata->>'workflow_type' = 'partner_design_assignment'
  AND transaction_id IS NOT NULL;
```

---

## Data Mapping Reference

| Send-to-Partner | Production Run equivalent |
|---|---|
| Design↔Partner link | `production_run.partner_id` |
| `design.metadata.partner_status` | `production_run.status` |
| `design.metadata.partner_started_at` | `production_run.metadata.acceptance.accepted_at` |
| `design.metadata.partner_finished_at` | Run metadata `finished_at` |
| `design.metadata.partner_completed_at` | Run completion timestamp |
| `design.metadata.partner_phase` | Run metadata `phase` |
| `design.metadata.assignment_notes` | Run metadata `notes` |
| Design status mutations | Lifecycle workflow updates design status when `run_type === "sample"` |
| 4 task templates (partner-design-*) | Task templates selected at dispatch (configurable) |
| Consumption logs with `design_id` | Consumption logs with `production_run_id` |

| `design.metadata.partner_status` | `production_run.status` |
|---|---|
| `"incoming"` / `"assigned"` | `"sent_to_partner"` |
| `"in_progress"` | `"in_progress"` |
| `"finished"` | `"in_progress"` (with `metadata.finished_at`) |
| `"completed"` | `"completed"` |

---

## Checklist

- [ ] In-flight workflows identified (SQL query)
- [ ] All in-flight workflows fast-forwarded (Step 1)
- [ ] Designs and tasks marked as completed (Step 1)
- [ ] Send-to-partner route deprecated (Step 2)
- [ ] Admin UI entry points removed (Step 2)
- [ ] Replacement production runs created for designs needing continued work (Step 3)
- [ ] Convergence plan implemented — lifecycle workflow, partner endpoints (Step 4)
- [ ] Old routes, workflows, and UI removed (Step 4)
- [ ] Design metadata cleaned up (optional)
- [ ] Task transaction_ids cleaned up (optional)

---

## Related

- [Design Production Lifecycle](./design-production-lifecycle.md) — Overview and retirement recommendation
- [Production Run Convergence Plan](./production-run-convergence-plan.md) — Gap analysis and implementation steps
- [Production Status and Next Steps](../../reference/status/production-status.md) — Current implementation status
