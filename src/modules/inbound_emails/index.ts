import { Module } from "@medusajs/framework/utils"
import InboundEmailService from "./service"

export const INBOUND_EMAIL_MODULE = "inbound_emails"

const InboundEmailModule = Module(INBOUND_EMAIL_MODULE, {
  service: InboundEmailService,
})

export { InboundEmailModule }

export default InboundEmailModule
