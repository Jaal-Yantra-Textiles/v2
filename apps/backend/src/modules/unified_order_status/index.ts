import { Module } from "@medusajs/framework/utils"
import UnifiedOrderStatusService from "./service"

export const UNIFIED_ORDER_STATUS_MODULE = "unified_order_status"

const UnifiedOrderStatusModule = Module(UNIFIED_ORDER_STATUS_MODULE, {
  service: UnifiedOrderStatusService,
})

export { UnifiedOrderStatusModule }
export default UnifiedOrderStatusModule
