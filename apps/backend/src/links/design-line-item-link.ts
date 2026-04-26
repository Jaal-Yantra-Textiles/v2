import { defineLink } from "@medusajs/framework/utils"
import DesignModule from "../modules/designs"
import CartModule from "@medusajs/medusa/cart"

export default defineLink(
  {
    linkable: DesignModule.linkable.design,
    isList: true,
  },
  {
    linkable: CartModule.linkable.lineItem,
    isList: true,
  }
)