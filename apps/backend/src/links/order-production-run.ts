import { defineLink } from "@medusajs/framework/utils"
import OrderModule from "@medusajs/medusa/order"
import ProductionRunsModule from "../modules/production_runs"

// D5 (#342): the unified core `order` ↔ its `production_run` execution row.
//
// This link is the load-bearing pointer the orders-unification shim depends on
// (replacing the old `run.metadata.unified_order_id` backref, which a metadata
// blob-replace could silently wipe — see feedback_no_critical_data_in_metadata),
// AND the discriminator: an order linked to a production_run is a design
// work-order (kind=design). An order with NEITHER this link nor an
// order↔inventory_order link is a customer retail order. NOTE: do NOT use the
// `design ↔ order` link to discriminate — that one is shared with retail
// (order-placed.ts runs linkDesignsToOrder on every purchase).
//
// One unified order per (child) run, so 1:1. `filterable: ["id"]` ingests the
// production_run side into the Index Module (index_engine is enabled) so
// `query.index({ entity: "order", filters: { production_run: { id: ... } } })`
// can filter orders by link existence — including the retail anti-join
// (id: null). Use query.index for list filtering only; resolve the link via
// query.graph for transactional reads inside workflows (it is authoritative;
// the index is eventually consistent).
//
// This is a MANAGED (pivot-table) link, so it is fully BIDIRECTIONAL in
// query.graph — verified reading a real linked row both ways:
//   forward: `production_runs.order`        → the unified order
//   reverse: `order.production_runs`        → the run (auto-derived PLURAL)
// The `field` below ONLY affects the Index Module accessor (adds the singular
// `production_run` alias for query.index); it does NOT rename query.graph's
// reverse accessor, which stays the plural model name `production_runs`.
export default defineLink(
  OrderModule.linkable.order,
  {
    linkable: ProductionRunsModule.linkable.productionRuns,
    // #826 S3a — was 1:1 (one order per run). Now 1:many: ONE unified work-order
    // COLLATES the N per-design runs of a commissioning order (grouped by
    // run.order_id), the design analog of one inventory_order → N orderlines →
    // one order. A run still belongs to at most one work-order (run side stays
    // single), so the forward accessor (production_runs.order) is unchanged;
    // only the reverse (order.production_runs) now returns an array. Existing
    // readers already tolerate array-or-object (list-partner-orders `linked()`,
    // both detail-route attaches, use-order-kind), and legacy_id keeps pointing
    // at a run via order.metadata. Existing per-run work-orders (one run each)
    // remain valid 1:many rows.
    isList: true,
    filterable: ["id"],
    // adds the singular `production_run` alias to the INDEX (query.index) so the
    // admin retail anti-join can filter `production_run: { id: null }`. Does NOT
    // change query.graph's reverse accessor (that's `order.production_runs`).
    field: "production_run",
  }
)
