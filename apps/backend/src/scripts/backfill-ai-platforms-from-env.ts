/**
 * Backfill AI platform rows in the SocialPlatform table from existing
 * environment variables.
 *
 * Reads:
 *   OPENROUTER_API_KEY
 *   DASHSCOPE_API_KEY
 *   STOREFRONT_SEARCH_DASHSCOPE_MODEL      (defaults to qwen-turbo)
 *   CLOUDFLARE_AI_ACCOUNT_ID
 *   CLOUDFLARE_AI_TOKEN
 *   STOREFRONT_SEARCH_CLOUDFLARE_MODEL     (defaults to @cf/meta/llama-3.1-8b-instruct)
 *   PRODUCT_SEARCH_EMBED_PROVIDER          (decides which platform owns
 *                                          ai_search_embed if any)
 *
 * Creates one platform per (provider, role) pair, with `metadata.role`,
 * `metadata.provider_type`, and `metadata.is_default` set so the new
 * lookup (mastra/services/ai-platforms.ts) picks them up. The credentials
 * subscriber encrypts api_key in place after creation.
 *
 * Priority for the `is_default` flag mirrors the env-fallback chain
 * already in extract.ts: OpenRouter > DashScope > Cloudflare for chat.
 * Embed picks the explicit PRODUCT_SEARCH_EMBED_PROVIDER (or DashScope
 * when nothing is set and only DashScope creds are present, etc.).
 *
 * Idempotent: looks for an existing platform with the same name first
 * and skips if found. To force-re-create, delete the row in the admin
 * UI before re-running.
 *
 * Usage:
 *   pnpm --filter @jyt/backend exec medusa exec \
 *     ./src/scripts/backfill-ai-platforms-from-env.ts
 *
 * Options (env):
 *   DRY_RUN=1                Print what would be created, don't write
 */
import { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import { createSocialPlatformWorkflow } from "../workflows/socials/create-social-platform"
import { SOCIALS_MODULE } from "../modules/socials"
import type SocialsService from "../modules/socials/service"

type ProviderType =
  | "openrouter"
  | "dashscope"
  | "cloudflare"
  | "vercel_ai_gateway"
  | "custom"

type Role = "ai_search_chat" | "ai_search_embed" | "ai_product_description"

type PlatformPlan = {
  name: string
  provider_type: ProviderType
  role: Role
  is_default: boolean
  api_key: string
  base_url?: string
  account_id?: string
  default_model?: string
}

const planFromEnv = (): PlatformPlan[] => {
  const plans: PlatformPlan[] = []

  // ── Chat role: OpenRouter (default if present) → DashScope → Cloudflare ──
  let chatDefaultClaimed = false
  if (process.env.OPENROUTER_API_KEY) {
    plans.push({
      name: "OpenRouter (env backfill)",
      provider_type: "openrouter",
      role: "ai_search_chat",
      is_default: true,
      api_key: process.env.OPENROUTER_API_KEY,
      default_model:
        process.env.OPENROUTER_DEFAULT_MODEL ||
        "meta-llama/llama-3.3-70b-instruct:free",
    })
    chatDefaultClaimed = true
  }
  if (process.env.DASHSCOPE_API_KEY) {
    plans.push({
      name: "DashScope chat (env backfill)",
      provider_type: "dashscope",
      role: "ai_search_chat",
      is_default: !chatDefaultClaimed,
      api_key: process.env.DASHSCOPE_API_KEY,
      default_model:
        process.env.STOREFRONT_SEARCH_DASHSCOPE_MODEL || "qwen-turbo",
    })
    chatDefaultClaimed = true
  }
  if (process.env.CLOUDFLARE_AI_ACCOUNT_ID && process.env.CLOUDFLARE_AI_TOKEN) {
    plans.push({
      name: "Cloudflare AI chat (env backfill)",
      provider_type: "cloudflare",
      role: "ai_search_chat",
      is_default: !chatDefaultClaimed,
      api_key: process.env.CLOUDFLARE_AI_TOKEN,
      account_id: process.env.CLOUDFLARE_AI_ACCOUNT_ID,
      default_model:
        process.env.STOREFRONT_SEARCH_CLOUDFLARE_MODEL ||
        "@cf/meta/llama-3.1-8b-instruct",
    })
  }

  // ── Embed role: driven by PRODUCT_SEARCH_EMBED_PROVIDER ────────────────
  // We only create rows for cloud-hosted embed providers (HF local has no
  // credentials to migrate). The default is set on whichever matches the
  // env switch.
  const embedProvider = String(
    process.env.PRODUCT_SEARCH_EMBED_PROVIDER ||
      process.env.ADMIN_RAG_EMBED_PROVIDER ||
      "hf_local"
  )
    .trim()
    .toLowerCase()

  if (process.env.DASHSCOPE_API_KEY) {
    plans.push({
      name: "DashScope embed (env backfill)",
      provider_type: "dashscope",
      role: "ai_search_embed",
      is_default: embedProvider === "dashscope" || embedProvider === "qwen",
      api_key: process.env.DASHSCOPE_API_KEY,
      default_model:
        process.env.PRODUCT_SEARCH_DASHSCOPE_MODEL || "text-embedding-v3",
    })
  }
  if (process.env.CLOUDFLARE_AI_ACCOUNT_ID && process.env.CLOUDFLARE_AI_TOKEN) {
    plans.push({
      name: "Cloudflare AI embed (env backfill)",
      provider_type: "cloudflare",
      role: "ai_search_embed",
      is_default: embedProvider === "cloudflare" || embedProvider === "cf",
      api_key: process.env.CLOUDFLARE_AI_TOKEN,
      account_id: process.env.CLOUDFLARE_AI_ACCOUNT_ID,
      default_model:
        process.env.PRODUCT_SEARCH_CLOUDFLARE_MODEL ||
        "@cf/baai/bge-base-en-v1.5",
    })
  }

  return plans
}

export default async function backfillAiPlatformsFromEnv({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const socials = container.resolve(SOCIALS_MODULE) as unknown as SocialsService
  const DRY_RUN = process.env.DRY_RUN === "1"

  const plans = planFromEnv()
  if (!plans.length) {
    logger.info(
      "[ai-platforms backfill] no AI provider env vars set — nothing to do. " +
        "Configure OPENROUTER_API_KEY, DASHSCOPE_API_KEY, or " +
        "CLOUDFLARE_AI_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN and re-run."
    )
    return
  }

  logger.info(
    `[ai-platforms backfill] planned ${plans.length} platform(s)${
      DRY_RUN ? " (DRY_RUN)" : ""
    }`
  )

  let created = 0
  let skipped = 0

  for (const plan of plans) {
    // Idempotency: skip if a platform with this exact name already exists.
    // Matching by name keeps the script re-runnable; admins can edit a
    // backfilled row without losing it on re-run.
    let existing: any[] = []
    try {
      existing = await socials.listSocialPlatforms({ name: plan.name }, {})
    } catch (e: any) {
      logger.warn(
        `[ai-platforms backfill] listSocialPlatforms failed for "${plan.name}": ${e?.message ?? e}`
      )
    }
    if (existing?.length) {
      skipped++
      logger.info(
        `[ai-platforms backfill] ↷ already exists: "${plan.name}" (id=${existing[0].id})`
      )
      continue
    }

    logger.info(
      `[ai-platforms backfill] + ${plan.name} ` +
        `[provider=${plan.provider_type}, role=${plan.role}, default=${plan.is_default}]`
    )
    if (DRY_RUN) {
      created++
      continue
    }

    try {
      // api_key is sent plaintext; the social-platform-credentials-encryption
      // subscriber fires on social_platform.created and encrypts in place.
      const apiConfig: Record<string, unknown> = {
        api_key: plan.api_key,
        ...(plan.default_model ? { default_model: plan.default_model } : {}),
        ...(plan.account_id ? { account_id: plan.account_id } : {}),
        ...(plan.base_url ? { base_url: plan.base_url } : {}),
      }
      await createSocialPlatformWorkflow(container as any).run({
        input: {
          name: plan.name,
          category: "ai",
          auth_type: "bearer",
          status: "active",
          base_url: plan.base_url,
          api_config: apiConfig,
          metadata: {
            provider_type: plan.provider_type,
            role: plan.role,
            is_default: plan.is_default,
            source: "env_backfill",
          },
        },
      })
      created++
    } catch (e: any) {
      logger.error(
        `[ai-platforms backfill] ✗ failed to create "${plan.name}": ${e?.message ?? e}`
      )
    }
  }

  logger.info(
    `[ai-platforms backfill] done. created=${created} skipped=${skipped}`
  )
  logger.info(
    `[ai-platforms backfill] next: visit /admin/settings/external-platforms ` +
      `to verify and (optionally) clear the corresponding env vars.`
  )
}
