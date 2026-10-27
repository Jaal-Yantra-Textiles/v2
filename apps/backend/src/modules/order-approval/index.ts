import { Module } from "@medusajs/framework/utils"
import OrderApprovalService from "./service"

export const ORDER_APPROVAL_MODULE = "orderApproval"

export default Module(ORDER_APPROVAL_MODULE, {
  service: OrderApprovalService,
})
