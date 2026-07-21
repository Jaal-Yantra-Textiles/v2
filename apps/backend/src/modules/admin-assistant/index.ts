import { Module } from "@medusajs/framework/utils"
import AdminAssistantService from "./service"

export const ADMIN_ASSISTANT_MODULE = "admin_assistant"

export default Module(ADMIN_ASSISTANT_MODULE, {
  service: AdminAssistantService,
})
