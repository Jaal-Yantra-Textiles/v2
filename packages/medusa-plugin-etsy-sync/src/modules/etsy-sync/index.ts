import { Module } from "@medusajs/framework/utils"
import EtsySyncService from "./service"

export const ETSY_SYNC_MODULE = "etsySync"

const EtsySyncModule = Module(ETSY_SYNC_MODULE, {
  service: EtsySyncService,
})

export default EtsySyncModule
export { EtsySyncService }
