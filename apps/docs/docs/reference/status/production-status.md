---
title: "Production Runs: Status and Next Steps"
sidebar_label: "Production Status"
sidebar_position: 1
---

# Production Runs: Status and Next Steps

## What we achieved (backend)

### 1) Order placed → ProductionRuns (auto-create)
- On `order.placed`, the backend now creates `production_runs` based on order line items.
- It resolves `product_id → design_id` through the existing `product_design` link.
- It stores provenance on the run:
  - `order_id`
  - `order_line_item_id`
  - `product_id`
  - `variant_id`
  - `quantity`
  - plus `metadata.source = "order.placed"`
- Idempotency: if a `production_runs` row already exists for `order_line_item_id`, it will not create duplicates.

Integration test:
- `integration-tests/http/order-placed-production-runs.spec.ts`

### 2) Multi-partner selection (manual production allocation)
A new admin endpoint exists for allocating production across partners and roles:

- `POST /admin/designs/:id/production-runs`
  - Creates a parent production run for a design.
  - If `assignments` are provided, it approves the parent and creates approved child runs:
    - `parent_run_id`
    - `partner_id`
    - `role` (optional)
    - `quantity`

Integration test:
- `integration-tests/http/design-production-runs-multi-partner.spec.ts`

### 3) Fix applied: order confirmation workflow retrieval
- `send-order-confirmation-email` workflow previously attempted to retrieve `relations: ["customer", "items"]`.
- In Medusa v2, cross-module relations cannot be loaded this way.
- Fixed to retrieve only `relations: ["items"]`.


## Current state of core concepts

### Designs
- Primary use: sampling, revisions, partner design workflow (`send-to-partner`, redo loops).
- Partner access pattern today: partner must be linked to design (design-partner link) to view it through `GET /partners/designs`.

### ProductionRuns
- Primary use: actual production execution.
- Supports:
  - order-driven creation (`order.placed`)
  - manual design-driven allocation (multi-partner assignments)
  - child-run splitting for multiple partners/roles

### Tasks
- Task templates exist with categories.
- `sendProductionRunToProductionWorkflow` can create tasks for a run and link tasks to:
  - `production_run`
  - `partner`
  - `design`
- Partner interaction with work today is primarily via tasks.


## What still needs to be implemented (next steps)

### A) Dispatch workflow with dynamic template selection (pause/resume)
Goal: for each child run, start a workflow that pauses until an admin selects templates.

Requirements:
- Dispatch should be per child run.
- Admin should be able to specify either:
  - template category, or
  - explicit template names

Proposed shape:
- A new workflow (example name): `dispatch-production-run`
  - retrieve run
  - `await-template-selection` (async/pause)
  - resolve templates (by category or names)
  - create tasks + link + notify partner

New admin endpoints (suggested):
- `POST /admin/production-runs/:id/dispatch` (starts + pauses)
- `POST /admin/production-runs/:id/dispatch/confirm` (resumes with templates/category)

### B) Partner Production Runs hub (separate from designs)
Goal: partners should see production runs as a first-class concept (not via design assignment).

Suggested partner endpoints:
- `GET /partners/production-runs` (list runs for authenticated partner)
- `GET /partners/production-runs/:id` (details + tasks)
- Optional:
  - `POST /partners/production-runs/:id/start`
  - `POST /partners/production-runs/:id/complete`

### C) Production gating and triggers
Goal: formalize when a run is auto-sent vs requires manual review.

Expected policy:
- `order.placed` creates runs as `pending_review`.
- `Commerce_Ready` designs may be eligible for auto-dispatch if:
  - partner routing is deterministic
  - template selection is available (or workflow pauses until selected)

### D) UI/UX mapping (high level)
- Designs UI: sampling + partner design workflows.
- Production runs UI: operational hub for dispatch, templates, progress.
- Partners: a production hub view + task execution.


## Notes / assumptions
- ProductionRun model includes: `status`, `quantity`, `parent_run_id`, `role`, `design_id`, `partner_id`, `order_id`, `order_line_item_id`, `snapshot`, `captured_at`, `metadata`.
- Task templates support categories; category-based selection is preferred for dynamic template routing.
