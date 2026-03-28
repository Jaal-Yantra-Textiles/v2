---
title: "Production Cost Tracking"
sidebar_label: "Cost Tracking"
sidebar_position: 3
---

# Production Cost Tracking

_Last updated: 2026-03-28_

This document covers how costs are captured, calculated, and surfaced across the design production lifecycle — from task-level service costs through material consumption to the final design price estimate.

---

## Cost Architecture Overview

Design cost consists of three components:

```
Design Estimated Cost = Material Cost + Service Cost + Partner Overhead

Material Cost   = Σ(consumption_log.quantity × unit_cost)
                  Sources: partner_input > raw_material.unit_cost > 0

Service Cost    = Σ(task.actual_cost || task.estimated_cost)
                  From completed tasks linked to the production run

Partner Overhead = partner_cost_estimate (lump sum)
                   OR service cost aggregation
                   OR 30% of material cost (fallback)
```

### Cost Priority Chain

When calculating `design.production_cost`, the system uses the first available source:

| Priority | Source | When Used |
|----------|--------|-----------|
| 1 | `partner_cost_estimate` | Partner provides a lump sum at run completion |
| 2 | `Σ(task costs)` | Individual task costs aggregated from completed tasks |
| 3 | `30% overhead` | Fallback when no other cost data exists |

---

## Data Models

### Production Run — Cost & Yield Fields

```
production_runs:
  partner_cost_estimate  float    nullable   Partner's total/per-unit charge
  cost_type              enum     nullable   "per_unit" | "total"
  produced_quantity       float    nullable   Good pieces produced
  rejected_quantity       float    nullable   Pieces that failed QC
  rejection_reason        text     nullable   Enum: stitching_defect, fabric_flaw,
                                              color_mismatch, sizing_error,
                                              print_defect, material_damage,
                                              quality_below_standard, other
  rejection_notes         text     nullable   Freeform detail
```

When `cost_type` is `"per_unit"`, the API normalizes to total:
`stored_cost = per_unit_cost × produced_quantity`

### Task — Cost Fields

```
task:
  estimated_cost   float   nullable   Inherited from template at creation
  actual_cost      float   nullable   Entered by partner when finishing task
  cost_currency    text    nullable   e.g. "inr", "usd"
  cost_type        enum    nullable   "per_unit" | "total"
```

### Task Template — Default Costs

```
task_template:
  estimated_cost   float   nullable   Default cost for this type of work
  cost_currency    text    nullable   Currency for the estimated cost
```

When tasks are created from templates via `createTaskWithTemplates`, the `estimated_cost` and `cost_currency` are automatically copied from the template to the task.

### Design — Cost Summary Fields

```
design:
  estimated_cost     bigNumber   nullable   Total estimated cost
  material_cost      bigNumber   nullable   Sum of material consumption costs
  production_cost    bigNumber   nullable   Partner/service/overhead cost
  cost_breakdown     json        nullable   Structured breakdown (see below)
  cost_currency      text        nullable   Currency code
```

### Consumption Log — Per-Item Cost

```
consumption_log:
  quantity           float                  Amount consumed
  unit_cost          float       nullable   Cost per unit at time of consumption
  unit_of_measure    enum                   Meter, Yard, Kilogram, etc.
  consumption_type   enum                   sample, production, wastage
  is_committed       boolean                Whether inventory has been deducted
```

---

## Cost Flow — Step by Step

### 1. Admin Sets Up Task Templates with Costs

```
POST /admin/task-templates
{
  "name": "Embroidery",
  "estimated_cost": 200,
  "cost_currency": "inr",
  ...
}
```

Each template represents a type of work (embroidery, printing, cutting, button attachment) with a default cost estimate.

### 2. Production Run Created — Tasks Inherit Costs

When a production run is dispatched to a partner, tasks are created from templates:

```
Template (estimated_cost: 200) → Task (estimated_cost: 200)
Template (estimated_cost: 50)  → Task (estimated_cost: 50)
```

### 3. Partner Works — Logs Consumption During Production

