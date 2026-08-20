import { Module } from "@medusajs/framework/utils"
import PartnerQuoteService from "./service"

export const PARTNER_QUOTE_MODULE = "partnerQuote"

export default Module(PARTNER_QUOTE_MODULE, {
  service: PartnerQuoteService,
})
