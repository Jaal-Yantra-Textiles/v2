import { defineLink } from "@medusajs/framework/utils"
import { Modules } from "@medusajs/framework/utils"
import AdPlanningModule from "../modules/ad-planning"

/**
 * Read-only link from Conversion to Order
 *
 * Enables graph queries like:
 * - Get conversion with order details
 * - Get order with its conversion attribution
 */
export default defineLink(
  {
    linkable: {
      serviceName: Modules.ORDER,
      primaryKey: "id",
      field: "order",
    },
    field: "id",
    isList: true,
  },
  {
    ...AdPlanningModule.linkable.conversion.id,
    primaryKey: "order_id",
  },
  {
    readOnly: true,
  }
)
