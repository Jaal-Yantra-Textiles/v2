import { Modules } from "@medusajs/framework/utils"

/**
 * The Auth module registration, shared by medusa-config.ts and
 * medusa-config.prod.ts.
 *
 * 🔴 Declaring the Auth module REPLACES the providers `defineConfig` would
 * register for us — leave `emailpass` out and nobody can log in, with nothing
 * at boot to say so. `mfa.encryption_key` is merged back by Medusa, so it is
 * not restated here.
 *
 * `phone-pin` (#2320): partner admins log in with their phone number + a PIN.
 */
export function authModuleConfig() {
  return {
    resolve: "@medusajs/medusa/auth",
    key: Modules.AUTH,
    options: {
      providers: [
        {
          resolve: "@medusajs/medusa/auth-emailpass",
          id: "emailpass",
        },
        {
          resolve: "./src/modules/phone-pin-auth",
          id: "phone-pin",
        },
      ],
    },
  }
}
