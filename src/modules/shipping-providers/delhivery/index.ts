import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import DelhiveryFulfillmentService from "./service"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [DelhiveryFulfillmentService],
})
