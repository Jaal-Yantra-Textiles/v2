# Design → Product Lifecycle (analysis)

Scope: product creation from a design, run-output approval pricing, and the
`design_size_sets` / `color_palette` design fields. All claims cite
`path:symbol` from the repo root.

## 1. Purpose

The design→product lifecycle turns an approved design (or a completed
production run's output) into a purchasable Medusa product + variant, links it
back to the design for provenance, and prices it from run costs where
available. Implemented by `createProductFromDesignWorkflow`
(`apps/backend/src/workflows/designs/create-product-from-design.ts:590`) and
the batch approval helper `applyRunApprovals`
(`apps/backend/src/workflows/production-runs/approve-run-output.ts:147`).

## 2. Entry points

- `POST`-adjacent workflow export: `createProductFromDesignWorkflow` —
  `apps/backend/src/workflows/designs/create-product-from-design.ts:590`
  (single step `createProductAndVariantStep` at
  `apps/backend/src/workflows/designs/create-product-from-design.ts:190`).
- Admin read route: `GET /admin/designs/:id/products` —
  `apps/backend/src/api/admin/designs/[id]/products/route.ts:25` (`GET`).
- Batch run approval: `applyRunApprovals` —
  `apps/backend/src/workflows/production-runs/approve-run-output.ts:147`
  (exported function; also re-exports `APPROVAL_MARKUP`,
  `resolveApprovalCurrency`, `resolveApprovalPrice` from
  `apps/backend/src/workflows/production-runs/approval-pricing.ts` at
  `approve-run-output.ts:106`).
- Pricing rule module: `resolveApprovalPrice`, `resolveApprovalCurrency`,
  `APPROVAL_MARKUP`, `APPROVAL_FALLBACK_CURRENCY` —
  `apps/backend/src/workflows/production-runs/approval-pricing.ts:84`,
  `:124`, `:39`, `:122`.
- Production run creation (context): `createProductionRunWorkflow` —
  `apps/backend/src/workflows/production-runs/create-production-run.ts:427`.
- Draft-product promotion (the other design→product path):
  `promoteDesignToProductWorkflow` —
  `apps/backend/src/workflows/designs/promote-design-to-product.ts:177`
  (step `promoteDesignStep` at `:24`).

## 3. Data models & links

- Design↔product link: created via `remoteLink.create` with
  `[Modules.PRODUCT]: { product_id }` + `[DESIGN_MODULE]: { design_id }` —
  `apps/backend/src/workflows/designs/create-product-from-design.ts:412`.
- Design↔variant link with extra data (`estimated_cost`, `customer_id`,
  `created_at`) —
  `apps/backend/src/workflows/designs/create-product-from-design.ts:419`.
- Link definition file read by the admin route:
  `apps/backend/src/links/product-design-link` imported at
  `apps/backend/src/api/admin/designs/[id]/products/route.ts:7`; the route
  queries `productDesignLink.entryPoint` (`route.ts:32`).
- `design_size_sets` table: `model.define("design_size_sets", …)` —
  `apps/backend/src/modules/designs/models/design_size_set.ts:4` with
  `size_label` (text), `measurements` (json nullable), `metadata` (json
  nullable), and `design: model.belongsTo(() => Design, { mappedBy:
  "size_sets" })` (`design_size_set.ts:9`). Relation from the design:
  `size_sets: model.hasMany(() => DesignSizeSet, { mappedBy: "design" })` —
  `apps/backend/src/modules/designs/models/design.ts:132`; cascade-deleted
  with the design (`design.ts:137`).
- `color_palette` is NOT a separate table: it is a nullable JSON column on the
  design model — `color_palette: model.json().nullable()` at
  `apps/backend/src/modules/designs/models/design.ts:82` (comment: "Color
  codes and names"). The structured `colors` relation
  (`design.ts:131`, `model.hasMany(() => DesignColor, …)`) is a separate
  thing; `create-design.ts` converts `color_palette` into `colors` rows when
  creating a design (`apps/backend/src/workflows/designs/create-design.ts:74`,
  nulling `color_palette` at `:90` when converted).
- Migration for `design_size_sets`:
  `apps/backend/src/modules/designs/migrations/Migration20251227230904.ts:10`
  (FK to `design` on delete cascade at `:16`).

## 4. Key behaviours

### 4.1 Product creation from a design (`createProductFromDesignWorkflow`)

Input type `CreateProductFromDesignInput` —
`apps/backend/src/workflows/designs/create-product-from-design.ts:28`:
`design_id`, `estimated_cost`, optional `customer_id`, `currency_code`
(defaults `"usd"` at `:195`), `made_to_order`, `unit_price`,
`sales_channel_id`.

Design fields read (query.graph fields at
`apps/backend/src/workflows/designs/create-product-from-design.ts:208`):
`id`, `name`, `description`, `thumbnail_url`, `design_type`, plus linked
`products.*` with options/values/variants.

Branch A — design already has a linked product (`:233`):
- Reuses `linkedProducts[0]` (`:235`).
- For each existing product option, appends a value identifying THIS design
  via `designOptionValue` (`:253`), upserting through
  `productService.upsertProductOptions` (`:256`); if the product has no
  options, creates a `Type` option with the design-derived value (`:271`).
- Variant data (`:281`): `title: "Custom - ${design.name}"`, `sku:
  "CUSTOM-${design.id}-${Date.now()}"`, `manage_inventory: !madeToOrder`
  (`:202`), `options: variantOptions`, one price `{ amount: priceAmount,
  currency_code: currencyCode }`, `metadata: { is_custom_design: true,
  design_id }`.
- Created via `createProductVariantsWorkflow` (`:307`) — chosen over the bare
  product service so the price_set link and inventory items are created
  (comment cites #440, `:299`-`:306`).

Branch B — no linked product (`:318`):
- Sales channel: `input.sales_channel_id` wins; fallback is the first store's
  `default_sales_channel_id` (`:324`-`:330`); throws if none (`:332`).
- Naming via `designProductNaming` (`:343`, defined `:134`): product
  `title` = design name (fallback `Design ${id}`), option title =
  `design.design_type` or `"Type"`, option value = design name (with
  `(<last 6 of id>)` suffix on collision, `designOptionValue` at `:105`),
  variant title = same value.
- Product input (`:345`): `status: madeToOrder ? "published" : "draft"`
  (`:353`), `is_giftcard: false`, `discountable: true`, `thumbnail` +
  `images` from `design.thumbnail_url`, `metadata: { is_custom_design: true,
  design_id, design_type }`, one option with one value, ONE variant with
  `sku: "CUSTOM-${design.id}"`, `manage_inventory`, the option tuple, and one
  price `{ amount: priceAmount, currency_code: currencyCode }`.
- Created via `createProductsWorkflow` (`:390`); product↔design link created
  at `:412`.

Pricing: `resolveListedPrice` (`:175`) — `unit_price` wins over
`estimated_cost`; result is the raw number (decimal major units, no ×100),
and non-finite/non-positive values become `0`. Output reports `price:
priceAmount` (`:532`).

Post-creation: design↔variant link with `estimated_cost`/`customer_id`
provenance (`:419`); best-effort backfill of existing order line items via
`design_order` link or `design_line_item` → cart → `order_cart` paths
(`:435`-`:525`), matching items whose `metadata.design_id` matches and which
have no `variant_id` yet (`:507`).

Compensation (`:544`): dismisses the design↔variant link; if a new product
was created, dismisses the product↔design link and deletes the product
(`:572`); otherwise deletes just the variant (`:579`).

### 4.2 Approval pricing (post-#1915)

`applyRunApprovals` (`apps/backend/src/workflows/production-runs/approve-run-output.ts:147`):

- Eligibility: only `status === "completed"` runs (`:212`); already-decided
  runs are skipped (`:221`); approve on a design-less run is skipped
  (`:237`).
- Reject path: records `approval_decision: "rejected"` etc. on each run,
  creates nothing (`:251`-`:283`).
- Approve path groups eligible runs by `design_id` (`:297`) — one product per
  DESIGN however many runs.
- Pricing per design: `runCostPerUnit` = the MAX `cost_per_unit` across the
  design's runs via `computeRunCostSummary`
  (`apps/backend/src/modules/production_runs/cost-summary.ts`, called at
  `approve-run-output.ts:355`); then `resolveApprovalPrice` (`:366`).
- `resolveApprovalPrice`
  (`apps/backend/src/workflows/production-runs/approval-pricing.ts:84`)
  fallback chain, exactly:
  1. `runCostPerUnit` if positive → `price = round2(runCost × markup)`,
     `source: "run_cost"` (`:91`-`:94`);
  2. else `designEstimatedCost` if positive → `price = round2(estimate ×
     markup)`, `source: "design_estimate"` (`:96`-`:103`);
  3. else `null` = REFUSE — the caller throws "Cannot price design …"
     (`approve-run-output.ts:370`-`:376`) rather than listing at 0.
  - `markup` defaults to `APPROVAL_MARKUP = 1.4` (`approval-pricing.ts:39`);
    zero/NaN are treated as absent on both inputs (`positive()` at `:63`).
- Currency: `resolveApprovalCurrency` (`approval-pricing.ts:124`) —
  `design.cost_currency` → store default currency → `APPROVAL_FALLBACK_CURRENCY
  = "inr"` (`:122`). Store currency read by `readStoreCurrency`
  (`approve-run-output.ts:127`).
- Create-or-reuse: if the design already has a linked product
  (`design.products?.[0]`, `:381`), it is REUSED (`product_existed: true`,
  `:384`-`:393`) and nothing is created — the idempotency rule. Otherwise
  `createProductFromDesignWorkflow` runs with `estimated_cost: price` (the
  marked-up price) and `currency_code: currency` (`:395`-`:401`).
- After creation: `requestVariantPriceFanout`
  (`apps/backend/src/workflows/fx/fanout-variant-prices.ts`, called at
  `approve-run-output.ts:422`) materialises other store currencies via a
  subscriber (worker-side, comment cites #1900 and the 2026-08-19 OOM).
- Design status set to `"Approved"` via `updateDesignWorkflow` (`:430`);
  each run stamped `approval_decision: "approved"`, `approved_product_id`,
  `approved_variant_id` (`:434`-`:444`); `design.approved` event emitted ONCE
  per newly-producted design (`:452`-`:464`).

### 4.3 design_size_sets and color_palette — variant readers

**NO READER FOUND**: no code reads `design_size_sets` or `color_palette` to
produce product VARIANTS. Every variant-producing path creates exactly ONE
variant per design and reads neither field:

- `createProductFromDesignWorkflow` reads only `id`, `name`, `description`,
  `thumbnail_url`, `design_type` from the design
  (`apps/backend/src/workflows/designs/create-product-from-design.ts:208`)
  and creates one variant (`:372`).
- `promoteDesignToProductWorkflow` DOES read `color_palette`
  (`apps/backend/src/workflows/designs/promote-design-to-product.ts:43`) but
  only flattens it into the product DESCRIPTION string — `colorNote =
  " Available in: ${palette.join(", ")}."` (`:99`-`:108`) — and creates a
  single `"Default"` variant with `prices: []` (`:124`-`:130`). It does not
  read `size_sets` at all (fields at `:38`-`:52`).
- `applyRunApprovals` reads only `id`, `name`, `estimated_cost`,
  `cost_currency`, `products.id`, `products.variants.id`
  (`apps/backend/src/workflows/production-runs/approve-run-output.ts:319`).

Non-variant readers that DO exist (for contrast, none mint variants):

- Production-run snapshots copy `size_sets.*` into `run.snapshot.size_sets`:
  `apps/backend/src/workflows/production-runs/create-production-run.ts:101`
  (fetch) and `:488` (snapshot write);
  `apps/backend/src/workflows/production-runs/recreate-production-run.ts:65`,
  `:230`, `:259`.
- Techpack generation reads `size_sets?.[0]` and normalizes `color_palette`
  into colorways: `apps/backend/src/workflows/designs/moodboard/techpack-input-from-design.ts:245`
  and `:254`.
- Design revision copies both onto the revised design:
  `apps/backend/src/workflows/designs/revise-design.ts:194` (color_palette)
  and `:231`-`:233` (size_sets).
- Backfill job ports legacy `custom_sizes` → `size_sets` rows:
  `apps/backend/src/api/admin/ops/maintenance-jobs/backfill-design-size-sets-job.ts`.
- Admin/store UI display, hang-tag/QR rendering, Mastra agents, and AI
  description tools read `color_palette` for display text only (e.g.
  `apps/backend/src/admin/routes/products/qr/page.tsx:439`,
  `apps/backend/src/mastra/agents/storefront-design-chat.ts:84`).

Greps run (all under `apps/backend/src`): `design_size_sets` (15 matches —
model define, migrations, snapshot JSON only), `color_palette` (98 matches —
none variant-producing), `size_sets` (100+ matches — snapshots, techpack,
validators, admin UI, backfill; none variant-producing).

## 5. Gotchas / invariants

- Prices are DECIMAL MAJOR units; the historical `×100` was removed
  (`resolveListedPrice` doc, `create-product-from-design.ts:157`-`:174`).
- Made-to-order requires `status: "published"` AND `manage_inventory: false`
  together or the variant is unpurchasable/unorderable
  (`create-product-from-design.ts:42`-`:55`, `:196`-`:202`, `:353`).
- Option-value collisions: appended variants must not reuse the literal
  `"Custom"` (#1874); `designOptionValue` suffixes `(<last 6 of id>)` on
  collision (`create-product-from-design.ts:105`-`:112`).
- Approval is idempotent per design: an existing linked product is reused,
  never appended to (`approve-run-output.ts:384`-`:393`).
- `resolveApprovalPrice` returning `null` must fail the approval loudly, not
  list at 0 (`approval-pricing.ts:69`-`:83`, `approve-run-output.ts:370`).
- Zero is "absent" for both cost inputs (`positive()`, `approval-pricing.ts:63`).
- `applyRunApprovals` never calls the run service with an empty id list —
  `filters: { id: [] }` would mean ALL rows (`approve-run-output.ts:164`-`:169`).
- Batch failures are isolated per design; earlier decisions stand
  (`approve-run-output.ts:483`-`:503`).
- The admin products-for-design route must query the LINK's `entryPoint`, not
  the design entity — a graph query to a missing linked field returns no key
  rather than erroring (`apps/backend/src/api/admin/designs/[id]/products/route.ts:20`-`:24`).

## 6. Open questions / (unverified)

- `computeRunCostSummary` is cited from
  `apps/backend/src/modules/production_runs/cost-summary.ts` (import at
  `apps/backend/src/workflows/production-runs/approve-run-output.ts:5`) but
  its internals were not read for this doc — only that it returns a
  `cost_per_unit` used at `approve-run-output.ts:355`-`:359`.
- `requestVariantPriceFanout` is cited from
  `apps/backend/src/workflows/fx/fanout-variant-prices.ts` (import at
  `approve-run-output.ts:6`) but its internals were not read.
- The exact route that calls `applyRunApprovals` (admin batch endpoint) was
  not located in this pass; the function itself is exported from
  `apps/backend/src/workflows/production-runs/approve-run-output.ts:147`.
  (unverified)
