import { z } from "@medusajs/framework/zod"
import { generateText } from "ai"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateString } from "./utils"
import {
  getAiPlatformForRole,
  buildChatModel,
  buildGenerateArgs,
} from "../../../mastra/services/ai-platforms"

interface SchemaField {
  name: string
  type: "string" | "number" | "boolean" | "enum" | "array" | "object"
  description?: string
  enumValues?: string[]
  required?: boolean
}

function buildSchemaHint(fields: SchemaField[]): string {
  if (!fields.length) return ""
  const lines = fields.map((f) => {
    const typeStr =
      f.type === "enum" ? `enum(${(f.enumValues || []).join(" | ")})` : f.type
    const req = f.required ? " [required]" : " [optional]"
    const desc = f.description ? ` // ${f.description}` : ""
    return `  "${f.name}": ${typeStr}${req}${desc}`
  })
  return `\n\nReturn ONLY a valid JSON object — no markdown, no explanation, no code fences:\n{\n${lines.join(",\n")}\n}`
}

function extractJson(raw: string): Record<string, any> {
  const stripped = raw
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/```\s*$/m, "")
    .trim()
  try {
    return JSON.parse(stripped)
  } catch {}
  const match = stripped.match(/\{[\s\S]*\}/)
  if (match) return JSON.parse(match[0])
  throw new Error(
    `Model did not return valid JSON. Raw response (first 400 chars): ${raw.slice(0, 400)}`
  )
}

/**
 * Platform-aware structured extraction.
 *
 * Unlike `ai_extract` which hardcodes OpenRouter + a fixed model id, this
 * operation resolves provider + api_key + base_url + default_model from
 * the admin-configured External Platform with `category="ai"` and the
 * given `metadata.role`. Switching providers (DashScope ↔ OpenRouter ↔
 * Cloudflare) or rotating an API key becomes a UI action — no flow edit,
 * no redeploy.
 *
 * Why a separate op (instead of extending ai_extract)
 *   - Backwards-compat with existing flows that hardcode `model`.
 *   - Clear discoverability — the flow author sees "AI Extract (Platform)"
 *     in the picker and knows the model is admin-configured, not stamped
 *     into the flow definition.
 *   - Future divergence: vision / multimodal / tool use are easier to
 *     add here without bloating the legacy op's options schema.
 */
export const aiExtractPlatformOperation: OperationDefinition = {
  type: "ai_extract_platform",
  name: "AI Extract (Platform)",
  description:
    "Extract structured JSON using the admin-configured AI platform for the " +
    "given role. Provider, API key, base URL, and default model are read from " +
    "Settings → External Platforms (category=ai).",
  icon: "sparkles",
  category: "integration",

  optionsSchema: z.object({
    role: z
      .string()
      .default("ai_search_chat")
      .describe(
        "AI role to resolve the platform for. Matches metadata.role on the " +
          "external platform row (e.g. ai_search_chat, ai_product_description)."
      ),
    input: z
      .string()
      .describe("Input text sent to the model (supports {{ variable }} interpolation)"),
    system_prompt: z
      .string()
      .optional()
      .describe("Instructions for the model — what to extract and how"),
    schema_fields: z
      .array(
        z.object({
          name: z.string(),
          type: z.enum(["string", "number", "boolean", "enum", "array", "object"]),
          description: z.string().optional(),
          enumValues: z.array(z.string()).optional(),
          required: z.boolean().optional(),
        })
      )
      .default([])
      .describe("Describe the JSON fields you want extracted (appended to system prompt)"),
    model_override: z
      .string()
      .optional()
      .describe(
        "Override the platform's default_model for this one extraction. " +
          "Leave empty to use whatever the admin configured on the platform."
      ),
    fallback_on_error: z
      .boolean()
      .default(false)
      .describe("Return empty object instead of failing the flow on error"),
    mock_response: z
      .record(z.string(), z.any())
      .optional()
      .describe("If set, skip the AI call and return this object directly (useful for testing)"),
  }),

  defaultOptions: {
    role: "ai_search_chat",
    input: "",
    system_prompt: "",
    schema_fields: [],
    fallback_on_error: false,
  },

  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    if (options.mock_response) {
      return { success: true, data: options.mock_response }
    }

    try {
      const role = options.role || "ai_search_chat"
      const fields: SchemaField[] = options.schema_fields || []
      const input = interpolateString(options.input, context.dataChain)

      const config = await getAiPlatformForRole(context.container as any, role)
      if (!config) {
        const msg = `No active AI platform configured for role "${role}". Configure one in Settings → External Platforms (category=ai, metadata.role=${role}).`
        if (options.fallback_on_error) {
          console.warn(`[ai_extract_platform] ${msg} (fallback_on_error → returning {})`)
          return { success: true, data: {} }
        }
        return { success: false, error: msg }
      }

      const systemPrompt = [
        options.system_prompt || "",
        buildSchemaHint(fields),
      ]
        .join("")
        .trim()

      const model = buildChatModel(config, options.model_override || undefined)
      const resolvedModelId =
        options.model_override || config.defaultModel || "(provider hint)"

      console.log("[ai_extract_platform] Calling model:", {
        platformId: config.platformId,
        provider: config.providerType,
        role,
        model: resolvedModelId,
        inputLength: input.length,
        inputPreview: input.slice(0, 150) + (input.length > 150 ? `… [${input.length} chars]` : ""),
        fields: fields.map((f) => f.name),
      })

      const result = await generateText({
        model: model as any,
        ...buildGenerateArgs(config, systemPrompt, input),
      })

      const object = extractJson(result.text)

      console.log("[ai_extract_platform] Extraction complete:", {
        model: resolvedModelId,
        usage: result.usage,
        keys: Object.keys(object),
      })

      return { success: true, data: object }
    } catch (error: any) {
      const message =
        error?.responseBody ?? error?.cause?.message ?? error?.message ?? String(error)
      console.error("[ai_extract_platform] Error:", message)

      if (options.fallback_on_error) {
        return { success: true, data: {} }
      }
      return { success: false, error: message, errorStack: error?.stack }
    }
  },
}
