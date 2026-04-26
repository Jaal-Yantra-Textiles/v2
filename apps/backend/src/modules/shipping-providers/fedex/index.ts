import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import FedExFulfillmentService from "./service"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [FedExFulfillmentService],
})
