import { defineLink } from "@medusajs/framework/utils"
import DesignModule from "../modules/designs"
import CartModule from "@medusajs/medusa/cart"

export default defineLink(
  DesignModule.linkable.design,
  {
    linkable: CartModule.linkable.lineItem,
    isList: true,
  }
)