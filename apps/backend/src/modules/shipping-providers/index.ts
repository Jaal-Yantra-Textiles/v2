import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import DelhiveryFulfillmentService from "./delhivery/service"
import ShiprocketFulfillmentService from "./shiprocket/service"
import DHLExpressFulfillmentService from "./dhl/service"
import UPSFulfillmentService from "./ups/service"
import FedExFulfillmentService from "./fedex/service"
import AusPostFulfillmentService from "./auspost/service"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [
    DelhiveryFulfillmentService,
    ShiprocketFulfillmentService,
    DHLExpressFulfillmentService,
    UPSFulfillmentService,
    FedExFulfillmentService,
    AusPostFulfillmentService,
  ],
})
