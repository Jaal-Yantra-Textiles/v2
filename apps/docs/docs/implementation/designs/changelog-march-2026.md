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

## Integration Tests Added

| Test Suite | Tests | Coverage |
|---|---|---|
| `design-currency-conversion.spec.ts` | 7 | Currency conversion in both admin and store flows |
| `cancel-workflows.spec.ts` | 14 | v1 cancel, production run cancel, transition flow, partner action guards |
| `partner-reservations-api.spec.ts` | 9 | Partner-scoped reservation CRUD, isolation, auto-linked inventory |
| `sample-cost-flow.spec.ts` | 2 | End-to-end cost estimation from consumption logs |
| `raw-materials-api.spec.ts` | 14 | Raw material CRUD including unit_cost and cost_currency |
