import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import PhonePinAuthProviderService from "./service"

export const PHONE_PIN_AUTH_PROVIDER = "phone-pin"

export default ModuleProvider(Modules.AUTH, {
  services: [PhonePinAuthProviderService],
})
