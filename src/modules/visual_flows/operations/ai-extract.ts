import { z } from "@medusajs/framework/zod"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { generateText } from "ai"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateString } from "./utils"

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
    model: z
      .string()
      .default("google/gemini-2.0-flash-exp:free")
      .describe("OpenRouter model ID"),
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
  }),

  defaultOptions: {
    model: "google/gemini-2.0-flash-exp:free",
    input: "",
    system_prompt: "Extract order information from this email.",
    schema_fields: [],
    fallback_on_error: false,
  },

  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    try {
      const fields: SchemaField[] = options.schema_fields || []
      const input = interpolateString(options.input, context.dataChain)
      const modelId: string = options.model || "google/gemini-2.0-flash-exp:free"

      // Build the full system prompt: user instructions + JSON shape hint from fields
      const systemPrompt = [
        options.system_prompt || "",
        buildSchemaHint(fields),
      ]
        .join("")
        .trim()

      console.log("[ai_extract] Calling model:", modelId, {
        inputLength: input.length,
        inputPreview: input.slice(0, 150) + (input.length > 150 ? `… [${input.length} chars]` : ""),
        fields: fields.map((f) => f.name),
      })

      const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })

      const result = await generateText({
        model: openrouter(modelId) as any,
        messages: [{ role: "user", content: input }],
        ...(systemPrompt ? { system: systemPrompt } : {}),
      })

      const object = extractJson(result.text)

      console.log("[ai_extract] Extraction complete:", {
        model: modelId,
        usage: result.usage,
        keys: Object.keys(object),
      })

      return {
        success: true,
        data: { object, usage: result.usage },
      }
    } catch (error: any) {
      const message =
        error?.responseBody ?? error?.cause?.message ?? error?.message ?? String(error)
      console.error("[ai_extract] Error:", message)

      if (options.fallback_on_error) {
        return { success: true, data: { object: {}, usage: null } }
      }

      return { success: false, error: message, errorStack: error?.stack }
    }
  },
}
