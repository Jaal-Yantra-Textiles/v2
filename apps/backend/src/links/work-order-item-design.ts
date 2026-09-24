import { defineLink } from "@medusajs/framework/utils"
import DesignModule from "../modules/designs"
import WorkOrderModule from "../modules/work_orders"

// #2262 S0 — READ-ONLY: a work-order line → the design it produces.
export default defineLink(
  { linkable: WorkOrderModule.linkable.workOrderItem, field: "design_id" },
  DesignModule.linkable.design,
  { readOnly: true }
)
