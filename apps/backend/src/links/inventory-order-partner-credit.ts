import { defineLink } from "@medusajs/framework/utils"
import InventoryOrdersModule from "../modules/inventory_orders"
import InternalPaymentModule from "../modules/internal_payments"

/**
 * The order a credit is earmarked against (#1712), when there is one.
 *
 * 🔑 OPTIONAL by design. hrhandloom's 1,380 is earmarked for the still-open
 * partial order `01K36TE2WB`, because that is where the founder decided it
 * should be consumed — but a credit can equally be partner-wide with no order
 * in mind, and forcing one would invent a decision nobody made.
 */
export default defineLink(
  InventoryOrdersModule.linkable.inventoryOrders,
  {
    linkable: InternalPaymentModule.linkable.partnerCredit,
    isList: true,
    field: "credits",
  }
)
