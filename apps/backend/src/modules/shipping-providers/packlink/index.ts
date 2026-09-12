import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import PacklinkFulfillmentService from "./service"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [PacklinkFulfillmentService],
})
