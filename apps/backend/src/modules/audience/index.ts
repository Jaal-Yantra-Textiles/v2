import { Module } from "@medusajs/framework/utils"
import AudienceService from "./service"

export const AUDIENCE_MODULE = "audience"

const AudienceModule = Module(AUDIENCE_MODULE, {
  service: AudienceService,
})

export { AudienceModule }

export default AudienceModule
