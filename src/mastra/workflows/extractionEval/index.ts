// @ts-nocheck
/**
 * Extraction Eval Workflow
 *
 * Generic eval-enhanced extraction workflow usable for any text → structured JSON task.
 * It mirrors the `ai_extract` visual-flow operation's input schema so it can serve as
 * a quality-assured drop-in for any extraction node.
 *
 * Steps
 * ─────
 *  1. extractStep  — run generateText → parse JSON → raw extraction
 *  2. evalStep     — score field completeness + prompt alignment (Mastra LLM scorer)
 *  3. refineStep   — if score < threshold, re-prompt with targeted correction hints
 *
 * Output always includes:
 *   extraction   — the best available data object
 *   score        — 0–1 overall quality score
 *   quality      — "excellent" | "good" | "acceptable" | "poor"
 *   missing_fields — required fields still absent after refinement
 *   was_refined  — whether a refinement pass ran
 */

import { createWorkflow, createStep } from "@mastra/core/workflows"
import { z } from "zod"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { generateText } from "ai"
import { createPromptAlignmentScorerLLM } from "@mastra/evals/scorers/prebuilt"
import { dynamicFreeTextModel } from "../../providers/dynamic-text-model"

// ─── Constants ────────────────────────────────────────────────────────────────

/** Score below which a refinement pass is triggered. */
const QUALITY_THRESHOLD = 0.65

// ─── Schemas ──────────────────────────────────────────────────────────────────

const schemaFieldSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "enum", "array", "object"]),
  description: z.string().optional(),
  enumValues: z.array(z.string()).optional(),
  /** If true, absence of this field lowers the quality score. */
  required: z.boolean().optional(),
})

export const triggerSchema = z.object({
  /** The text to extract data from (email HTML, product description, invoice text, etc.). */
  input: z.string().min(1),
  /** What the model should extract and how. Appended with the auto-generated JSON shape hint. */
  system_prompt: z.string().optional(),
  /** Declare the fields you want. Required fields drive the quality score. */
  schema_fields: z.array(schemaFieldSchema).default([]),
  /** OpenRouter model ID — falls back to dynamic free model if omitted. */
  model: z.string().optional(),
})

export const evalResultSchema = z.object({
  /** Best available extraction result (merged original + refined). */
  extraction: z.record(z.any()),
  /** 0–1 composite quality score. */
  score: z.number().min(0).max(1),
  quality: z.enum(["excellent", "good", "acceptable", "poor"]),
  /** Required fields still missing after refinement (ideally empty). */
  missing_fields: z.array(z.string()),
  /** True when the refinement pass ran. */
  was_refined: z.boolean(),
})

export type ExtractionEvalResult = z.infer<typeof evalResultSchema>

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildSchemaHint(fields: z.infer<typeof schemaFieldSchema>[]): string {
  if (!fields.length) return ""
  const lines = fields.map((f) => {
    const typeStr = f.type === "enum" ? `enum(${(f.enumValues ?? []).join(" | ")})` : f.type
    const req = f.required ? " [required]" : " [optional]"
    const desc = f.description ? ` // ${f.description}` : ""
    return `  "${f.name}": ${typeStr}${req}${desc}`
  })
  return `\n\nReturn ONLY a valid JSON object — no markdown, no explanation, no code fences:\n{\n${lines.join(",\n")}\n}`
}

