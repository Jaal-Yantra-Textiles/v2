import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import DHLExpressFulfillmentService from "./service"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [DHLExpressFulfillmentService],
})
