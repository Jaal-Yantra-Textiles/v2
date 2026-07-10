import { Module } from "@medusajs/framework/utils"
import InvestorService from "./service"

export const INVESTOR_MODULE = "investor"

const InvestorModule = Module(INVESTOR_MODULE, {
  service: InvestorService,
})

export { InvestorModule }
export default InvestorModule