Partners log material usage at any time during production via the Material Usage section:

```
POST /partners/designs/:id/consumption-logs
{
  "inventoryItemId": "inv_xxx",
  "quantity": 18.5,
  "unitCost": 120,
  "unitOfMeasure": "Meter",
  "consumptionType": "production"
}
```

Logs are created with `is_committed: false` and committed separately (which deducts inventory).

### 4. Partner Finishes Tasks — Enters Actual Cost

When completing a task, the partner can enter their actual cost:

```
POST /partners/tasks/:taskId/finish
{
  "actual_cost": 180,
  "cost_type": "total"
}
```

This allows tracking estimated vs actual cost per work item.

### 5. Partner Completes Production Run — Output & Cost

The completion form collects (in order):

1. **Output**: produced_quantity, rejected_quantity, rejection_reason
2. **Cost**: partner_cost_estimate with per_unit/total toggle
3. **Materials**: additional consumption entries (if not already logged)
4. **Notes**: completion notes

```
POST /partners/production-runs/:id/complete
{
  "produced_quantity": 7,
  "rejected_quantity": 2,
  "rejection_reason": "stitching_defect",
  "rejection_notes": "Thread pull on collar area",
  "partner_cost_estimate": 500,
  "cost_type": "per_unit",
  "consumptions": [...],
  "notes": "Batch completed"
}
```

Per-unit cost is auto-normalized: `500 × 7 = 3500` stored as total.

### 6. System Calculates Design Cost (Sample Runs Only)

When a **sample** production run completes, the `sample-run-completed` subscriber fires:

```
Material Cost  = Σ(committed consumption logs × unit_cost)
Service Cost   = Σ(task.actual_cost || task.estimated_cost)
Production Cost = partner_estimate > service_cost > 30% overhead
Total          = Material Cost + Production Cost
```

Result is written to `design.estimated_cost`, `design.material_cost`, `design.production_cost`, and `design.cost_breakdown`.

The `cost_breakdown` JSON structure:

```json
{
  "items": [
    {
      "inventory_item_id": "inv_xxx",
      "title": "Cotton Fabric",
      "quantity": 18.5,
      "unit_cost": 120,
      "line_total": 2220,
      "cost_source": "partner_input"
    }
  ],
  "service_costs": [
    {
      "task_id": "task_xxx",
      "title": "Embroidery",
      "estimated_cost": 200,
      "actual_cost": 180,
      "cost_used": 180,
      "cost_source": "actual"
    }
  ],
  "service_cost_total": 180,
  "production_cost_source": "task_costs",
  "calculated_at": "2026-03-28T12:00:00Z",
  "source": "sample_consumption",
  "production_run_id": "prod_run_xxx"
}
```

### 7. Checkout Pricing

The `estimateDesignCostWorkflow` runs when creating a draft order or adding a design to cart. It reads `design.estimated_cost` as the base price and applies currency conversion if needed.

---

## Yield Tracking

Production runs track output quality:

| Metric | Source | Calculation |
|--------|--------|-------------|
| **Ordered** | `production_run.quantity` | Set at creation |
| **Produced** | `production_run.produced_quantity` | Partner enters at completion |
| **Rejected** | `production_run.rejected_quantity` | Auto-calculated or manually entered |
| **Yield %** | Derived | `produced / ordered × 100` |
| **Per-unit cost** | Derived | `total_cost / produced_quantity` |

Rejection reasons are categorized:
- `stitching_defect`, `fabric_flaw`, `color_mismatch`, `sizing_error`
- `print_defect`, `material_damage`, `quality_below_standard`, `other`

---

## Scripts

### `calculate-sample-cost.ts`

Manual cost calculation from committed consumption logs + task costs:

```bash
# Single design
npx medusa exec src/scripts/calculate-sample-cost.ts -- --design_id=xxx

# From a production run
npx medusa exec src/scripts/calculate-sample-cost.ts -- --production_run_id=xxx

# All designs with completed sample runs
npx medusa exec src/scripts/calculate-sample-cost.ts -- --all-samples
```

