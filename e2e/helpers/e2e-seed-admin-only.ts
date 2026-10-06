import { ExecArgs } from "@medusajs/framework/types"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import Scrypt from "scrypt-kdf"
import * as fs from "fs"
import * as path from "path"

/**
 * A minimal local seed: one admin login + one website, nothing else.
 *
 * For admin specs that need only those two (e.g. blog-email-editor) when the
 * full `pnpm e2e:seed` cannot finish on a long-lived dev DB. Writes
 * `.e2e-seed.admin-only.json`, which a spec reads via
 * `E2E_SEED_FILE=apps/backend/.e2e-seed.admin-only.json`. CI keeps using the
 * full seed.
 *
 *   cd apps/backend && npx medusa exec ../../e2e/helpers/e2e-seed-admin-only.ts
 */
const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.admin-only.json")
const SEED_PASSWORD = "e2etest123!"

export default async function e2eSeedAdminOnly({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const userModule = container.resolve(Modules.USER)
  const authModule = container.resolve(Modules.AUTH)
  const websiteService: any = container.resolve("websites")

  const stamp = Date.now()
  const email = `e2e-admin-only-${stamp}@jyt.test`
  const user = await userModule.createUsers({ first_name: "E2E", last_name: "Admin", email })

  const passwordHash = await Scrypt.kdf(SEED_PASSWORD, { logN: 15, r: 8, p: 1 })
  await authModule.createAuthIdentities({
    provider_identities: [
      {
        provider: "emailpass",
        entity_id: email,
        provider_metadata: { password: passwordHash.toString("base64") },
      },
    ],
    app_metadata: { user_id: user.id },
  })

  const domain = `e2e-admin-only-${stamp}.jyt.test`
  const website = await websiteService.createWebsites({
    domain,
    name: "E2E admin-only",
    status: "Active",
    primary_language: "en",
  })

  fs.writeFileSync(
    SEED_FILE,
    JSON.stringify({ email, password: SEED_PASSWORD, websiteId: website.id, domain }, null, 2)
  )
  logger.info(`E2E admin-only seed written to ${SEED_FILE}`)
}
