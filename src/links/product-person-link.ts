import { defineLink } from "@medusajs/framework/utils"
import ProductModule from "@medusajs/medusa/product"
import PersonModule from "../modules/person"

// Link products <-> persons so a product can have many directly assigned people
// We expose the relation on the product as `people`
export default defineLink(
  { linkable: ProductModule.linkable.product, isList: true, field: "people" },
  { linkable: PersonModule.linkable.person, isList: true }
)