### `backfill-inventory-unit-cost.ts`

Backfills `raw_material.unit_cost` from inventory order line history for items that don't have a cost set.

---

## API Endpoints

### Partner Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/partners/production-runs/:id/complete` | Complete with yield + cost + consumptions |
| POST | `/partners/tasks/:taskId/finish` | Finish task with optional actual_cost |
| POST | `/partners/assigned-tasks/:taskId/finish` | Same, with partner ownership verification |
| POST | `/partners/designs/:id/consumption-logs` | Log material consumption |
| GET | `/partners/designs/:id/consumption-logs` | List consumption logs |

### Admin Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/admin/task-templates` | Create template with estimated_cost |
| PUT | `/admin/task-templates/:id` | Update template (including cost) |
| GET | `/admin/production-runs/:id` | View run with yield/cost/task data |

---

## Partner UI — Production Section

The production section in the partner design detail view includes:

### Stage Guidance
Each stage shows contextual help text explaining what the partner should do next. Sample runs get additional emphasis on material tracking.

### Progress Stepper
Five steps: Received → Accepted → Started → Finished → Completed
(Partner-centric labels — "Received" not "Sent")

### Complete Form (Output-First Flow)

1. **Output** — Good pieces produced + rejected with yield % badge (green ≥90%, orange ≥70%, red <70%). Auto-calculates rejected from ordered - produced. Rejection reason dropdown + notes.

2. **Cost** — Per-piece / total toggle with live cost summary. Shows derived per-unit or total calculation.

3. **Materials** — Shows count of already-logged entries. "Log additional" button reveals form only when needed (not forced to re-enter).

4. **Notes** — Completion notes.

### Task Cost Entry
When finishing a task, the partner sees the estimated cost (from template) and can enter their actual cost. "Skip" button allows finishing without entering cost.

### After Completion
- Yield summary: ordered → produced → rejected → yield %
- Cost breakdown: cost type (per unit/total) with calculation
- Material summary: top 5 consumption entries
- Submitted notes (finish + completion)

### Timeline
Dot + line timeline (Medusa pattern) with timestamps, durations between steps, and tooltips showing full dates.

---

## Files Index

| File | Purpose |
|------|---------|
| `src/modules/production_runs/models/production-run.ts` | Production run model with yield + cost fields |
| `src/modules/tasks/models/task.ts` | Task model with estimated_cost, actual_cost |
| `src/modules/tasks/models/tasktemplate.ts` | Task template with estimated_cost |
| `src/modules/tasks/service.ts` | `createTaskWithTemplates` — cost inheritance |
| `src/modules/consumption_log/models/consumption-log.ts` | Consumption log with unit_cost |
| `src/api/partners/production-runs/[id]/complete/route.ts` | Complete endpoint with yield + cost |
| `src/api/partners/tasks/[taskId]/finish/route.ts` | Task finish with actual_cost |
| `src/api/partners/assigned-tasks/[taskId]/finish/route.ts` | Verified task finish with cost |
| `src/api/admin/task-templates/validators.ts` | Zod schema with cost fields |
| `src/workflows/task-templates/create-template.ts` | Template creation workflow |
| `src/workflows/tasks/update-task.ts` | Task update with cost fields |
| `src/subscribers/sample-run-completed.ts` | Auto-calculates design cost from logs + tasks |
| `src/scripts/calculate-sample-cost.ts` | Manual cost calculation script |
| `src/workflows/designs/estimate-design-cost.ts` | Checkout pricing estimation |
| `apps/partner-ui/.../design-production-section.tsx` | Partner production UI |
| `src/admin/routes/production-runs/[id]/page.tsx` | Admin production run detail |
| `src/admin/components/creates/create-task-template.tsx` | Admin template create form |

---

## Related Docs

- [Production Lifecycle](./design-production-lifecycle.md) — Full lifecycle from design creation to completion
- [Production Run Improvements](./production-run-improvements.md) — Improvement history
