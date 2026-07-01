# Material Groups + Raw-Material Color Variants — Codemap

Backs #817 (raw-material color variants) and its Material Groups UI, plus the
follow-up asks: group-level global spec editing, propagate-edit-to-color-items,
order-line color pills, searchable/larger raw-material picker, and the
"view item details" modal. All paths under `apps/backend`.

## Feature lineage
- #817 parent: order a material in multiple colors; color stays at the
  `inventory_item`/SKU grain (one stock unit per color).
- Slices (all merged 2026-07-01): S1 #821 (`raw_material_group` parent +
  `group_id` FK), S2 #822 (`color`/`material_name`/`raw_material_id`
  denormalized onto `inventory_order_line`), S3 #823 (group-ordering fan-out +
  auto-create per-color `inventory_item` + admin Material Groups UI),
  S4 #824 (design pins a group). UI polish #827 (native DataTable, sections).

## Data models
- **Raw material** — `src/modules/raw_material/models/raw_material.ts` (fields ~5-43).
  Key spec fields: `name`, `description`, `composition`, `specifications` (JSON),
  `unit_of_measure` (enum Meter/Yard/Kilogram/Gram/Piece/Roll/Other),
  `unit_cost`, `cost_currency`, `minimum_order_quantity`, `lead_time_days`,
  `color`, `width`, `weight`, `grade`, `certification` (JSON),
  `usage_guidelines`, `storage_requirements`, `status`, `metadata`, `media`,
  `material_type` (belongsTo MaterialType), `group` (belongsTo RawMaterialGroup).
- **Raw material group** — `src/modules/raw_material/models/raw_material_group.ts` (~13-40).
  Shared/global fields: `name`, `description`, `composition`, `specifications` (JSON),
  `unit_of_measure`, `status`, `metadata`, `media`, `material_type` (belongsTo),
  `raw_materials` (hasMany — the per-color variants). NB: group is intentionally
  a **subset** of raw_material fields; the extra per-color spec fields
  (width/weight/grade/lead_time/MOQ/cost/location) are NOT on the group today.
- **Inventory order line** — `src/modules/inventory_orders/models/orderline.ts` (~13-15):
  denormalized `color`, `material_name`, `raw_material_id` (nullable).

## Material Groups admin UI
- List + create modal — `src/admin/routes/raw-material-groups/page.tsx`
  - `CreateGroupModal` ~29-85 collects only `name` (required) + `composition`.
  - List page ~86-200 (native Medusa DataTable, server search/pagination/status).
- Detail page — `src/admin/routes/raw-material-groups/[id]/page.tsx`
  - Sections: GroupGeneralSection (read-only summary ~40-68), GroupColorsSection
    (add/link colors), GroupOrdersSection (order history).
  - **No group edit form** exists today — General section is read-only.
- Section components — `src/admin/components/raw-material-groups/group-sections.tsx`
  - `QuickAddColorModal` ~75-135 collects `name` + `color` only.
- Add color (full spec) — `src/admin/routes/raw-material-groups/[id]/colors/create/page.tsx`
  reuses shared `RawMaterialForm` in `mode="group"`.

## Fan-out: group order → per-color inventory items
- Workflow — `src/workflows/raw_material_groups/resolve-group-color-items.ts`
  - `resolveOrCreateColorInventoryItemsStep` ~48-156: per requested color, checks
    for existing inventory_item link; for missing colors creates inventory_item
    (`title: rm.name` ~99), links item↔raw_material (~104-111), builds SKU via
    `buildSkuPrefix` (~113-127), seeds zero stock level at receiving location
    (~130-143), then fans out into resolved order lines (~150).
- API entry — `src/api/admin/raw-material-groups/[id]/orders/route.ts` ~75-134:
  POST chains resolve-colors (~95) → createInventoryOrderWorkflow (~107).
- **Copy-on-create today:** only `name`/`color`/SKU/link/stock-level are set on
  the new per-color inventory_item + raw_material. Group-level global specs
  (material_type, composition, specifications, unit_of_measure, location, etc.)
  are NOT propagated onto the created color raw_materials.

## Inventory order-lines editor (create/edit)
- Editable grid — `src/admin/components/creates/inventory-order-lines-grid.tsx` ~29-267:
  columns Item (dropdown ~102-131), Quantity (~132-149), Price (~150-165),
  Actions (eye + trash ~166-208). **No `color` column** — color not shown/edited
  in the grid even though it's on the model.
- Raw-material picker — `src/admin/components/data-grid/components/data-grid-select-cell.tsx`:
  searchable input ~112-122, client-side case-insensitive label filter ~58-70.
- Picker data source — `useInventoryWithRawMaterials({ limit: 100 })`
  - `src/admin/hooks/api/raw-materials.ts` ~397-425; endpoint
    `/admin/inventory-items/raw-materials`; **limit 100** (client-side filter only).
  - Called: `edit-order-lines.tsx:65`, `create-inventory-order.tsx:110`.
  - Option label = raw material name OR inventory item title/SKU
    (`inventory-order-lines-grid.tsx:79`), value = inventoryItemId.
- **Update drops denorm fields:** `UpdateInventoryOrderLinesPayload`
  (`src/admin/hooks/api/inventory-orders.ts` ~306-318) only sends
  `id`/`inventory_item_id`/`quantity`/`price` — `color`/`material_name`/
  `raw_material_id` are never captured on create/edit (only pre-populated by the
  group fan-out path).

## Read-only order-lines view (color pills already here)
- `src/admin/components/inventory-orders/inventory-order-lines-section.tsx` ~49-91:
  renders `line.color` as a grey Badge ~67-69; material name = `line.material_name`
  with fallback to `inventoryItem.title` ~64. This is the badge/pill pattern to
  mirror into the editable grid.

## "View item details" modal
- Trigger — eye icon `MaterialItemModalTrigger` in
  `inventory-order-lines-grid.tsx:191`.
- Modal — `src/admin/components/inventory-orders/material-item-modal.tsx` ~33-202:
  `StackedFocusModal` (id `material-item-modal-${item.id}` ~53). Shows item
  title/SKU/description, raw-material props (name/color/width/weight/lead/MOQ
  ~106-149), location levels table ~152-188.
- **Gotchas:** eye button is `disabled` when no item selected (~36-49); modal
  only shows useful data if the selected inventory_item has `raw_materials`
  populated. If it "doesn't pop up," suspect StackedFocusModal nesting (must be
  inside a StackedFocusModal provider / not double-nested inside the DataGrid
  cell portal) or the disabled/empty-item condition.
