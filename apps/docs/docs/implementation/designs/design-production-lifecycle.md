---
title: "Design Production Lifecycle"
sidebar_label: "Production Lifecycle"
sidebar_position: 1
---

# Design Production Lifecycle

_Last updated: 2026-03-26_

This document covers how designs move from creation through sampling and into production using the Production Run system.

---

## Production Runs — The Single System

Production Runs are the sole system for all partner production work, including sampling. The legacy Send-to-Partner (v1) workflow has been deprecated in the UI.

| Feature | Production Runs |
|---|---|
| **Run types** | `production` and `sample` |
| **Multi-partner** | Yes (parent + child runs with assignments) |
| **Quantities** | Yes |
| **Design snapshot** | Yes (specs, colors, sizes, inventory at creation time) |
| **Dependencies** | Yes (`depends_on_run_ids` for sequential steps) |
| **Order linking** | Yes (order_id, line_item_id, product_id, variant_id) |
| **Cost tracking** | Yes (consumption logs with unit_cost, auto-calculated design cost) |
| **Cancel** | Yes (`POST /admin/production-runs/:id/cancel`) |
| **State machine** | Explicit policy (`ProductionRunPolicy`) |

---

## Lifecycle

```
Design Created (Conceptual)
  |
  v
Design Development (In_Development -> Technical_Review -> Sample_Production)
  |
  v
Sampling --------------------------------------------------------+
  |  Create Production Run (run_type: sample)                    |
  |  quantity: 1, no order linked                                |
  |  Approve -> assign partner -> create tasks                   |
  |  Partner logs consumption (with unit_cost per item)          |
  |  Admin commits consumption logs (inventory deducted)         |
  |  Partner completes sample run                                |
  |  -> Auto-calculates design cost from consumption logs        |
  |     material_cost + 30% overhead -> design.estimated_cost    |
  +--------------------------------------------------------------+
  |
  v
Design Approved -> Commerce_Ready
  |
  v
Product Created (auto-promotion workflow)
  |
  v
Customer Orders Product (cart uses design.estimated_cost)
  |
  v
Production ----------------------------------------------------------+
  |  Production Run auto-created (order.placed)                      |
  |  Status: pending_review                                          |
  |  Admin approves with partner assignments                         |
  |  Child runs created per partner/role                             |
  |  Tasks dispatched -> partner executes                            |
  |  Partner logs consumption during production                      |
  |  Completion cascades up to parent run                             |
  +------------------------------------------------------------------+
  |
  v
Order Fulfilled
```

---

## v1 Send-to-Partner — Deprecated

The legacy Send-to-Partner workflow has been **deprecated in the UI** as of 2026-03-26.

### What was removed from UI
- **Admin**: "Send" button removed from partner section, batch send drawer removed from designs list
- **Partner UI**: DesignActionsSection removed (Start/Finish/Redo/Refinish/Complete buttons)

