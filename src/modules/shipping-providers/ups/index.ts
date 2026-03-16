import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import UPSFulfillmentService from "./service"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [UPSFulfillmentService],
})
