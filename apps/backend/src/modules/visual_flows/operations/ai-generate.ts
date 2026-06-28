import { z } from "@medusajs/framework/zod"
import { generateText } from "ai"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateString } from "./utils"
import {
  resolveRoleTextModel,
  buildGenerateArgs,
  logAiUsage,
} from "../../../mastra/services/ai-platforms"

/**
 * General-purpose AI text generation, platform-aware.
 *
 * The composable building block for "call External Platforms by category/role"
 * in the flow editor: resolves the admin-configured platform for `role`
 * (category=ai, metadata.role) via the shared resolver, falling back to FREE
 * models when none is configured. Free-form text is written to the data chain
 * as `{{ $last.text }}` so downstream operations can consume it.
 *
 * Sibling of `ai_extract_platform` (structured JSON out). This one returns text
 * and uses `resolveRoleTextModel`, so it degrades to free models instead of
 * erroring when a role has no platform. System prompt is folded for
 * OpenAI-compatible providers (DashScope/Cloudflare) via `buildGenerateArgs`,
 * which keeps DashScope from rejecting the `developer` role (see #752).
 */
export const aiGenerateOperation: OperationDefinition = {
  type: "ai_generate",
  name: "AI Generate (Platform)",
  description:
    "Generate free-form text using the admin-configured AI platform for the " +
    "given role (Settings → External Platforms, category=ai). Falls back to " +
    "free models when no platform is set. Output: {{ $last.text }}.",
  icon: "sparkles",
  category: "integration",

  optionsSchema: z.object({
    role: z
      .string()
      .default("ai_search_chat")
      .describe(
        "AI role to resolve the platform for (metadata.role on the external " +
          "platform row, e.g. ai_search_chat, ai_newsletter_drafter)."
      ),
    input: z
      .string()
      .describe("Prompt sent to the model (supports {{ variable }} interpolation)"),
    system_prompt: z
      .string()
      .optional()
      .describe("System instructions (supports {{ variable }} interpolation)"),
    model_override: z
      .string()
      .optional()
      .describe("Override the platform's default_model for this call only"),
    max_output_tokens: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap the response length"),
    fallback_on_error: z
      .boolean()
      .default(false)
      .describe("Return empty text instead of failing the flow on error"),
    mock_response: z
      .string()
      .optional()
      .describe("If set, skip the AI call and return this text directly (testing)"),
  }),

  defaultOptions: {
    role: "ai_search_chat",
    input: "",
    system_prompt: "",
    fallback_on_error: false,
  },

  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    if (typeof options.mock_response === "string") {
      return { success: true, data: { text: options.mock_response } }
    }

    const role = options.role || "ai_search_chat"
    const input = interpolateString(options.input, context.dataChain)
    const system = options.system_prompt
      ? interpolateString(options.system_prompt, context.dataChain)
      : undefined

    let logger: any
    try {
      logger = (context.container as any)?.resolve?.("logger")
    } catch {
      /* logger optional */
    }

    const resolved = await resolveRoleTextModel(
      context.container as any,
      role,
      options.model_override || undefined
    )
    const started = Date.now()
    try {
      const result = await generateText({
        model: resolved.model as any,
        ...buildGenerateArgs({ providerType: resolved.providerType }, system, input),
        ...(options.max_output_tokens
          ? { maxOutputTokens: options.max_output_tokens }
          : {}),
      })
      const text = (result.text || "").trim()
      logAiUsage(logger, {
        feature: "visual-flow/ai_generate",
        role,
        provider: resolved.providerType,
        source: resolved.source,
        model: resolved.modelId,
        platformId: resolved.platformId,
        ok: true,
        ms: Date.now() - started,
        tokens: (result as any)?.usage?.totalTokens,
      })
      return { success: true, data: { text } }
    } catch (error: any) {
      const message =
        error?.responseBody ?? error?.cause?.message ?? error?.message ?? String(error)
      logAiUsage(logger, {
        feature: "visual-flow/ai_generate",
        role,
        provider: resolved.providerType,
        source: resolved.source,
        model: resolved.modelId,
        platformId: resolved.platformId,
        ok: false,
        ms: Date.now() - started,
        error,
      })
      if (options.fallback_on_error) {
        return { success: true, data: { text: "" } }
      }
      return { success: false, error: message, errorStack: error?.stack }
    }
  },
}