### What remains (for in-flight workflows)
- **Backend endpoints**: All v1 partner action endpoints still work (`/partners/designs/:id/start`, `/finish`, `/redo`, `/refinish`, `/complete`) with a cancelled guard
- **Cancel endpoint**: `POST /admin/designs/:id/cancel-partner-assignment` — cancels the workflow transaction, resets design metadata, optionally unlinks the partner
- **Partner route pages**: `design-start` and `design-complete` routes still registered (won't break bookmarks)

### Transition flow
1. Admin clicks "Cancel" on the v1 assignment badge in the partner section
2. Workflow transaction cancelled, v1 tasks cancelled, metadata reset
3. Partner is still linked (unless `unlink: true`)
4. Admin creates a new Production Run for the same partner
5. Partner sees the production run in their design detail page

---

## Production Run Cancel

### Cancel a run
```
POST /admin/production-runs/:id/cancel
{ "reason": "optional reason text" }
```

- Sets status to `cancelled`, cancels all linked tasks
- Cascades to child runs if cancelling a parent
- Auto-cancels parent if all siblings are terminal
- Blocks cancel on completed runs
- Idempotent on already-cancelled runs

### Cancel v1 assignment
```
POST /admin/designs/:id/cancel-partner-assignment
{ "partner_id": "...", "unlink": false }
```

- Cancels workflow transaction (marks async gates as failed)
- Cancels all v1 tasks
- Records `partner_assignment_cancelled_at` in metadata
- Partner actions blocked with 400 "cancelled" error

---

## Cost Estimation from Sampling

When a **sample production run** completes, the design's cost is auto-calculated from consumption logs.

### Cost resolution priority
1. `consumption_log.unit_cost` — partner input at log time
2. `raw_material.unit_cost` — admin-set or backfilled from order history
3. `0` — no cost data available

### Auto-calculation (subscriber on `production_run.completed`)
```
Material cost = Sum(log.quantity x resolved_unit_cost)
Production cost = material_cost x 30% overhead
estimated_cost = material_cost + production_cost
```

Results written to proper design columns:
- `design.estimated_cost` — total
- `design.material_cost` — sum of material costs
- `design.production_cost` — overhead amount
- `design.cost_breakdown` — JSON with per-item details, sources, timestamp

### Manual backfill script
```bash
# Backfill raw_material.unit_cost from inventory order line history
npx medusa exec src/scripts/backfill-inventory-unit-cost.ts -- --dry-run
npx medusa exec src/scripts/backfill-inventory-unit-cost.ts

# Calculate design cost from committed consumption logs
npx medusa exec src/scripts/calculate-sample-cost.ts -- --design_id=01KE6E3NY88RB64J6D1CCT0E0C
npx medusa exec src/scripts/calculate-sample-cost.ts -- --all-samples
```

---

## Currency Conversion

When a design is converted to a cart in a different currency than the store default, prices are automatically converted using the Frankfurter API (ECB rates).

- Conversion step in `createDraftOrderFromDesignsWorkflow`
- Same conversion in store checkout (`POST /store/custom/designs/:id/checkout`)
- Original price + currency stored in line item metadata for audit

---

## Partner UI Features

### Design List
- Pre-filtered to show **active designs only** (excludes completed, cancelled)
- Work Status dropdown filter (Incoming, Assigned, In Progress, Finished, Completed, Cancelled)
- Sorted by most recently updated
- Priority column with colored badges
- Relative date format ("3h ago", "2d ago")

### Design Detail
- **Production section** (top of main): progress stepper, single primary action button, inline tasks with subtask checkboxes
- **Consumption logs**: unit_cost input, auto-resolved partner location
- **Cancelled runs**: dimmed with error message, action buttons hidden
- **Cancelled v1 assignments**: status "cancelled", all actions blocked

### Inventory & Stock
- Partner-scoped stock locations (`/partners/stores/:id/locations`)
- Partner-scoped reservations (`/partners/reservations`)
- Auto-linked inventory levels at partner location on product creation
- Location names resolved in inventory detail via stock location service

---

## Auto-Assignment

When creating a production run **without explicit assignments** but **with a quantity**, the system auto-populates assignments from linked partners:

- 1 partner: full quantity assigned
- N partners: quantity split equally (last partner gets remainder)
- `template_names` from the request body are applied to each assignment

---

## Key Files

### Production Runs

| File | Purpose |
|------|---------|
| `src/modules/production_runs/models/production-run.ts` | Data model (run_type: production/sample) |
| `src/modules/production_policy/service.ts` | State machine and validation |
| `src/workflows/production-runs/create-production-run.ts` | Create with snapshot |
| `src/workflows/production-runs/send-production-run-to-production.ts` | Task creation + partner dispatch |
| `src/api/admin/production-runs/[id]/cancel/route.ts` | Cancel endpoint |
| `src/api/admin/designs/[id]/production-runs/route.ts` | Create with auto-assignment |
| `src/api/partners/production-runs/[id]/complete/route.ts` | Complete with consumption |
| `src/subscribers/sample-run-completed.ts` | Auto cost calculation |
| `src/scripts/calculate-sample-cost.ts` | Manual cost calculation |
| `src/scripts/backfill-inventory-unit-cost.ts` | Backfill raw_material costs from orders |

### Cost & Consumption

| File | Purpose |
|------|---------|
| `src/modules/consumption_log/models/consumption-log.ts` | Log model (unit_cost field) |
| `src/modules/raw_material/models/raw_material.ts` | Raw material model (unit_cost, cost_currency) |
| `src/modules/designs/models/design.ts` | Design model (material_cost, production_cost, cost_breakdown) |
| `src/workflows/consumption-logs/log-consumption.ts` | Log workflow |
| `src/workflows/consumption-logs/commit-consumption.ts` | Commit workflow (inventory deduction) |

### v1 Legacy (deprecated UI, backend retained)

| File | Purpose |
|------|---------|
| `src/api/admin/designs/[id]/send-to-partner/route.ts` | v1 send endpoint (backend only) |
| `src/api/admin/designs/[id]/cancel-partner-assignment/route.ts` | Cancel v1 assignment |
| `src/workflows/designs/send-to-partner.ts` | v1 workflow (23-day timeout) |

---

## Related

- [Production Run Convergence Plan](./production-run-convergence-plan.md) — Gap analysis and implementation steps
- [Send-to-Partner Migration Guide](./send-to-partner-migration.md) — In-flight workflow handling
- [Ad Planning Usage Guide](../../guides/ad-planning/usage-guide.md) — Design-to-cart flow
- [Partner Portal API Scoping](../partner-portal/api-scoping.md) — Partner endpoint conventions
