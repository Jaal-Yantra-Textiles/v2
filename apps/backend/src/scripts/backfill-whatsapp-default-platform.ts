import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../modules/socials"
import type SocialsService from "../modules/socials/service"
import type { WhatsAppPlatformApiConfig } from "../modules/socials/types/whatsapp-platform"

/**
 * One-time migration for multi-number WhatsApp support.
 *
 * Before multi-number: at most one SocialPlatform row held the global
 * WhatsApp config.
 * After multi-number: each WhatsApp number is a separate SocialPlatform row
 * with optional `is_default`, `country_codes`, and `label` fields inside
 * `api_config`.
 *
 * This script guarantees backwards compatibility by ensuring exactly one
 * WhatsApp SocialPlatform is marked `is_default: true`:
 *   - If a row already has `is_default: true` → no-op.
 *   - Otherwise the first/only row gets `is_default: true`.
 *
 * It does NOT populate `country_codes` — that's a conscious per-number
 * choice made by the admin (e.g. "+91" for the India number, "+61" for
 * Australia). The multi-number resolver falls back to the default platform
 * when `country_codes` is empty, so leaving it empty preserves current
 * routing behavior.
 *
 * Run:
 *   npx medusa exec ./src/scripts/backfill-whatsapp-default-platform.ts
 *
 * Env:
 *   DRY_RUN=1   print plan without writing
 */
export default async function backfillWhatsAppDefaultPlatform({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const socials = container.resolve(SOCIALS_MODULE) as unknown as SocialsService
  const dryRun = process.env.DRY_RUN === "1"

  const platforms = await socials.findWhatsAppPlatforms()
  if (platforms.length === 0) {
    logger.info("[backfill-whatsapp] No WhatsApp SocialPlatform rows found — nothing to do")
    return
  }

  const already = platforms.filter(
    (p: any) => (p.api_config as WhatsAppPlatformApiConfig | null)?.is_default === true
  )

  if (already.length === 1) {
    logger.info(
      `[backfill-whatsapp] Default already set on platform ${already[0].id} (${
        (already[0].api_config as unknown as WhatsAppPlatformApiConfig).phone_number_id
      })`
    )
    return
  }

  if (already.length > 1) {
    logger.warn(
      `[backfill-whatsapp] ${already.length} platforms marked is_default — keeping the first (${already[0].id}) and clearing the rest`
    )
    for (const p of already.slice(1)) {
      logger.info(`[backfill-whatsapp] ${dryRun ? "[dry-run] " : ""}clearing is_default on ${p.id}`)
      if (dryRun) continue
      await socials.updateSocialPlatforms([
        {
          selector: { id: p.id },
          data: {
            api_config: {
              ...((p.api_config as Record<string, unknown>) ?? {}),
              is_default: false,
            },
          },
        },
      ])
    }
    return
  }

  // No row has is_default yet — pick the first configured one.
  const target = platforms[0]
  logger.info(
    `[backfill-whatsapp] ${dryRun ? "[dry-run] " : ""}setting is_default=true on platform ${target.id} (${
      (target.api_config as unknown as WhatsAppPlatformApiConfig).phone_number_id
    })`
  )
  if (dryRun) return

  await socials.updateSocialPlatforms([
    {
      selector: { id: target.id },
      data: {
        api_config: {
          ...((target.api_config as Record<string, unknown>) ?? {}),
          is_default: true,
        },
      },
    },
  ])

  logger.info("[backfill-whatsapp] Done")
}
