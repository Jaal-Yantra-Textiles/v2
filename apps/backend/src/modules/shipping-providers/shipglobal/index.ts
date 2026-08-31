import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import ShipglobalFulfillmentService from "./service"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [ShipglobalFulfillmentService],
})