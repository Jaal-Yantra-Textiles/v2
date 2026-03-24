---
title: "Design Production Lifecycle"
sidebar_label: "Production Lifecycle"
sidebar_position: 1
---

# Design Production Lifecycle

_Last updated: 2026-03-23_

This document covers how designs move from creation through sampling and into production, and the recommendation to consolidate two overlapping systems into one.

---

## Two Systems, One Purpose

The codebase currently has two mechanisms for assigning designs to manufacturing partners:

| | Send-to-Partner | Production Runs |
|---|---|---|
| **Trigger** | Manual admin action | Auto on `order.placed` or manual |
| **Endpoint** | `POST /admin/designs/:id/send-to-partner` | `POST /admin/designs/:id/production-runs` |
| **Multi-partner** | No (single partner) | Yes (parent + child runs with assignments) |
| **Quantities** | No | Yes |
| **Design snapshot** | No | Yes (specs, colors, sizes, inventory at creation time) |
| **Dependencies** | No | Yes (`depends_on_run_ids` for sequential steps) |
| **Redo loops** | Yes (async await cycle) | Via task completion subscriber |
| **Order linking** | No | Yes (order_id, line_item_id, product_id, variant_id) |
| **State machine** | Implicit (workflow steps) | Explicit policy (`ProductionRunPolicy`) |

Both systems ultimately do the same thing: link a design to a partner, create tasks, and wait for the partner to complete work.

---

## Recommendation: Retire Send-to-Partner

**Production Runs should be the single system for all partner production work**, including sampling.

### Why

1. **Send-to-Partner is the v1 approach.** It was built before Production Runs existed. Production Runs are a superset — they do everything Send-to-Partner does, plus snapshots, quantities, multi-partner assignments, dependency ordering, and order linkage.

2. **Sampling fits naturally into Production Runs.** A sampling run is just a production run with `quantity: 1` (or a small batch) and no linked order. The snapshot captures the design state at the time of sampling, which is exactly what you want for audit and reproducibility.

3. **One workflow to maintain.** Two parallel systems means two sets of task templates, two notification flows, two partner UIs, and two sets of tests. Consolidating reduces maintenance burden.

4. **The first production goes to the customer, the rest stay internal.** This business flow maps cleanly to Production Runs: the order-triggered run fulfils the customer order, and any subsequent runs (re-orders, bulk production) are created manually or via future automation — all through the same system.

### Migration path

Send-to-Partner is currently in use by some designs. The retirement should be gradual:

1. **Phase 1 — Parity check.** Ensure Production Runs support the redo/revision cycle that Send-to-Partner has (async await for redo → refinish). The task completion subscriber already handles most of this, but the explicit redo loop with design status reset to `In_Development` needs to be ported.

2. **Phase 2 — Sampling via Production Runs.** Add a `run_type` or use metadata to distinguish sampling runs from production runs. A sampling run would be:
   - Created manually from the design detail page
   - `quantity: 1` (or configurable)
   - No linked order
   - Same partner assignment and task flow as production

3. **Phase 3 — Deprecate Send-to-Partner.** Mark the endpoint as deprecated, remove the admin UI entry points (batch send drawer, single send action), and update partner portal to use the Production Runs hub exclusively.

4. **Phase 4 — Remove.** After confirming no active workflows reference the old `send-design-to-partner` workflow transaction IDs, remove the workflow, route, and validators.

---

## Unified Lifecycle

With consolidation, the design production lifecycle becomes:

```
Design Created (Conceptual)
  │
  ▼
Design Development (In_Development → Technical_Review → Sample_Production)
  │
  ▼
Sampling ─────────────────────────────────────────────┐
  │  Create Production Run (run_type: sample)         │
  │  quantity: 1, no order linked                     │
  │  Approve → assign partner → create tasks          │
  │  Partner completes sample                         │
  │  Revision if needed (redo cycle)                  │
  ├──────────────────────────────────────────────────┘
  ▼
Design Approved → Commerce_Ready
  │
  ▼
Product Created (auto-promotion workflow)
  │
  ▼
Customer Orders Product
  │
  ▼
Production ───────────────────────────────────────────┐
  │  Production Run auto-created (order.placed)       │
  │  Status: pending_review                           │
  │  Admin approves with partner assignments          │
  │  Child runs created per partner/role              │
  │  Tasks dispatched → partner executes              │
  │  Completion cascades up to parent run             │
  ├──────────────────────────────────────────────────┘
  ▼
Order Fulfilled
```

---

## Key Files

### Send-to-Partner (to be retired)

| File | Purpose |
|------|---------|
| `src/api/admin/designs/[id]/send-to-partner/route.ts` | API endpoint |
| `src/api/admin/designs/[id]/send-to-partner/validators.ts` | Zod schema |
| `src/workflows/designs/send-to-partner.ts` | Workflow (23-day timeout, redo loop) |
| `src/admin/components/designs/batch-send-to-partner-drawer.tsx` | Batch send UI |
| `src/admin/hooks/api/designs.ts` | `useSendDesignToPartner` hook |

### Production Runs (the target system)

| File | Purpose |
|------|---------|
| `src/modules/production_runs/models/production-run.ts` | Data model |
| `src/modules/production_policy/service.ts` | State machine and validation |
| `src/workflows/production-runs/create-production-run.ts` | Create with snapshot |
| `src/workflows/production-runs/approve-production-run.ts` | Approve + child run creation |
| `src/workflows/production-runs/send-production-run-to-production.ts` | Task creation + partner dispatch |
| `src/workflows/production-runs/dispatch-production-run.ts` | Async dispatch with template selection |
| `src/workflows/production-runs/accept-production-run.ts` | Partner acceptance |
| `src/subscribers/production-run-task-updated.ts` | Auto-completion + dependency triggering |
| `src/subscribers/order-placed.ts` | Auto-creation from orders |
| `src/api/admin/production-runs/` | Admin CRUD + dispatch endpoints |
| `src/api/partners/production-runs/` | Partner endpoints |

---

## Related

- [Production Run Convergence Plan](./production-run-convergence-plan.md) — Detailed gap analysis, new API surface, and implementation steps
- [Send-to-Partner Migration Guide](./send-to-partner-migration.md) — In-flight workflow handling, data migration, and cleanup checklist
- [Production Run Improvements](./production-run-improvements.md) — Bugs fixed and improvements backlog
- [Production Status and Next Steps](../../reference/status/production-status.md) — Current implementation status
- [Design to Draft Product](../../guides/media/design-to-product.md) — Commerce Ready promotion workflow