function parseJson(raw: string): Record<string, any> {
  const stripped = raw
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/```\s*$/m, "")
    .trim()
  try { return JSON.parse(stripped) } catch {}
  const m = stripped.match(/\{[\s\S]*\}/)
  if (m) return JSON.parse(m[0])
  throw new Error(`Model did not return valid JSON. Preview: ${raw.slice(0, 300)}`)
}

function requiredFields(fields: z.infer<typeof schemaFieldSchema>[]): string[] {
  return fields.filter((f) => f.required).map((f) => f.name)
}

function computeMissing(extraction: Record<string, any>, required: string[]): string[] {
  return required.filter((f) => {
    const v = extraction[f]
    return v === null || v === undefined || v === ""
  })
}

function qualityLabel(score: number): ExtractionEvalResult["quality"] {
  if (score >= 0.9) return "excellent"
  if (score >= 0.75) return "good"
  if (score >= QUALITY_THRESHOLD) return "acceptable"
  return "poor"
}

async function callModel(
  input: string,
  system: string,
  modelId: string | undefined
): Promise<Record<string, any>> {
  const model = modelId
    ? (createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })(modelId) as any)
    : dynamicFreeTextModel

  const result = await generateText({
    model,
    system,
    messages: [{ role: "user", content: input }],
  })
  return parseJson(result.text)
}

// ─── Step 1: Extract ──────────────────────────────────────────────────────────

const extractStep = createStep({
  id: "extract",
  inputSchema: triggerSchema,
  outputSchema: z.object({
    extraction: z.record(z.any()),
    input: z.string(),
    system_prompt: z.string().optional(),
    schema_fields: z.array(schemaFieldSchema),
    model: z.string().optional(),
    built_system_prompt: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { input, system_prompt, schema_fields, model } = inputData
    const hint = buildSchemaHint(schema_fields)
    const builtPrompt = [(system_prompt ?? "").trim(), hint].join("").trim()

    console.log("[extractionEval:extract] model:", model ?? "dynamic", "fields:", schema_fields.map((f) => f.name))

    const extraction = await callModel(input, builtPrompt, model).catch((err) => {
      console.warn("[extractionEval:extract] Failed, returning {}:", err.message)
      return {}
    })

    console.log("[extractionEval:extract] result:", extraction)
    return { extraction, input, system_prompt, schema_fields, model, built_system_prompt: builtPrompt }
  },
})

// ─── Step 2: Eval ─────────────────────────────────────────────────────────────

const evalStep = createStep({
  id: "eval",
  inputSchema: z.object({
    extraction: z.record(z.any()),
    input: z.string(),
    system_prompt: z.string().optional(),
    schema_fields: z.array(schemaFieldSchema),
    model: z.string().optional(),
    built_system_prompt: z.string(),
  }),
  outputSchema: z.object({
    extraction: z.record(z.any()),
    score: z.number(),
    missing_fields: z.array(z.string()),
    input: z.string(),
    system_prompt: z.string().optional(),
    schema_fields: z.array(schemaFieldSchema),
    model: z.string().optional(),
    built_system_prompt: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { extraction, input, schema_fields, built_system_prompt, ...rest } = inputData

    const required = requiredFields(schema_fields)
    const missing = computeMissing(extraction, required)

    // Completeness: fraction of required fields present (1.0 if no required fields declared)
    const completenessScore = required.length === 0
      ? 1
      : (required.length - missing.length) / required.length

    // Prompt alignment via Mastra LLM scorer
    let alignmentScore = completenessScore
    try {
      const scorer = createPromptAlignmentScorerLLM({
        model: dynamicFreeTextModel,
        instructions: built_system_prompt,
      })
      const result = await scorer.score({
        input,
        output: JSON.stringify(extraction),
      })
      alignmentScore = typeof result?.score === "number"
        ? Math.max(0, Math.min(1, result.score))
        : completenessScore
      console.log("[extractionEval:eval] Alignment scorer:", result)
    } catch (err) {
      console.warn("[extractionEval:eval] Scorer unavailable, using completeness only:", (err as any).message)
    }

    // Weighted: completeness 60%, prompt alignment 40%
    const score = completenessScore * 0.6 + alignmentScore * 0.4

    console.log("[extractionEval:eval]", { completenessScore, alignmentScore, score, missing })
    return { extraction, score, missing_fields: missing, input, schema_fields, built_system_prompt, ...rest }
  },
})

// ─── Step 3: Refine ───────────────────────────────────────────────────────────

const refineStep = createStep({
  id: "refine",
  inputSchema: z.object({
    extraction: z.record(z.any()),
    score: z.number(),
    missing_fields: z.array(z.string()),
    input: z.string(),
    system_prompt: z.string().optional(),
    schema_fields: z.array(schemaFieldSchema),
    model: z.string().optional(),
    built_system_prompt: z.string(),
  }),
  outputSchema: evalResultSchema,
  execute: async ({ inputData }) => {
    const { extraction, score, missing_fields, input, schema_fields, model, built_system_prompt } = inputData

    if (score >= QUALITY_THRESHOLD || missing_fields.length === 0) {
      return { extraction, score, quality: qualityLabel(score), missing_fields, was_refined: false }
    }

    console.log("[extractionEval:refine] Score below threshold, refining. Missing:", missing_fields)

    const correctionHints = missing_fields
      .map((f) => `- "${f}" was missing or null — re-read the source text and extract this value`)
      .join("\n")

    const refinementPrompt = `${built_system_prompt}

CORRECTION REQUIRED:
The previous extraction was incomplete. Re-read the input and ensure you extract:
${correctionHints}

Previous attempt (for reference only):
${JSON.stringify(extraction, null, 2)}`

    const refined = await callModel(input, refinementPrompt, model).catch((err) => {
      console.warn("[extractionEval:refine] Refinement failed, keeping original:", err.message)
      return {}
    })

    console.log("[extractionEval:refine] Refined:", refined)

    // Merge: prefer refined non-null values, keep originals for everything else
    const merged = { ...extraction }
    for (const [k, v] of Object.entries(refined)) {
      if (v !== null && v !== undefined && v !== "") merged[k] = v
    }

    const required = requiredFields(schema_fields)
    const finalMissing = computeMissing(merged, required)
    const finalScore = required.length === 0
      ? 1
      : (required.length - finalMissing.length) / required.length

    return {
      extraction: merged,
      score: finalScore,
      quality: qualityLabel(finalScore),
      missing_fields: finalMissing,
      was_refined: true,
    }
  },
})

// ─── Workflow ─────────────────────────────────────────────────────────────────

export const extractionEvalWorkflow = createWorkflow({
  id: "extraction-eval",
  inputSchema: triggerSchema,
  outputSchema: evalResultSchema,
})
  .then(extractStep)
  .then(evalStep)
  .then(refineStep)
  .commit()

export default extractionEvalWorkflow
