# Partner self-serve: designs → global inventory → production → cost

> Captured 2026-06-05. Feature request (roadmap item #6, expanded):
> let partners **create their own designs** linked to global inventory,
> **run production themselves** with isolated in-house / outsourced
> tracking, and get **cost estimation** — material cost, raw-material
> SKU tracking, and raw-material order placement — end to end.
>
> This doc is the architecture map + gap analysis + the phased build
> order. Each phase becomes one PR. Mirrors the
> `PARTNER_API_PARITY.md` recipe: every `/partners/...` route matches
> the `/admin/...` wire contract, scoping lives inside the handler.

---

## 1. The spine already exists

This is **not** greenfield. The cost / material / production
infrastructure is substantially complete on the admin + backend side.
The work is overwhelmingly "expose it to partners + add two missing
distinctions", not "build it from scratch".

### Cost + material model (already first-class)

- `designs/models/design.ts:47-51` — `estimated_cost`, `material_cost`,
  `production_cost`, `cost_breakdown` (JSON: `{ items: [{ inventory_item_id,
  title, quantity, unit_cost, line_total, cost_source }], calculated_at,
  source }`), `cost_currency`.
- `workflows/designs/estimate-design-cost.ts` — 5-tier cost waterfall
  per linked inventory item: order-history price → `inventory_item.unit_cost`
  → linked `raw_materials.unit_cost` → committed `consumption_log.unit_cost`
  → `0` (estimated). +30% production overhead default; emits
  `confidence: exact | estimated | guesstimate`.
- `consumption_log` module — per design+run material/labor/energy draw:
  `inventory_item_id`, `raw_material_id`, `quantity`, `unit_cost`,
  `unit_of_measure`, `consumption_type` (incl. `labor`), `is_committed`,
  `consumed_by` (admin|partner). **Partners can already POST these.**

### Global inventory + SKU + raw materials (already built)

- Inventory uses Medusa-native `inventory_item` (global rows), scoped to
  a partner via `inventory_level` at `store.default_location_id`. Exactly
  the "global inventory" model the feature asks for.
- `links/design-inventory-link.ts` — Design ↔ InventoryItem (many:many)
  with `planned_quantity` / `consumed_quantity` / `location_id`. **This is
  the bill-of-materials today** (flat, not hierarchical).
- `raw_material` model + `links/raw-material-data-inventory.ts`
  (inventory_item ↔ raw_material) + `utils/generate-sku.ts`
  (`{CATEGORY}-{MATERIAL}-{COLOR}-{SEQ}` e.g. `FAB-COT-BLU-001`,
  auto-sequenced off existing `inventory_item.sku`). SKU lives on the
  inventory item, not the raw_material row.
- `inventory_orders` module — procurement/PO concept. `InventoryOrder`
  (status: Pending→Processing→Shipped→Delivered→Cancelled→Partial,
  `total_price`, `is_sample`) + `OrderLine` (quantity, price). Linked to
  partner (`partner-inventory-order.ts`), to inventory items
  (`inventory-orders-inventory-items.ts`), to stock locations
  (from/to), to tasks, to internal payments.

### Production lifecycle (mature)

- `production_runs/models/production-run.ts` — `status` (draft →
  pending_review → approved → sent_to_partner → in_progress →
  completed/cancelled), `run_type` (production|sample), `parent_run_id`
  (child splitting), `partner_id`, `role`, `quantity`,
  `partner_cost_estimate` + `cost_type` (per_unit|total), `dispatch_state`,
  `snapshot`, `depends_on_run_ids`, lifecycle timestamps.
- `production_policy` module — DB-backed state machine
  (`approve_from`, `dispatch_from`, `accept_from`, …); runtime-editable.
- `api/admin/production-runs/[id]/cost-summary` — sums material
  (Σ consumption unit_cost×qty) + energy (per-type, falls back to
  `energy_rates`) + labor (`energy_type=labor` rate) + partner estimate →
  `grand_total`, `cost_per_unit`.
- `energy_rates` module — electricity/water/gas/**labor** rates with
  effective-date ranges + region.

---

## 2. The gap: partners can execute, but can't originate

The entire partner flow today is **receive-and-execute**: admin creates
the design → assigns it → partner starts/finishes/completes/logs
consumption. There is no partner-originated path.

| Capability | Backend | Partner UI |
|---|---|---|
| Create a design | ❌ no `POST /partners/designs` | ❌ no form |
| Edit design fields / specs | ❌ | ❌ |
| Link global inventory to own design (BOM) | ❌ (admin-only `POST /admin/designs/:id/inventory`) | ❌ |
| Recalculate / see design cost estimate | ❌ no `/partners/designs/:id/recalculate-cost` | ❌ |
| Create a production run themselves | ❌ (only admin `POST /admin/designs/:id/production-runs`) | ❌ |
| In-house vs outsourced distinction | ❌ no field on `production_run` | ❌ |
| See own run cost-summary | ❌ no `/partners/production-runs/:id/cost-summary` | ❌ |
| Place a raw-material order (procurement) | ✅ `POST /partners/inventory-orders` exists | ❌ no create form |
| Create raw material + SKU | ❌ admin-only `createRawMaterialWorkflow` | partial (inventory create exists) |

**What partners CAN already do** (don't rebuild): list/execute assigned
designs + runs (start/finish/redo/complete), create inventory items +
manage stock, log consumption with unit_cost, view incoming inventory
orders + receive/complete them.

---

## 3. Decisions locked (2026-06-05)

1. **In-house vs outsourced** → add an `execution_mode` enum to
   `production_run`: `in_house` | `outsourced`. `in_house` = the owning
   partner manufactures themselves (no sub-partner). `outsourced` = handed
   to another partner/vendor via a new nullable `sub_partner_id`. Explicit
   + queryable so cost tracking can isolate per mode.

2. **Partner-created design ownership** → **partner-owned, isolated by
   default.** On create, auto-link the design to the creating partner via
   `design_partners_link` and DO NOT surface it in the global admin design
   list unless explicitly shared. Admin can still query all designs with an
   explicit flag. (A future "submit to admin / promote to commerce-ready"
   action is the bridge to the global pool — out of scope for the first
   phases.)

3. **Build order** → doc-first, then Phase 1. PRs are sequenced below.

---

## 4. Phased build order (one PR per phase)

Each phase mirrors the admin contract, scopes inside the handler, and
ships with HTTP integration tests using the parity recipe
(shape-equality vs admin, partner-isolation assertions).

### Phase 1 — Partner design CRUD (isolated)

- `POST /partners/designs` — create, auto-link to creating partner via
  `design_partners_link`, `origin_source` defaults `"manual"`. Reuse
  `createDesignWorkflow`; do NOT set the global-admin visibility.
- `PUT /partners/designs/[id]` — edit own design (guard: partner must be
  linked). Reuse `updateDesignWorkflow`.
- `DELETE /partners/designs/[id]` — delete own design (guard + block if
  active production runs exist, mirroring admin's delink guard).
- Extend `GET /partners/designs` filters to include partner-created ones
  (already scoped by link table — verify isolation).
- Admin `GET /admin/designs` gains an explicit include-partner-owned flag
  so partner WIP doesn't leak into the default admin list.
- **Tests:** create→appears only for creator; second partner can't
  read/edit/delete; admin default list excludes it.

### Phase 2 — Partner design ↔ global inventory (BOM)

- `POST /partners/designs/[id]/inventory` — link global inventory items
  with `planned_quantity` / `location_id` (scope location to partner's
  `default_location_id`). Reuse `linkInventoryWorkflow`.
- `GET /partners/designs/[id]/inventory` — list linked items + their
  raw_materials + stock levels (route shape already exists on detail).
- `PATCH` / `DELETE` link parity.
- **Tests:** partner links an item, BOM reads back; can't link to a
  location that isn't theirs.

### Phase 3 — Partner cost estimation

- `POST /partners/designs/[id]/recalculate-cost` — run
  `estimateDesignCostWorkflow`, persist `estimated_cost`/breakdown.
- `GET /partners/designs/[id]/cost` — read cost fields + breakdown.
- **Tests:** linked inventory with unit_cost → estimate materialises with
  correct `cost_source` + confidence.

### Phase 4 — Partner-originated production runs + execution_mode

- Migration: add `execution_mode` (`in_house`|`outsourced`, default
  `in_house`) + `sub_partner_id` (nullable) to `production_run`.
- `POST /partners/designs/[id]/production-runs` (or
  `POST /partners/production-runs`) — partner creates a run against their
  own design, defaulting `partner_id = self`, `execution_mode` from body.
  For `outsourced`, set `sub_partner_id` + reuse the
  `approve-production-run` child-split + `design_partners_link` mirror so
  the sub-partner sees it.
- Production-policy: confirm partner-created runs enter at `pending_review`
  or a partner-self-approve path (decision point inside the PR).
- **Tests:** in-house run stays with creator; outsourced run surfaces to
  sub-partner via `/partners/production-runs`; cost isolates per mode.

**Phase 4 shipped (2026-06-05).** Decision: partner **self-approves**
(runs created `status=approved`, no admin gate). Migration added
`execution_mode` (`in_house`|`outsourced`) + `sub_partner_id` to
`production_runs`. `POST /partners/designs/:id/production-runs` creates
the run with `partner_id = self` (originator + lifecycle driver);
outsourced mirrors the design→sub-partner link. **Phase 4b follow-up
(deferred):** full vendor-side execution handoff — letting the
`sub_partner` accept/start/finish/complete an outsourced run via the
partner lifecycle endpoints (today the originating partner drives the
lifecycle). Needs the partner run-list + lifecycle guards to also match
`sub_partner_id`.

**Phase 5 backend shipped (2026-06-05).** `GET
/partners/production-runs/:id/cost-summary` — admin parity, scoped to
the run's `partner_id` OR `sub_partner_id`. Computation extracted into
`src/modules/production_runs/cost-summary.ts` (`computeRunCostSummary`)
so partner + admin produce identical numbers; admin route can adopt the
helper later. **Remaining for Phase 5:** the raw-material **order
placement UI** — the backend `POST /partners/inventory-orders` already
exists; this is a partner-ui create form (frontend) + optional
`POST /partners/raw-materials` if partners need to define their own
materials. Partner-ui work across all phases (forms/panels) is the
outstanding frontend track.

### Phase 5 — Partner production cost-summary + raw-material order placement UI

- `GET /partners/production-runs/[id]/cost-summary` — parity with the
  admin cost-summary (material+energy+labor+partner), scoped.
- Partner UI: wire the existing `POST /partners/inventory-orders` into a
  create form (procurement / "order raw materials"). Backend already
  exists — this is UI + hook only.
- Optional: `POST /partners/raw-materials` to let partners register a raw
  material + auto-SKU (reuse `createRawMaterialWorkflow`), if partners need
  to define their own materials vs. only consuming global ones.
- **Tests:** cost-summary parity vs admin; partner places an inventory
  order and it appears in their orders list.

### Partner-UI work (rides alongside each backend phase)

The partner-ui already mirrors Medusa admin patterns (RouteFocusModal
forms, data tables, `hooks/api/*`). Per phase:
- P1: design create/edit form + delete action (mirror admin design form).
- P2: inventory-link section on partner design detail.
- P3: cost panel on partner design detail (estimate + breakdown).
- P4: "Start production" action + in-house/outsourced toggle; run create.
- P5: cost-summary panel on partner run detail; inventory-order create form.

Sidebar already gates designs/production on `workspace_type ===
"manufacturer"` — no nav change needed; "create" buttons appear inside
existing sections.

---

## 5. Known gaps / things to decide inside later PRs

- `raw_material` has **no supplier field** and no own stock level (stock
  lives on `inventory_item` levels). If procurement needs supplier
  tracking, that's a model addition — flag when Phase 5 lands.
- BOM is **flat** (`design_inventory_item` list), not hierarchical. The
  `design_component` self-reference + cost rollup exists for bundles but
  isn't a true multi-level BOM. Fine for v1.
- Partner-self-approve vs admin-review for partner-created runs — decide in
  Phase 4 based on whether partners are trusted to dispatch their own work.
- Promote-to-admin / commerce-ready bridge for partner designs — separate
  follow-up once isolated self-serve is validated.

---

## 6. Carry-forward (unrelated to this feature)

- **Roadmap #5 prod steps still pending.** PR #317 (IN textile GST
  price-band classifier) merged + deployed, but
  `seed-in-textile-tax-class` and `backfill-classify-products-tax-class`
  were never run on prod (deploy poll was interrupted). Sharlho's IN cart
  is still flat 5%. Run both via `run-backfill.sh` + re-probe before
  closing #5.
