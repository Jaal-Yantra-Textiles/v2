import { Module } from "@medusajs/framework/utils"
import AssistantContextCacheService from "./service"

export const ASSISTANT_CONTEXT_CACHE_MODULE = "assistant_context_cache"

export default Module(ASSISTANT_CONTEXT_CACHE_MODULE, {
  service: AssistantContextCacheService,
})
