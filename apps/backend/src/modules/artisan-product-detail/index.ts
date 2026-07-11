import { Module } from "@medusajs/framework/utils"
import ArtisanProductDetailService from "./service"

export const ARTISAN_PRODUCT_DETAIL_MODULE = "artisanProductDetail"

export default Module(ARTISAN_PRODUCT_DETAIL_MODULE, {
  service: ArtisanProductDetailService,
})
