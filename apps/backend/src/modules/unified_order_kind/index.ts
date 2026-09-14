import { Module } from "@medusajs/framework/utils"
import UnifiedOrderKindService from "./service"

export const UNIFIED_ORDER_KIND_MODULE = "unified_order_kind"

const UnifiedOrderKindModule = Module(UNIFIED_ORDER_KIND_MODULE, {
  service: UnifiedOrderKindService,
})

export { UnifiedOrderKindModule }
export default UnifiedOrderKindModule
