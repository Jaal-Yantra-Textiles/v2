---
title: "Design & Production — Changelog (March 2026)"
sidebar_label: "Changelog"
sidebar_position: 10
---

# Design & Production — Changelog (March 2026)

Major overhaul covering production run improvements, v1 deprecation, cost estimation, partner UI enhancements, currency conversion, and inventory management fixes.

---

## Currency Conversion for Design-to-Cart

**Problem**: When a design estimated in INR was sent as a cart in EUR, the price was copied as-is (4000 INR became 4000 EUR).

**Fix**: Added `convertEstimateCurrencyStep` to the draft order workflow. Uses Frankfurter API (ECB rates) for live conversion. Original price stored in line item metadata.

- `src/workflows/designs/create-draft-order-from-designs.ts` — new step 2
- `src/api/store/custom/designs/[id]/checkout/route.ts` — same conversion for store flow
- Integration test: 7 tests covering same-currency, cross-currency, overrides, consistency

---

## Production Run System Enhancements

### Sample Run Type
- Added **Type selector** (Production/Sample) to production run creation UI
- `run_type` passed through API to workflow
- Sample runs trigger auto cost calculation on completion

### Auto-Assignment from Linked Partners
- When creating a run without explicit assignments, system auto-populates from linked partners
- Single partner: full quantity. Multiple: split equally.

### Cancel Production Runs
- `POST /admin/production-runs/:id/cancel` — cancels run + tasks + children
- Auto-cancels parent when all siblings are terminal
- Idempotent, blocks on completed runs
- Cancel button added to admin production run detail page and design production runs section

### Consumption at Completion
- `POST /partners/production-runs/:id/complete` now accepts optional `consumptions` array
- Each consumption logged with `production_run_id` in metadata, auto-committed

---

## v1 Send-to-Partner Deprecation

### Removed from UI
- "Send" button removed from admin partner section
- Batch send drawer removed from admin designs list page
- DesignActionsSection removed from partner design detail

### Cancel Support
- `POST /admin/designs/:id/cancel-partner-assignment` — cancels workflow transaction, tasks, resets metadata
- Cancel button shows in admin partner section for active v1 assignments (labelled "Legacy workflow")
- Partner actions blocked with 400 after cancel

### Backend Retained
- All v1 partner endpoints still work for in-flight workflows
- Cancelled guard added to all 5 partner action routes (start/finish/redo/refinish/complete)
- Partner API returns `partner_status: "cancelled"` when assignment is cancelled

---

## Cost Estimation from Sampling

### New Model Fields
- `design.material_cost`, `design.production_cost`, `design.cost_breakdown`, `design.cost_currency`
- `raw_material.unit_cost`, `raw_material.cost_currency`
- `consumption_log.unit_cost`

### Auto-Calculation
- Subscriber on `production_run.completed` for sample runs
- Cost priority: log.unit_cost (partner) > raw_material.unit_cost (admin) > 0
- Formula: material + 30% overhead = estimated_cost
- Written to proper DB columns (not metadata)

### Scripts
- `backfill-inventory-unit-cost.ts` — backfills raw_material.unit_cost from order line history
- `calculate-sample-cost.ts` — manual cost calculation for designs

### Admin UI
- Raw material create/edit forms now include "Cost per Unit" and "Currency" fields
- Validator updated to pass through `unit_cost` and `cost_currency`

---

## Partner UI Improvements

### Design List
- Pre-filtered to active designs (excludes completed/cancelled by default)
- Work Status dropdown filter (was free-text)
- Default sort: most recently updated first
- Priority column with colored badges
- Relative date format

### Design Detail Layout
- Production runs section with progress stepper (Sent > Accepted > Started > Finished > Completed)
- Single primary action button per run state
- Inline tasks with subtask checkboxes
- Consumption logs with unit_cost input and auto-resolved partner location
- Cancelled runs dimmed with error message
- v1 DesignActionsSection removed

