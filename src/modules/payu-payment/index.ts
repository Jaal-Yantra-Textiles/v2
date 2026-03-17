import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import PayUPaymentProviderService from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [PayUPaymentProviderService],
})
