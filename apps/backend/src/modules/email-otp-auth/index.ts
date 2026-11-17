import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import EmailOtpAuthProviderService from "./service"

export const EMAIL_OTP_AUTH_PROVIDER = "email-otp"

export default ModuleProvider(Modules.AUTH, {
  services: [EmailOtpAuthProviderService],
})
