import { Module } from "@medusajs/framework/utils"
import StorefrontDesignAssistantService from "./service"

export const STOREFRONT_DESIGN_ASSISTANT_MODULE = "storefront_design_assistant"

export default Module(STOREFRONT_DESIGN_ASSISTANT_MODULE, {
  service: StorefrontDesignAssistantService,
})
