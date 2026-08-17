/**
 * Cloudflare credentials, sourced from the external-platform store.
 *
 * Mirrors `shipping-providers/resolver.ts`: an admin stores the credentials as
 * a `SocialPlatform` row (`category: "hosting"`, `api_config.provider_type:
 * "cloudflare"`), the secret is encrypted at rest, and env vars remain as a
 * fallback so nothing breaks before a row exists.
 *
 * Why this moved off env: the env values silently rotted. The token was dead
 * AND the stored zone id pointed at a zone that no longer existed — and neither
 * is visible without making an API call, because `isCloudflareConfigured()`
 * only ever checked that the strings were PRESENT. A platform row is editable
 * by an operator without a redeploy, which is the actual point: env is read at
 * boot, so fixing a bad token used to mean shipping a release.
 *
 * ⚠️ The zone id is as perishable as the token. A zone that is deleted and
 * re-added to Cloudflare — or moved between accounts — keeps its NAME and gets
 * a NEW id, and the failure surfaces as `auth.zone_not_found` (reads like the
 * domain is gone) or `9109 Unauthorized` (reads like a permissions problem).
 * Neither names the real cause, so `zone_name` is stored alongside and
 * `resolveZoneIdByName` can recover the current id from the API.
 */
import { MedusaContainer } from "@medusajs/framework/types"
import { ENCRYPTION_MODULE } from "../../encryption"
import type EncryptionService from "../../encryption/service"
import { SOCIALS_MODULE } from "../../socials"

export const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4"

export type CloudflareCreds = {
  token: string
  zoneId?: string
  accountId?: string
  zoneName?: string
  /** Where these came from — surfaced in status payloads and logs so an
   *  operator can tell whether their platform row is actually being used. */
  source: "platform" | "env"
}

/** The api_config field names an operator fills in on the platform row. */
const TOKEN_FIELDS = ["api_token", "token", "api_key"] as const

/**
 * PURE: pick credentials out of an api_config.
 *
 * `decrypt` is injected so this is testable without the encryption module, and
 * so a decryption failure falls through to plaintext exactly the way the
 * shipping resolver does (a half-migrated row still works).
 */
export const pickCloudflareCreds = (
  apiConfig: Record<string, any> | null | undefined,
  decrypt?: (blob: string) => string
): Omit<CloudflareCreds, "source"> | null => {
  const cfg = apiConfig || {}

  let token: string | undefined
  for (const field of TOKEN_FIELDS) {
    const enc = cfg[`${field}_encrypted`]
    if (enc && decrypt) {
      try {
        const out = decrypt(enc)
        if (out) {
          token = out
          break
        }
      } catch {
        /* fall through to plaintext */
      }
    }
    const plain = cfg[field]
    if (typeof plain === "string" && plain.length) {
      token = plain
      break
    }
  }

  if (!token) return null

  const str = (v: any) =>
    typeof v === "string" && v.trim().length ? v.trim() : undefined

  return {
    token,
    zoneId: str(cfg.zone_id),
    accountId: str(cfg.account_id),
    zoneName: str(cfg.zone_name),
  }
}

/** Legacy env credentials. Kept so a deployment with no platform row behaves
 *  exactly as it did before. */
export const envCloudflareCreds = (
  env: NodeJS.ProcessEnv = process.env
): CloudflareCreds | null => {
  const token = env.CLOUDFLARE_API_TOKEN
  if (!token) return null
  return {
    token,
    zoneId: env.CLOUDFLARE_ZONE_ID,
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    source: "env",
  }
}

/** Find the active Cloudflare platform row, if one exists. */
const findCloudflarePlatform = async (
  container: MedusaContainer
): Promise<Record<string, any> | null> => {
  try {
    const socials = container.resolve(SOCIALS_MODULE) as any
    const platforms = await socials.listSocialPlatforms({
      category: "hosting",
      status: "active",
    })
    const match = (platforms || []).find((p: any) => {
      const cfg = (p.api_config as Record<string, any>) || {}
      const type = String(
        cfg.provider_type || cfg.provider || p.name || ""
      ).toLowerCase()
      return type === "cloudflare" || type.includes("cloudflare")
    })
    return match || null
  } catch {
    // socials module unavailable — caller falls back to env
    return null
  }
}

/**
 * Resolve Cloudflare credentials: platform row first, env second.
 *
 * Returns null when neither is configured, which callers treat as "skip DNS"
 * rather than an error — the same contract `isCloudflareConfigured()` had.
 */
export const resolveCloudflareCredentials = async (
  container?: MedusaContainer
): Promise<CloudflareCreds | null> => {
  if (container) {
    const platform = await findCloudflarePlatform(container)
    if (platform) {
      let decrypt: ((blob: string) => string) | undefined
      try {
        const encryption = container.resolve(
          ENCRYPTION_MODULE
        ) as EncryptionService
        decrypt = (blob: string) => (encryption as any).decrypt(blob)
      } catch {
        /* no encryption module — plaintext only */
      }

      const picked = pickCloudflareCreds(
        platform.api_config as Record<string, any>,
        decrypt
      )
      if (picked) return { ...picked, source: "platform" }
    }
  }
  return envCloudflareCreds()
}

/**
 * Look up a zone's CURRENT id by name.
 *
 * Exists because a stored zone id is a snapshot, not an identity: re-adding a
 * domain to Cloudflare gives it a new id while the name stays put. When that
 * happens every DNS call fails with an error that blames auth, so being able
 * to re-derive the id from the name is the difference between a one-line fix
 * and a day of chasing a permissions ghost.
 */
export const resolveZoneIdByName = async (
  creds: CloudflareCreds,
  zoneName: string
): Promise<string | null> => {
  const res = await fetch(
    `${CLOUDFLARE_API_BASE}/zones?name=${encodeURIComponent(zoneName)}`,
    {
      headers: {
        Authorization: `Bearer ${creds.token}`,
        "Content-Type": "application/json",
      },
    }
  )
  const data: any = await res.json().catch(() => null)
  if (!data?.success) return null
  const zone = (data.result || [])[0]
  return zone?.id ?? null
}
