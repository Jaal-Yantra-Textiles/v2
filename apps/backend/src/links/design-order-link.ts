import { defineLink } from "@medusajs/framework/utils"
import DesignModule from "../modules/designs"
import OrderModule from "@medusajs/medusa/order"

export default defineLink(
  {
    linkable: DesignModule.linkable.design,
    isList: true,
  },
  {
    linkable: OrderModule.linkable.order,
    isList: true,
  }
)
