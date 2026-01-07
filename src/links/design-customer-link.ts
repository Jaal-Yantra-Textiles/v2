import { defineLink } from "@medusajs/framework/utils"
import DesignModule from "../modules/designs"
import CustomerModule from "@medusajs/medusa/customer"

/**
 * Links a design to the customer who created it.
 * One design belongs to at most one customer, but a customer can own many designs.
 */
export default defineLink(
  DesignModule.linkable.design,
  {
    linkable: CustomerModule.linkable.customer,
    isList: false,
    filterable: ["id"],
  }
)
