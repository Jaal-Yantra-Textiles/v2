/**
 * Read-only inspection of SocialPlatform rows with category=ai.
 *
 * Used to confirm the backfill from env vars actually wrote rows the
 * runtime resolver (mastra/services/ai-platforms.ts:getAiPlatformForRole)
 * will pick up.
 *
 *   pnpm --filter @jyt/backend exec medusa exec \
 *     ./src/scripts/inspect-ai-platforms.ts
 */
import { ExecArgs } from "@medusajs/framework/types"
import { SOCIALS_MODULE } from "../modules/socials"
import type SocialsService from "../modules/socials/service"

export default async function inspectAiPlatforms({ container }: ExecArgs) {
  const socials = container.resolve(SOCIALS_MODULE) as unknown as SocialsService
  const rows = await socials.listSocialPlatforms(
    { category: "ai" } as any,
    { take: 50 }
  )

  console.log(`\n[inspect] category=ai rows: ${rows.length}\n`)
  for (const r of rows as any[]) {
    const meta = r.metadata ?? {}
    const apiConfig = r.api_config ?? {}
    const hasKey = Boolean(apiConfig.api_key) || Boolean(apiConfig.api_key_encrypted)
    console.log(
      `  - id=${r.id}\n` +
        `    name=${r.name}\n` +
        `    status=${r.status}  auth=${r.auth_type}\n` +
        `    provider_type=${meta.provider_type ?? "(none)"}  role=${meta.role ?? "(none)"}  is_default=${meta.is_default ?? false}\n` +
        `    base_url=${r.base_url ?? apiConfig.base_url ?? "(default)"}\n` +
        `    default_model=${apiConfig.default_model ?? meta.default_model ?? "(none)"}\n` +
        `    api_key=${
          hasKey ? (apiConfig.api_key_encrypted ? "encrypted" : "plaintext (not yet encrypted)") : "MISSING"
        }\n`
    )
  }
}
