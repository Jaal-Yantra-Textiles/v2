import { ExecArgs } from "@medusajs/framework/types"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import Scrypt from "scrypt-kdf"
import * as fs from "fs"
import * as path from "path"

const SEED_PASSWORD = "e2etest123!"
const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

export default async function e2eSeed({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const userModule = container.resolve(Modules.USER)
  const authModule = container.resolve(Modules.AUTH)
  const websiteService = container.resolve("websites")
  const socials: any = container.resolve("socials")

  logger.info("E2E seed: creating admin user...")

  const email = `e2e-${Date.now()}@jyt.test`
  const user = await userModule.createUsers({
    first_name: "E2E",
    last_name: "Admin",
    email,
  })

  const hashConfig = { logN: 15, r: 8, p: 1 }
  const passwordHash = await Scrypt.kdf(SEED_PASSWORD, hashConfig)

  await authModule.createAuthIdentities({
    provider_identities: [
      {
        provider: "emailpass",
        entity_id: email,
        provider_metadata: {
          password: passwordHash.toString("base64"),
        },
      },
    ],
    app_metadata: {
      user_id: user.id,
    },
  })

  logger.info("E2E seed: creating website with GSC data...")

  const domain = `e2e-gsc-${Date.now()}.jyt.test`
  const website = await websiteService.createWebsites({
    domain,
    name: "E2E GSC Test",
    status: "Active",
    primary_language: "en",
  })

  const platformId = `e2e-platform-${Date.now()}`
  await socials.createSocialPlatforms({
    id: platformId,
    name: "E2E Google Platform",
    category: "google",
    auth_type: "oauth2",
    status: "active",
    api_config: { test: true },
  })

  await socials.createSocialPlatformBindings({
    platform_id: platformId,
    service: "search-console",
    resource_id: `sc-domain:${domain}`,
    resource_label: domain,
    status: "active",
  })

  const bindingsResult = await socials.listSocialPlatformBindings({
    service: "search-console",
    platform_id: platformId,
  })
  const bindings = bindingsResult.data ?? bindingsResult
  const binding = Array.isArray(bindings) ? bindings[0] : null
  if (!binding) throw new Error("No binding found after creation")

  const siteResult = await socials.createGoogleSearchConsoleSites({
    site_url: `sc-domain:${domain}`,
    platform_id: platformId,
    binding_id: binding.id,
    sync_status: "synced",
    permission_level: "siteOwner",
    last_synced_at: new Date(),
  })
  const site = Array.isArray(siteResult) ? siteResult[0] : siteResult.data?.[0] ?? siteResult
  if (!site?.id) throw new Error("No site created")

  const rows: any[] = []
  const today = new Date()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().split("T")[0]
    rows.push(
      { site_id: site.id, date: dateStr, query: "winter dress", page: "https://example.com/dress", clicks: 10, impressions: 100, ctr: 0.1, position: 4.2, synced_at: new Date() },
      { site_id: site.id, date: dateStr, query: "summer top", page: "https://example.com/top", clicks: 5, impressions: 80, ctr: 0.0625, position: 6.1, synced_at: new Date() },
      { site_id: site.id, date: dateStr, query: "summer top", page: "https://example.com/collections/summer", clicks: 3, impressions: 40, ctr: 0.075, position: 5.5, synced_at: new Date() }
    )
  }
  await socials.createGoogleSearchConsoleInsights(rows)

  const seedData = {
    email,
    password: SEED_PASSWORD,
    websiteId: website.id,
    domain,
  }

  fs.writeFileSync(SEED_FILE, JSON.stringify(seedData, null, 2))
  logger.info(`E2E seed complete. Credentials saved to ${SEED_FILE}`)
}
