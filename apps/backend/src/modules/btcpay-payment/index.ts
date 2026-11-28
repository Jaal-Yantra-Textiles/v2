import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import BtcpayPaymentProviderService from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [BtcpayPaymentProviderService],
})
