import { z } from "@medusajs/framework/zod"
import { generateText } from "ai"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateString } from "./utils"
import { extractionEvalWorkflow } from "../../../mastra/workflows/extractionEval"
import {
  resolveRoleTextModel,
  buildGenerateArgs,
  logAiUsage,
} from "../../../mastra/services/ai-platforms"

interface SchemaField {
  name: string
  type: "string" | "number" | "boolean" | "enum" | "array" | "object"
  description?: string
  enumValues?: string[]
  required?: boolean
}

/**
 * Convert schema_fields into a plain-text JSON shape description appended to
 * the system prompt. Works with every model regardless of tool/schema support.
 */
function buildSchemaHint(fields: SchemaField[]): string {
  if (!fields.length) return ""

  const lines = fields.map((f) => {
    const typeStr =
      f.type === "enum"
        ? `enum(${(f.enumValues || []).join(" | ")})`
        : f.type
    const req = f.required ? " [required]" : " [optional]"
    const desc = f.description ? ` // ${f.description}` : ""
    return `  "${f.name}": ${typeStr}${req}${desc}`
  })

  return `\n\nReturn ONLY a valid JSON object — no markdown, no explanation, no code fences:\n{\n${lines.join(",\n")}\n}`
}

/** Extract the first {...} block from model output and parse it as JSON. */
function extractJson(raw: string): Record<string, any> {
  // Strip markdown code fences
  const stripped = raw
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/```\s*$/m, "")
    .trim()

  // Try direct parse first
  try {
    return JSON.parse(stripped)
  } catch {}

  // Extract first {...} block in case the model added surrounding prose
  const match = stripped.match(/\{[\s\S]*\}/)
  if (match) {
    return JSON.parse(match[0])
  }

  throw new Error(
    `Model did not return valid JSON. Raw response (first 400 chars): ${raw.slice(0, 400)}`
  )
}

export const aiExtractOperation: OperationDefinition = {
  type: "ai_extract",
  name: "AI Extract",
  description: "Ask an AI model to extract structured JSON data from text",
  icon: "sparkles",
  category: "integration",

  optionsSchema: z.object({
    role: z
      .string()
      .default("ai_search_chat")
      .describe(
        "AI role to resolve the platform for (metadata.role on the external " +
          "platform row). The model/provider/key come from Settings → External " +
          "Platforms (category=ai); falls back to free models when none is set."
      ),
    model: z
      .string()
      .optional()
      .describe(
        "DEPRECATED — legacy OpenRouter model id. Ignored once a platform is " +
          "configured for `role`; configure the model on the platform instead."
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
    fallback_on_error: z
      .boolean()
      .default(false)
      .describe("Return empty object instead of failing the flow on error"),
    mock_response: z
      .record(z.string(), z.any())
      .optional()
      .describe("If set, skip the AI call and return this object directly (useful for testing)"),
    use_mastra_eval: z
      .boolean()
      .default(false)
      .describe(
        "Run the extraction through the Mastra extraction-eval workflow: scores quality, " +
        "triggers a refinement pass if below threshold, and returns the best result"
      ),
  }),

  defaultOptions: {
    role: "ai_search_chat",
    input: "",
    system_prompt: "Extract order information from this email.",
    schema_fields: [],
    fallback_on_error: false,
  },

  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    // Short-circuit: return mock data without calling the AI model
    if (options.mock_response) {
      console.log("[ai_extract] Using mock_response:", options.mock_response)
      return { success: true, data: options.mock_response }
    }

    // Mastra eval path: extract → score → refine → return best result
    if (options.use_mastra_eval) {
      try {
        const input = interpolateString(options.input, context.dataChain)
        console.log("[ai_extract] Delegating to extractionEvalWorkflow")

        const run = await extractionEvalWorkflow.createRun();
        
        const  result  = await run.start({
          inputData: {
            input,
            system_prompt: options.system_prompt,
            schema_fields: options.schema_fields ?? [],
            // Opt-in legacy eval path still runs on OpenRouter; the platform
            // migration covers the default (non-eval) path. See #755.
            model: options.model || "google/gemini-2.5-flash-preview",
          },
        })

        // Surface eval metadata as top-level keys alongside the extracted fields
        return {
          success: true,
          data: {
            ...result.steps.extracted_data, // The extracted JSON object from the model
            _eval: {
              score: result.steps.score,
              quality: result.steps.quality,
              was_refined: result.steps.was_refined,
              missing_fields: result.steps.missing_fields,
            },
          },
        }
      } catch (evalErr: any) {
        console.error("[ai_extract] extractionEvalWorkflow failed:", evalErr.message)
        if (options.fallback_on_error) {
          return { success: true, data: {} }
        }
        return { success: false, error: evalErr.message, errorStack: evalErr.stack }
      }
    }

    const role = options.role || "ai_search_chat"
    let logger: any
    try {
      logger = (context.container as any)?.resolve?.("logger")
    } catch {
      /* logger optional */
    }

    // Resolve the model from the admin-configured platform for the role, else
    // free models. Folds the system prompt for OpenAI-compatible providers
    // (DashScope rejects the `developer` role @ai-sdk/openai emits — #752).
    const resolved = await resolveRoleTextModel(
      context.container as any,
      role,
      options.model || undefined
    )
    const started = Date.now()
    try {
      const fields: SchemaField[] = options.schema_fields || []
      const input = interpolateString(options.input, context.dataChain)

      // Build the full system prompt: user instructions + JSON shape hint from fields
      const systemPrompt = [
        options.system_prompt || "",
        buildSchemaHint(fields),
      ]
        .join("")
        .trim()

      const result = await generateText({
        model: resolved.model as any,
        ...buildGenerateArgs({ providerType: resolved.providerType }, systemPrompt, input),
      })

      const object = extractJson(result.text)

      logAiUsage(logger, {
        feature: "visual-flow/ai_extract",
        role,
        provider: resolved.providerType,
        source: resolved.source,
        model: resolved.modelId,
        platformId: resolved.platformId,
        ok: true,
        ms: Date.now() - started,
        tokens: (result as any)?.usage?.totalTokens,
      })

      return {
        success: true,
        data: object,
      }
    } catch (error: any) {
      const message =
        error?.responseBody ?? error?.cause?.message ?? error?.message ?? String(error)
      logAiUsage(logger, {
        feature: "visual-flow/ai_extract",
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
        return { success: true, data: {} }
      }

      return { success: false, error: message, errorStack: error?.stack }
    }
  },
}
