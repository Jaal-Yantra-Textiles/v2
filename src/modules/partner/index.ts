import { Module } from "@medusajs/framework/utils"
import PartnerService from "./service"

export const PARTNER_MODULE = "partner"

const PartnerModule = Module(PARTNER_MODULE, {
    service: PartnerService,
})

export { PartnerModule }
export default PartnerModule
