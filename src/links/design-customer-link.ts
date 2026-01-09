import { defineLink } from "@medusajs/framework/utils"
import DesignModule from "../modules/designs"
import CustomerModule from "@medusajs/medusa/customer"

export default defineLink(
  {
    linkable: DesignModule.linkable.design,
    isList: true, // a customer can have many designs
  },
  CustomerModule.linkable.customer
)