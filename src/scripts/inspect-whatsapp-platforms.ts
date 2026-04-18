import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../modules/socials"
import type SocialsService from "../modules/socials/service"
import type { WhatsAppPlatformApiConfig } from "../modules/socials/types/whatsapp-platform"
import { ENCRYPTION_MODULE } from "../modules/encryption"
import type EncryptionService from "../modules/encryption/service"
import type { EncryptedData } from "../modules/encryption"

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0"

/**
 * Diagnostic: print every WhatsApp SocialPlatform row with non-secret config
 * fields. Useful when the sender picker, templates, or webhook routing is
 * misbehaving and you want to see what's actually in the DB.
 *
 * Run:
 *   npx medusa exec ./src/scripts/inspect-whatsapp-platforms.ts
 */
export default async function inspectWhatsAppPlatforms({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const socials = container.resolve(SOCIALS_MODULE) as unknown as SocialsService
  const encryption = container.resolve(ENCRYPTION_MODULE) as EncryptionService
  const verify = process.env.VERIFY_WABA === "1"

  const platforms = await socials.findWhatsAppPlatforms()
  logger.info(`Found ${platforms.length} WhatsApp SocialPlatform row(s)\n`)

  if (platforms.length === 0) {
    logger.info("  (none — create one via Settings > External Platforms > Create)")
    return
  }

  const defaults = platforms.filter(
    (p: any) => (p.api_config as WhatsAppPlatformApiConfig | null)?.is_default === true
  )
  if (defaults.length > 1) {
    logger.warn(
      `⚠️  ${defaults.length} rows are marked is_default: true — should be at most one. ` +
        `Run: medusa exec ./src/scripts/backfill-whatsapp-default-platform.ts`
    )
  } else if (defaults.length === 0) {
    logger.warn(
      `⚠️  No row marked is_default: true — resolver will fall back to the first row. ` +
        `Set one explicitly via the admin UI toggle.`
    )
  }

  for (const p of platforms as any[]) {
    const cfg = (p.api_config ?? {}) as WhatsAppPlatformApiConfig & Record<string, any>
    const dup = platforms.filter(
      (q: any) =>
        (q.api_config as WhatsAppPlatformApiConfig | null)?.phone_number_id === cfg.phone_number_id
    )
    const hasDup = dup.length > 1

    logger.info(`─ ${p.id} ${p.status !== "active" ? `[${p.status}]` : ""}`)
    logger.info(`  name:                   ${p.name}`)
    logger.info(`  label:                  ${cfg.label ?? "(none)"}`)
    logger.info(`  phone_number_id:        ${cfg.phone_number_id ?? "(missing)"}${hasDup ? "  ⚠️ duplicate" : ""}`)
    logger.info(`  waba_id:                ${cfg.waba_id ?? "(missing)"}`)
    logger.info(`  display_phone_number:   ${cfg.display_phone_number ?? "(unset)"}`)
    logger.info(`  verified_name:          ${cfg.verified_name ?? "(unset)"}`)
    logger.info(`  country_codes:          ${JSON.stringify(cfg.country_codes ?? [])}`)
    logger.info(`  is_default:             ${cfg.is_default === true}`)
    logger.info(`  provider:               ${cfg.provider ?? "(unset — pre-multi-number row)"}`)
    logger.info(`  access_token:           ${hasToken(cfg) ? "✓ configured" : "✗ missing"}`)
    logger.info(`  app_secret:             ${hasAppSecret(cfg) ? "✓ configured" : "✗ missing"}`)
    logger.info(`  webhook_verify_token:   ${hasVerifyToken(cfg) ? "✓ configured" : "✗ missing"}`)
    logger.info(`  templates cached:       ${Array.isArray(cfg.templates) ? cfg.templates.length : 0}`)
    logger.info(`  templates_synced_at:    ${cfg.templates_synced_at ?? "(never)"}`)
    logger.info(`  initiation_template:    ${cfg.initiation_template ?? "(unset)"}`)

    if (verify && cfg.phone_number_id && cfg.waba_id) {
      const token = decryptToken(cfg, encryption)
      if (!token) {
        logger.warn(`  meta-check:             skipped (no usable access token)`)
      } else {
        // Ask the stored WABA for its phone numbers. If our phone_number_id
        // shows up in the list, the waba_id is correct. If not, it's wrong
        // and the response tells us the correct display_phone_number to
        // disambiguate which row it should be.
        const key = `${cfg.waba_id}::${token.slice(0, 12)}`
        const numbers = await getCachedWabaPhoneNumbers(key, cfg.waba_id, token)
        if ("error" in numbers) {
          logger.warn(`  meta-check:             failed — ${numbers.error}`)
        } else {
          const owned = numbers.data.find((n) => n.id === cfg.phone_number_id)
          if (owned) {
            logger.info(`  meta-check:             ✓ WABA owns this phone (${owned.display_phone_number} · ${owned.verified_name})`)
          } else {
            const list = numbers.data.map((n) => `${n.id} (${n.display_phone_number})`).join(", ") || "(none)"
            logger.warn(
              `  ⚠️  stored waba_id ${cfg.waba_id} does NOT own phone ${cfg.phone_number_id}. ` +
                `That WABA owns: ${list}`
            )
          }
        }
      }
    }
    logger.info("")
  }

  // Spot a common footgun: rows whose `name` isn't "WhatsApp" AND whose
  // `api_config.provider` isn't "whatsapp" — they won't be found by the
  // multi-number resolver.
  const orphans = platforms.filter((p: any) => {
    const cfg = p.api_config as Record<string, any> | null
    return cfg?.provider !== "whatsapp" && p.name !== "WhatsApp"
  })
  if (orphans.length > 0) {
    logger.warn(
      `⚠️  ${orphans.length} row(s) lack both name="WhatsApp" and api_config.provider="whatsapp" — ` +
        `findWhatsAppPlatforms() will skip them. Fix via the edit form.`
    )
  }
}

function hasToken(cfg: any): boolean {
  return !!(cfg.access_token_encrypted || cfg.access_token)
}
function hasAppSecret(cfg: any): boolean {
  return !!(cfg.app_secret_encrypted || cfg.app_secret)
}
function hasVerifyToken(cfg: any): boolean {
  return !!(cfg.webhook_verify_token_encrypted || cfg.webhook_verify_token)
}

function decryptToken(cfg: any, encryption: EncryptionService): string | null {
  if (cfg.access_token_encrypted) {
    try {
      return encryption.decrypt(cfg.access_token_encrypted as EncryptedData)
    } catch {
      return cfg.access_token || null
    }
  }
  return cfg.access_token || null
}

interface PhoneNumber {
  id: string
  display_phone_number: string
  verified_name: string
}

type WabaPhoneResult = { data: PhoneNumber[] } | { error: string }

const wabaCache = new Map<string, WabaPhoneResult>()

async function getCachedWabaPhoneNumbers(
  cacheKey: string,
  wabaId: string,
  accessToken: string
): Promise<WabaPhoneResult> {
  const cached = wabaCache.get(cacheKey)
  if (cached) return cached
  const result = await fetchWabaPhoneNumbers(wabaId, accessToken)
  wabaCache.set(cacheKey, result)
  return result
}

async function fetchWabaPhoneNumbers(
  wabaId: string,
  accessToken: string
): Promise<WabaPhoneResult> {
  const url = `${GRAPH_API_BASE}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`
  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = (await resp.json()) as any
    if (!resp.ok) {
      const msg = data?.error?.message || `HTTP ${resp.status}`
      return { error: msg }
    }
    return { data: (data.data ?? []) as PhoneNumber[] }
  } catch (e: any) {
    return { error: e?.message || "network error" }
  }
}
