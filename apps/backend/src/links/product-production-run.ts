import { defineLink } from "@medusajs/framework/utils"
import ProductModule from "@medusajs/medusa/product"
import ProductionRunsModule from "../modules/production_runs"

// #1112 — the Product spine ↔ its production_run(s). This is the provenance /
// "design trail" pointer queryable FROM the product: a product sold and
// fulfilled from produced stock carries the (completed) run that made it.
//
// One product → many runs (isList on the run side); a run belongs to at most
// one product (the run's `product_id` column). Complements the existing
// `order ↔ production_run` link (order-production-run.ts) — that one
// discriminates design work-orders; THIS one hangs runs off the product so
// admin/partner UIs can render the trail without a bespoke design.
//
// MANAGED (pivot-table) link → bidirectional in query.graph:
//   forward: `product.production_runs`   (plural, auto-derived)
//   reverse: `production_runs.product`
export default defineLink(
  ProductModule.linkable.product,
  {
    linkable: ProductionRunsModule.linkable.productionRuns,
    isList: true,
  }
)
