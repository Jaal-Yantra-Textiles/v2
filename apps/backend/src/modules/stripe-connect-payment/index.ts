import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import StripeConnectPaymentProviderService from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [StripeConnectPaymentProviderService],
})
