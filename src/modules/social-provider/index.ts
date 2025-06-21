import { Module } from "@medusajs/framework/utils"
import { MedusaError } from "@medusajs/utils";
import { TwitterOAuth2Token } from "./types";
import SocialProviderService from "./service"



export const SOCIAL_PROVIDER_MODULE = "social_provider"

export { SocialProviderService }

export default Module(SOCIAL_PROVIDER_MODULE, {
  service: SocialProviderService,
})
