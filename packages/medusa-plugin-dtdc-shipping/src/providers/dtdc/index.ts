import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import DtdcFulfillmentService from "./service"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [DtdcFulfillmentService],
})

export { DtdcFulfillmentService }