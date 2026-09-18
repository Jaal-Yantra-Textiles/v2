/**
 * Shared model resolution for the WhatsApp free-form + intent pipelines.
 *
 * One resolver so the intent "query planner" and the free-form reply pick the
 * same model, and so a deployment with only Groq / Cloudflare keys (no
 * admin-configured External Platform) still reaches a live model — which the
 * old `openrouter/free`-only fallback could not.
 *
 * Resolution order:
 *   1. Admin-configured External Platform tagged `ai_whatsapp_partner_chat`
 *      (then `ai_partner_assistant`).
 *   2. Groq env (`GROQ_API_KEY`) — OpenAI-compatible, free tier.
 *   3. Cloudflare Workers AI env (`CLOUDFLARE_AI_ACCOUNT_ID` + token).
 *   4. OpenRouter `openrouter/free` tool-capable model.
 *
 * Never throws — always returns a usable model (the free one, worst case).
 */
import { createOpenAI } from "@ai-sdk/openai"
import { getAiPlatformForRole, buildChatModel, type AiProviderType } from "../../mastra/services/ai-platforms"
import { dynamicFreeToolTextModel } from "../../mastra/providers/dynamic-text-model"
import { FREEFORM_ROLE } from "./whatsapp-freeform-prompt"

export type WhatsAppModel = {
  model: any
  providerType: AiProviderType
  source: "platform" | "env" | "free"
  modelId?: string
  platformId?: string
}

const GROQ_BASE = "https://api.groq.com/openai/v1"
const GROQ_MODEL = process.env.WHATSAPP_GROQ_MODEL || "openai/gpt-oss-120b"

const CLOUDFLARE_MODEL =
  process.env.WHATSAPP_CLOUDFLARE_MODEL || "@cf/deepseek-ai/deepseek-v4-pro-0813"

export async function resolveWhatsAppModel(scope: any): Promise<WhatsAppModel> {
  // 1. Admin-configured platform.
  for (const role of [FREEFORM_ROLE, "ai_partner_assistant"]) {
    try {
      const cfg = await getAiPlatformForRole(scope, role as any)
      if (cfg) {
        return {
          model: buildChatModel(cfg),
          providerType: cfg.providerType,
          source: "platform",
          modelId: cfg.defaultModel ?? undefined,
          platformId: cfg.platformId,
        }
      }
    } catch {
      /* try next */
    }
  }

  // 2. Groq env.
  if (process.env.GROQ_API_KEY) {
    const client = createOpenAI({ baseURL: GROQ_BASE, apiKey: process.env.GROQ_API_KEY })
    return { model: client.chat(GROQ_MODEL), providerType: "groq", source: "env", modelId: GROQ_MODEL }
  }

  // 3. Cloudflare Workers AI env.
  const accountId = process.env.CLOUDFLARE_AI_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_AI_TOKEN
  if (accountId && token) {
    const client = createOpenAI({
      baseURL: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
      apiKey: token,
    })
    return {
      model: client.chat(CLOUDFLARE_MODEL),
      providerType: "cloudflare",
      source: "env",
      modelId: CLOUDFLARE_MODEL,
    }
  }

  // 4. OpenRouter free tool-capable model.
  return {
    model: dynamicFreeToolTextModel,
    providerType: "openrouter",
    source: "free",
    modelId: "openrouter/free",
  }
}