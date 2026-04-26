import { Module } from "@medusajs/framework/utils"
import VisualFlowService from "./service"

export const VISUAL_FLOWS_MODULE = "visual_flows"

export default Module(VISUAL_FLOWS_MODULE, {
  service: VisualFlowService,
})
