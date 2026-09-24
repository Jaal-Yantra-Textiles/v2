import { defineLink } from "@medusajs/framework/utils"
import ProductionRunsModule from "../modules/production_runs"
import WorkOrderModule from "../modules/work_orders"

// #2262 S0 — a design work order ↔ the runs it holds. The successor of
// order-production-run.ts (the #342 mirror's link) and, like it, the
// authoritative pointer: one work order holds N runs when collated (#826), a
// run belongs to at most one work order.
//
// A real (pivot) link rather than an id column, because it is one-to-many and
// is traversed both ways: `work_order.production_runs` (the UI's kind
// discriminator) and `production_run.work_order` (the run → order redirect).
export default defineLink(WorkOrderModule.linkable.workOrder, {
  linkable: ProductionRunsModule.linkable.productionRuns,
  isList: true,
})
