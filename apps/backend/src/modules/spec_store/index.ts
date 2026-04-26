import { Module } from "@medusajs/framework/utils"
import SpecStoreService from "./service"

export const SPEC_STORE_MODULE = "spec_store"

export default Module(SPEC_STORE_MODULE, {
  service: SpecStoreService,
})