### Production Run Detail
- Cancelled state: buttons hidden, error message shown

---

## Inventory & Stock Fixes

### Product Creation
- Fixed `TypeError: undefined is not an object (evaluating 'p.length')` — `variant.inventory` null guard
- `inventory_items` omitted from payload when empty (lets Medusa auto-create)
- Auto-creates inventory levels at partner's stock location on product creation

### Partner-Scoped APIs
- `POST/GET/DELETE /partners/reservations` — new partner-scoped reservation endpoints (was hitting admin `/admin/reservations` causing CORS errors)
- Reservation hooks rewritten to use partner endpoints
- Manage Locations form fixed to use `/partners/stores/:id/locations` (was `/partners/stock-locations` which didn't exist)
- Order fulfillment form same fix
- Inventory detail: stock location names now enriched in API response

### Variants API
- `GET /partners/stores/:id/products/:productId/variants` now includes `inventory_items.inventory.*` and `location_levels.*`

---

## Admin UI Layout Changes

### Design Detail Page
**Main column**: General > Production Runs > Tasks > Partners > Inventory > Consumption Logs > Sizes > Tags > Colors

**Sidebar**: Media Folder > Media > Components

- Moodboard sidebar section removed (accessible from General section action menu)
- Production Runs moved from sidebar to main column
- Tasks moved from sidebar to main column
- Partners moved from sidebar to main column
- Inventory and Consumption Logs moved from sidebar to main column

### Production Run Creation
- "Run Details" section with Type (Production/Sample) and Quantity fields
- Task templates grouped by category with "Select all / Deselect all" per category

### Partner Section
- Cancel button for v1 assignments (legacy workflows)
- Status badges for production runs (prefer active over cancelled)
- Unlink button hidden when active run or v1 assignment exists

---

## Storefront Provisioning Fix

- Website record now auto-created during provisioning (was a separate manual call)
- Default pages seeded automatically
- `partner_name` passed to provision workflow

---

## Folder Linking Fix

- `DELETE /admin/designs/:id/link-media-folder` was calling `remoteLink.dismiss` with only one side of the link — now correctly queries the linked folder first and dismisses with both sides

---

## Yield & Output Tracking (2026-03-28)

### New Model Fields on Production Run
- `produced_quantity` — actual good pieces produced by partner
- `rejected_quantity` — pieces that failed QC
- `rejection_reason` — categorized: stitching_defect, fabric_flaw, color_mismatch, sizing_error, print_defect, material_damage, quality_below_standard, other
- `rejection_notes` — freeform detail
- `cost_type` — "per_unit" or "total" (how partner entered their cost)

### Per-Unit Cost Normalization
- When partner enters cost as "per unit", API auto-normalizes: `per_unit × produced_quantity = total`
- Stored value is always the total; `cost_type` records the original input method
- Both admin and partner UI display the calculation breakdown

### Complete Endpoint Updated
- `POST /partners/production-runs/:id/complete` now accepts all yield fields
- Backward compatible — old clients can still send without yield data
- Yield data included in `production_run.completed` event payload

---

## Task Cost System (2026-03-28)

### Task Template Costs
- `estimated_cost` and `cost_currency` added to TaskTemplate model
- Admin create/edit forms include "Estimated Cost" and "Cost Currency" fields
- Zod validator and workflow type updated to pass through cost fields

### Task Cost Inheritance
- When tasks are created from templates (`createTaskWithTemplates`), `estimated_cost` and `cost_currency` are automatically copied from template to task
- Production run dispatch creates tasks with inherited costs

### Partner Task Completion with Cost
- `POST /partners/tasks/:id/finish` now accepts `actual_cost`, `cost_type`, `cost_currency`
- `POST /partners/assigned-tasks/:id/finish` same fields added
- Partner UI shows estimated cost on task cards, prompts for actual cost when finishing
- "Skip" button allows finishing without entering cost (backward compatible)

### Cost Aggregation
- `sample-run-completed` subscriber now aggregates task costs: `Σ(actual_cost || estimated_cost)`
- `calculate-sample-cost.ts` script aligned with same logic
- New `cost_breakdown` fields: `service_costs[]`, `service_cost_total`, `production_cost_source: "task_costs"`
- Cost priority: partner_estimate > task_costs > 30% overhead

### Bug Fix
- `setStepSuccessWorkflow` hang fixed — now guards on `transaction_id` before attempting to signal the workflow engine. Standalone tasks (without a lifecycle workflow) no longer block.

---

## Partner UI UX Overhaul (2026-03-28)

### Medusa UI Pattern Alignment
- `StatusBadge` for primary entity states (run status, next action)
- `usePrompt` for completion/accept confirmations instead of inline banners
- Info banners using `rounded-xl border-ui-border-base bg-ui-bg-subtle` + `InformationCircleSolid` icon
- Timeline using dot + line grid pattern (`grid-cols-[20px_1fr]`) with colored dots
- `Tooltip` on dates showing full date/time on hover
- `clx()` utility for conditional classNames

### Production Section — 13 UX Improvements
1. Contextual "What to do next" guidance per stage (different for sample vs production)
2. Empty-data confirmation via `usePrompt` on complete
3. Pending tasks acknowledgment checkbox before finish
4. Partial consumption failure feedback via `toast.warning`
5. Sample vs production run differentiation (banners, required fields)
6. Timeline with time + duration between steps
7. "Next Action" column in design list (Accept / Working / Complete / Under Review / Done)
8. Stepper labels partner-centric ("Received" not "Sent")
9. Material logging progress in card header
10. Target date with urgency badges (overdue/due soon)
11. Cancelled reason displayed
12. Submitted finish/completion notes shown after submission
13. Material summary for completed runs

### Complete Form Restructured (Output-First)
1. **Output** — produced/rejected with auto-calculated yield %, rejection reason dropdown
2. **Cost** — per-piece / total toggle with live cost summary
3. **Materials** — shows count of already-logged entries, collapsible "Log additional" form
4. **Notes** — completion notes

### Design List Enhancements
- "Next Action" column with `StatusBadge` (Accept, Working, Complete, Under Review, Done)
- "Due" column showing target dates with urgency coloring
- Urgent badge inline with design name
- `Tooltip` on "Last Updated" showing full date/time

### Task Cards with Cost
- `InlineTaskCard` shows estimated cost (from template) and actual cost (after completion)
- Cost input appears when finishing a task — pre-filled with estimate
- Skip button for tasks without cost relevance

---

## Admin UI Updates (2026-03-28)

### Production Run Detail
- Yield summary: "9 of 10 produced · 1 rejected · 90% yield" with color-coded badge
- Cost type shown: "per unit" vs "total" with multiplication breakdown
- Task cost display: estimated vs actual with variance indicator (+/-)
- Task cost summary total at bottom of tasks tab

### Task Template Create Form
- "Estimated Cost" and "Cost Currency" fields added
- Grid layout alongside duration field

---

## Integration Tests Added

| Test Suite | Tests | Coverage |
|---|---|---|
| `design-currency-conversion.spec.ts` | 7 | Currency conversion in both admin and store flows |
| `cancel-workflows.spec.ts` | 14 | v1 cancel, production run cancel, transition flow, partner action guards |
| `partner-reservations-api.spec.ts` | 9 | Partner-scoped reservation CRUD, isolation, auto-linked inventory |
| `sample-cost-flow.spec.ts` | 2 | End-to-end cost estimation from consumption logs |
| `raw-materials-api.spec.ts` | 14 | Raw material CRUD including unit_cost and cost_currency |
| `production-run-complete-yield.spec.ts` | 7 | Yield data, per-unit cost normalization, backward compat, admin visibility |
| `task-cost-flow.spec.ts` | 5 | Template cost inheritance, actual_cost storage, aggregation |
