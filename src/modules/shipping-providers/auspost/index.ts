import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import AusPostFulfillmentService from "./service"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [AusPostFulfillmentService],
})
