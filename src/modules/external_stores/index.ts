import { Module } from "@medusajs/framework/utils"
import ExternalStoresService from "./service"

export const EXTERNAL_STORES_MODULE = "external_stores"

export { ExternalStoresService }
export * from "./types"

export default Module(EXTERNAL_STORES_MODULE, {
  service: ExternalStoresService,
})
