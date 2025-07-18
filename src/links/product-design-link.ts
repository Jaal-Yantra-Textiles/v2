

import { defineLink } from "@medusajs/framework/utils"
import ProductModule  from "@medusajs/medusa/product"
import DesignModule from "../modules/designs"
export default defineLink(
  { linkable: ProductModule.linkable.product, isList: true },
  { linkable: DesignModule.linkable.design, isList: true }
)