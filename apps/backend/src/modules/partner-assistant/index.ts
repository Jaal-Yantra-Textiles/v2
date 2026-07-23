import { Module } from "@medusajs/framework/utils"
import PartnerAssistantService from "./service"

export const PARTNER_ASSISTANT_MODULE = "partner_assistant"

export default Module(PARTNER_ASSISTANT_MODULE, {
  service: PartnerAssistantService,
})
