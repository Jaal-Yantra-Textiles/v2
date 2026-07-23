import { defineLink } from "@medusajs/framework/utils"
import ProductModule from "@medusajs/medusa/product"
import ArtisanProductDetailModule from "../modules/artisan-product-detail"

// #859 S3 (#862): product ↔ artisan_product_detail link. A product has at most
// one artisan detail row (made-to-order flag, lead time, min order qty, maker
// story).
//
// ⚠️ The product-side query.graph alias is the linked MODEL name,
// `artisan_product_detail` — request `+artisan_product_detail.*` on the store
// product query, NOT `artisan_detail.*` (which silently returns nothing; this
// bit #859 — the maker story never hydrated). A `field` option does not rename
// this side, so we don't set one. Verified via query.graph probe.
export default defineLink(
  ProductModule.linkable.product,
  {
    linkable: ArtisanProductDetailModule.linkable.artisanProductDetail,
  }
)
