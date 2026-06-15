import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import ShiprocketFulfillmentService from "./service"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [ShiprocketFulfillmentService],
})
