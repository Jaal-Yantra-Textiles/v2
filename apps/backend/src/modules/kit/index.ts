import { Module } from "@medusajs/framework/utils"
import KitService from "./service"

export const KIT_MODULE = "kit"

export default Module(KIT_MODULE, {
  service: KitService,
})
