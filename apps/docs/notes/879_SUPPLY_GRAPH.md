# [#879] Supply Graph — Unify supplier supply ↔ products ↔ inventory_orders

> **Status:** Design doc (no code yet — per the issue's "reviewed before any code" guard).
> **Chosen approach:** **Bridge, not rebuild.** Keep `inventory_orders` intact; add an
> *optional* link so procurement can reference a partner's approved **product**, and
> reuse the #861 propose→approve spine to let suppliers list supplies **as products**.
> **Parent epic:** #859. **Seed:** the `supplies_to_platform` capability (#861).

---

## 1. Why

Today the platform has **two parallel catalog primitives** for the same real-world thing
(a partner's offering):

| | **Marketplace listing** (#861) | **`inventory_orders`** |
|---|---|---|
| Direction | Sell **to** customers | Order **from** a partner |
| Primitive | `product` (+ partner-product link) | `inventory_order_line` → `inventory_item` → `raw_material` |
| Onboarding | propose → admin approve → cross-list to core channel | supplier fulfils orders assigned to them |
| Identity | product id, media, variants, prices | raw_material (color grain) + denormalized fields |

A handloom supplier's *supply is a product in a nutshell*. Modeling it twice means double
onboarding, no shared media/variants/pricing, and no single "supplier catalog." #879 collapses
them into **one supply graph** where a partner onboards once and can be **sold-through**,
**ordered-from**, or **both** — driven by the existing orthogonal flags.

**Non-goal (this phase):** deleting or rewriting `inventory_orders`. Full unification
(procurement *becomes* "order this product") is the eventual end-state, but the bridge
gets 80% of the value at ~20% of the migration risk.

---

## 2. Current state (grounded)

### 2.1 inventory_orders module
- `inventory_order` — `apps/backend/src/modules/inventory_orders/models/order.ts`
  - `status` enum: Pending | Processing | Ready for Delivery | Shipped | Delivered | Cancelled | Partial
  - `quantity`, `total_price`, `currency_code`(inr), `order_date`, `expected_delivery_date`,
    `orderlines` (hasMany), `shipping_address`, `is_sample`, cancellation fields.
- `inventory_order_line` — `models/orderline.ts`
  - `quantity`, `price`, **denorm** `color` / `material_name` / `raw_material_id` (#817 S2,
    display-only), `batch_number`, `metadata`. **No FK** — the "what" is resolved through a link.
- **Links** (`apps/backend/src/links/`):
  - `partner-inventory-order.ts` — partner (**supplier**) → inventory_orders (1:many) ← *who supplies*
  - `inventory-orders-inventory-items.ts` — order_line ↔ inventory_item (m:m) ← *what is ordered*
  - `raw-material-data-inventory.ts` — inventory_item ↔ raw_material (1:1) ← *color grain*
  - `order-inventory-order.ts` — unified order ↔ inventory_order (discriminator kind=inventory)
  - `inventory-orders-stock-locations.ts` — from/to locations
- **Workflows:** `create-inventory-orders.ts` (atomic `createInvWithLines`, resolves denorm from
  linked raw_materials), `partner-complete-inventory-order.ts` (fulfilment + inventory levels +
  Shiprocket on complete), `cancel-…`, `delete-…`.
- **UI:** admin `api/admin/inventory-orders/`, partner `api/partners/inventory-orders/`.

### 2.2 #861 product spine (reusable machinery)
- Ownership: `links/partner-product.ts` (partner owns product).
- Flags on `partner_onboarding_profile` (NOT the partner model):
  `selling_mode` = `dedicated_storefront | core_channel_listing`; `commission_bps` (nullable);
  `supplies_to_platform` (nullable bool, **orthogonal** to selling_mode).
- Events: `partner_product.proposed | .approved | .rejected` — emitted in
  `api/partners/products/route.ts` + `api/admin/partners/products/lib/run-approval.ts`;
  consumed by `subscribers/artisan-product-cross-list.ts` and `visual-flow-event-trigger.ts`.
- Pure helpers: `decideApprovalTransition`, `decideResubmit`, `decideCrossList`.
- Core channel: `subscribers/lib/resolve-core-sales-channel.ts` (`CORE_SALES_CHANNEL_ID` env,
  fallback `is_default` store). Attachment via `remoteLink.create(product ↔ sales_channel)`.

### 2.3 Fee + operator identity
- `modules/partner_billing/resolve-fee-rate.ts` — `pickFeeRate(override, default)`; precedence
  `profile.commission_bps` → `PLATFORM_TX_FEE_BPS` → `200` bps.
- **No JYT partner record.** The operator is implicit: core store = `is_default` /
  `CORE_SALES_CHANNEL_ID`. "JYT-as-partner-node" is a genuinely new entity if we want it.

---

## 3. Target model — the bridge

Two independent **facets** hang off a single `product`, gated by the existing flags:

```
                         ┌─────────────────────────────┐
                         │           product           │  (one catalog primitive)
                         │  id · variants · media · $   │
                         └───────┬──────────────┬───────┘
             sellable facet      │              │   supply facet
        (partner_product link +  │              │  (partner supplies_to_platform +
         selling_mode, #861)     │              │   approved product)
                                 ▼              ▼
                    ┌────────────────┐   ┌──────────────────────────┐
                    │  sales_channel │   │  partner_supply_offering │  (NEW, thin)
                    │ (core / dedic.)│   │  partner + product_variant│
                    └────────────────┘   │  + cost/currency/lead/moq │
                                         └────────────┬─────────────┘
                                                      │ referenced (optional) by
                                                      ▼
                    ┌───────────────────────────────────────────────┐
                    │ inventory_order_line                           │
                    │  quantity · price                              │
                    │  raw_material_id (existing denorm, unchanged)  │
                    │  product_variant_id?  ← NEW optional link      │
                    └───────────────────────────────────────────────┘
```

### 3.1 Directionality (the crux)
A product expresses **two independent capabilities**, never mutually exclusive:
- **Sellable-to-customers** → on a `sales_channel` (today's #861 cross-list). Gated by `selling_mode`.
- **Orderable-from-supplier** → has a `partner_supply_offering`. Gated by `supplies_to_platform`.

A partner with `supplies_to_platform=true` who proposes a product and is approved gets a
**supply offering** minted (mirror of the cross-list subscriber, on the same `.approved` event).
Both facets can be present on one product.

### 3.2 What's genuinely new (small surface)
1. **`partner_supply_offering`** (thin entity or link+facet): `{ id, partner_id, product_variant_id,
   cost, currency_code, lead_time_days, moq, status }`. This is where **supplier cost price** lives —
   distinct from the product's marketplace **sell price** (resolves the doc's pricing open question).
2. **Optional `inventory_order_line ↔ product_variant` link** (`links/inventory-order-line-product-variant.ts`),
   plus an optional `product_variant_id` **denorm** column on the line (mirrors the `raw_material_id`
   denorm pattern — keep the source of truth in the link, denorm for display/self-description).
3. A **supply-list subscriber** on `partner_product.approved` that, when the owner
   `supplies_to_platform`, upserts a `partner_supply_offering` (idempotent, pure `decideSupplyOffering`
   helper mirroring `decideCrossList`).

### 3.3 What we deliberately DON'T touch
- `raw_material` / `raw_material_group` / color-at-inventory_item grain (#817) stays the source of
  truth for existing procurement. A line can reference **either** a raw_material (today) **or** a
  product_variant (new) — never forced to migrate.
- `inventory_order` / status machine / complete/cancel/Shiprocket flow — unchanged.
- The whole #861 approve/reject/resubmit/email spine — reused, not modified.

### 3.4 JYT-as-partner-node (deferred, documented)
The recursive "JYT is just another partner" idea is **out of scope for the bridge** but the model
must not preclude it. Recommendation when we do it: a **synthetic partner record** for the operator
(`workspace_type: "operator"`, `supplies_to_platform` where relevant, `selling_mode=null`,
`commission_bps=0`) rather than keeping JYT implicit — so fee logic, sales channels, and supply
offerings all resolve through the same code paths instead of special-casing `is_default`. Filed as a
**later slice**, gated on a real need (e.g. inter-node ordering). Until then, `CORE_SALES_CHANNEL_ID`
remains the operator identity.

---

## 4. Migration path (non-breaking)

Every step is additive; existing rows and flows keep working with zero backfill required.

1. **Add columns/links, no behavior change.** `partner_supply_offering` table +
   `inventory_order_line.product_variant_id` (nullable) + link. Existing lines untouched
   (`product_variant_id = null`, `raw_material_id` as-is).
2. **Mint supply offerings going forward.** New subscriber on `.approved` for
   `supplies_to_platform` partners. Old products unaffected.
3. **Optional promote raw_materials → products** via a **Data Plumbing job** (dry-run→apply,
   per `feedback_backfills_via_data_plumbing`): for each raw_material a supplier wants listed,
   create/attach a product + variant + supply offering; **link, don't move** (raw_material rows
   stay). Idempotent, audited, reversible-by-omission. Never auto-runs.
4. **Order-from-product path.** `create-inventory-orders` accepts `product_variant_id` on a line
   (in addition to `inventory_item_id`); resolves denorm from the variant/offering when present,
   else from raw_material as today. One branch, both grains supported.
5. **Only much later**, if ever, collapse the raw_material grain into products (full unification).
   The bridge is a stable resting point — we can stop here indefinitely.

**Invariant:** a line is valid with *exactly one* of {`inventory_item_id`/raw_material path,
`product_variant_id`}. Validator enforces XOR; workflows branch on which is set.

---

## 5. Sliced roadmap

| Slice | Deliverable | Risk |
|---|---|---|
| **S1** | `partner_supply_offering` model + migration + service; pure `decideSupplyOffering` helper + unit tests. No wiring. | Low (net-new, isolated) |
| **S2** | Subscriber: on `partner_product.approved` + owner `supplies_to_platform` → upsert offering (idempotent). Mirrors cross-list subscriber. Integration test. | Low |
| **S3** | Optional `inventory_order_line ↔ product_variant` link + nullable denorm column (ALTER migration, `add column if not exists`); validator XOR guard. No UI yet. | Med (touches the line model — hand-write ALTER, see `reference_medusa_migration_create_if_not_exists_hazard`) |
| **S4** | `create-inventory-orders` + create validators accept `product_variant_id`; denorm resolution branch; partner/admin create UI can pick "from supplier catalog." | Med |
| **S5** | Data Plumbing "Promote raw material → supply product" job (dry-run/apply, idempotent, link-not-move). | Med |
| **S6** | Supplier catalog UX: partner lists supply products (reuse #861 propose flow with a supply intent); admin supplier-catalog view. | Med |
| **S7** (deferred) | JYT-as-partner synthetic operator node; route fee/channel/supply through it. | High — separate design spike |

Each slice is independently shippable and leaves the platform working. S1–S2 are pure additive
prep; nothing user-visible changes until S4.

---

## 6. Open questions — resolved vs remaining

**Resolved by this doc:**
- *Line references product directly or a wrapper?* → **Both**: an optional `product_variant_id`
  link on the line (the wrapper `partner_supply_offering` carries supplier terms; the line points at
  the variant). raw_material grain preserved.
- *How does a product express sell vs order?* → **Two orthogonal facets** (sales_channel vs
  supply_offering), gated by `selling_mode` and `supplies_to_platform` respectively.
- *Supplier cost vs marketplace sell price on one product?* → cost lives on
  `partner_supply_offering`; sell price stays the product/variant price. No collision.
- *Migration of existing inventory_orders / raw suppliers?* → **none forced**; additive columns +
  opt-in Data Plumbing promotion; XOR invariant on the line.

**Remaining (decide before S4/S7):**
- Fee/commission semantics for **procurement** (we *pay* the supplier) vs **marketplace** (we *take*
  a fee). `resolve-fee-rate` is built for the take-a-fee direction — does supply need its own
  cost/markup resolver, or is offering.cost enough? (Lean: offering.cost is enough; no fee on
  procurement.)
- Whether JYT-as-partner (S7) is ever needed, or `CORE_SALES_CHANNEL_ID` + operator-implicit is
  sufficient forever. Don't build S7 speculatively.
- Multi-supplier for one product (two partners supply the same variant) — offering is per
  (partner, variant), so the model allows it; UI/selection policy is a later concern.

---

## 7. Watch-outs / invariants
- **Additive only** through S6; no destructive migration of raw_material or inventory_order rows.
- **Hand-write ALTER migrations** for the new column (`add column if not exists`) — editing a
  `create table if not exists` never lands on existing DBs (`reference_medusa_migration_create_if_not_exists_hazard`).
- **Denorm mirrors the raw_material_id pattern** — link is source of truth, column is for display;
  don't put load-bearing state only in metadata (`feedback_no_critical_data_in_metadata`).
- **Reuse the pure-helper + subscriber pattern** from #861 (`decideCrossList` → `decideSupplyOffering`);
  keep decisions unit-testable and off the event path.
- **Backfills are Data Plumbing jobs**, never one-off scripts (`feedback_backfills_via_data_plumbing`).
- Partner API mirrors admin shape (`feedback_partner_api_mirrors_admin`); any new supply route needs
  its `authenticate("partner")` matcher (`reference_partner_route_auth_matcher_gotcha`).
