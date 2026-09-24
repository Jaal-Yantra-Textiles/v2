import { Module } from "@medusajs/framework/utils"
import WorkOrderService from "./service"

export const WORK_ORDER_MODULE = "work_orders"

const WorkOrderModule = Module(WORK_ORDER_MODULE, {
  service: WorkOrderService,
})

export { WorkOrderModule }
export default WorkOrderModule
