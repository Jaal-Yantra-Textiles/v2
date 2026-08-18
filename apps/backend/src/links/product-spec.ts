import { defineLink } from "@medusajs/framework/utils"
import ProductModule from "@medusajs/medusa/product"
import ProductSpecModule from "../modules/product-spec"

// #1342: product ↔ product_spec link. A product has at most one spec row (the
// weave, its parameters, the colour palette, and any partner-defined fields).
//
// ⚠️ The product-side query.graph alias is the linked MODEL name,
// `product_spec` — request `+product_spec.*`, NOT `spec.*`, which silently
// returns nothing rather than erroring. A `field` option does not rename this
// side, so we don't set one. Same trap as `links/product-artisan-detail.ts`,
// which cost a release when the maker story never hydrated (#859).
export default defineLink(ProductModule.linkable.product, {
  linkable: ProductSpecModule.linkable.productSpec,
})
