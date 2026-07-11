import { defineLink } from "@medusajs/framework/utils"
import ProductModule from "@medusajs/medusa/product"
import ArtisanProductDetailModule from "../modules/artisan-product-detail"

// #859 S3 (#862): product ↔ artisan_product_detail link. A product has at most
// one artisan detail row (made-to-order flag, lead time, min order qty, maker
// story). Exposed on the storefront by requesting `+artisan_detail.*` on the
// store product query.
export default defineLink(
  ProductModule.linkable.product,
  {
    linkable: ArtisanProductDetailModule.linkable.artisanProductDetail,
    field: "artisan_detail",
  }
)
