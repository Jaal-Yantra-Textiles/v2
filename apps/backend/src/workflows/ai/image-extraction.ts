import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { MedusaError } from "@medusajs/framework/utils";
import { describeFetchError } from "../../utils/describe-fetch-error";
import { mastra } from "../../mastra";

/**
 * Pull the most actionable message out of a failed Mastra step error so the
 * route returns the REAL reason instead of a generic "workflow failed" (#769).
 *
 * The vision call surfaces AI SDK `APICallError`s whose `responseBody` carries
 * the provider's real error (e.g. Cloudflare "cannot identify image file",
 * "Authentication error", quota), nested 1-2 levels deep in JSON. Network
 * failures arrive as undici "fetch failed" with the detail on `.cause` —
 * handled by `describeFetchError`. Pure + exported for unit testing.
 */
export function summarizeAiStepError(err: unknown): string {
  const e = err as any
  const status = e?.statusCode ?? e?.status
  const rawBody = typeof e?.responseBody === "string" ? e.responseBody : undefined

  let providerMsg: string | undefined
  if (rawBody) {
    try {
      const parsed = JSON.parse(rawBody)
      providerMsg =
        parsed?.errors?.[0]?.message ??
        parsed?.error?.message ??
        parsed?.message
    } catch {
      /* responseBody wasn't JSON */
    }
    // Providers (e.g. Cloudflare) double-nest the real reason as an AiError
    // string: `AiError: {"error":{"message":"..."}}`. Dig the innermost message.
    if (typeof providerMsg === "string") {
      const nested = providerMsg.match(/"message"\s*:\s*"([^"]+)"/)
      if (nested) providerMsg = nested[1]
    }
    if (!providerMsg) providerMsg = rawBody.slice(0, 300)
  }

  const base = providerMsg ?? describeFetchError(err)
  const prefix = status ? `HTTP ${status}: ` : ""
  return `${prefix}${base}`.slice(0, 500)
}
import {
  resolveRoleVisionModel,
  logAiUsage,
} from "../../mastra/services/ai-platforms";
import {
  createImageExtractionAgent,
  setExtractionAgentForRun,
  takeExtractionAgentForRun,
} from "../../mastra/agents";

// Input mirrors AdminImageExtractionReqType to keep coupling minimal
export type ImageExtractionInput = {
  image_url: string
  entity_type?: "raw_material" | "inventory_item"
  notes?: string
  threadId?: string
  resourceId?: string
  hints?: {
    allowed_units?: string[]
    default_unit?: string
    known_items?: string[]
    additional_context?: string
  }
  verify?: {
    min_items?: number
    required_fields?: ("name" | "quantity" | "unit")[]
    expected_items?: Array<{ name?: string; min_quantity?: number; unit?: string }>
  }
  // Optional defaults/hints for downstream create workflow or future extraction behavior
  defaults?: Record<string, any>
}

export type ImageExtractionOutput = {
  entity_type: string
  items: Array<{
    name: string
    quantity: number
    unit?: string
    sku?: string
    confidence?: number
    metadata?: Record<string, any>
  }>
  summary?: string
  verification?: {
    passed: boolean
    issues: string[]
  }
}

const buildEnhancedNotes = createStep(
  "build-enhanced-notes",
  async (input: ImageExtractionInput) => {
    const notesParts: string[] = []
    if (input.notes) notesParts.push(`Notes: ${input.notes}`)
    if (input.hints?.additional_context)
      notesParts.push(`Context: ${input.hints.additional_context}`)
    if (input.hints?.known_items?.length)
      notesParts.push(`Known items: ${input.hints.known_items.join(", ")}`)
    if (input.hints?.allowed_units?.length)
      notesParts.push(`Allowed units: ${input.hints.allowed_units.join(", ")}`)
    if (input.hints?.default_unit)
      notesParts.push(`Default unit: ${input.hints.default_unit}`)

    const enhanced = {
      ...input,
      notes: notesParts.join("\n"),
      entity_type: input.entity_type || "raw_material",
    }
    return new StepResponse(enhanced)
  }
)

// Derive a stable resourceId when not provided.
// Strategy: use a single constant to group all inventory extractions.
const deriveResourceId = createStep(
  "derive-stable-resource-id",
  async (input: ImageExtractionInput) => {
    if (input.resourceId) return new StepResponse(input)
    const resourceId = "image-extraction:inventory-extraction"
    return new StepResponse({ ...input, resourceId })
  }
)


const runMastraExtraction = createStep(
  "run-mastra-extraction",
  async (input: ImageExtractionInput, { container }) => {
    // Resolve the vision provider via the role-based AI platform registry
    // (#769) — admin-configured "External Platform" for ai_image_extraction,
    // else the auto-rotating OpenRouter free vision model. The Mastra workflow
    // has no container, so we build the agent here and hand it off by runId.
    let logger: any
    try { logger = container.resolve("logger") } catch { /* optional */ }

    const run = await mastra.getWorkflow("imageExtractionWorkflow").createRun()
    let providerType: any = "openrouter"
    let source: any = "free"
    let modelId: string | undefined
    let platformId: string | undefined
    const started = Date.now()
    try {
      const resolved = await resolveRoleVisionModel(container, "ai_image_extraction")
      providerType = resolved.providerType
      source = resolved.source
      modelId = resolved.modelId
      platformId = resolved.platformId
      const agent = await createImageExtractionAgent(resolved.model)
      setExtractionAgentForRun(run.runId, agent)
    } catch (e: any) {
      // Provider resolution itself failed — let the Mastra step fall back to
      // its own free-vision factory rather than blocking extraction.
      console.warn(
        `[image-extraction] vision provider resolution failed, using free fallback: ${e?.message ?? e}`
      )
    }

    let workflowResult: any
    try {
      workflowResult = await run.start({ inputData: {
        image_url: input.image_url,
        entity_type: input.entity_type || "raw_material",
        notes: input.notes,
        threadId: input.threadId,
        resourceId: input.resourceId,
        run_id: run.runId,
      } })
    } finally {
      // If the Mastra step never consumed the agent (early failure), drop it.
      takeExtractionAgentForRun(run.runId)
    }

    const extractOk =
      workflowResult.steps.validateExtraction?.status === "success" ||
      workflowResult.steps.extractItems?.status === "success"
    logAiUsage(logger, {
      feature: "inventory/image-extraction",
      role: "ai_image_extraction",
      provider: providerType,
      source,
      model: modelId,
      platformId,
      ok: extractOk,
      ms: Date.now() - started,
    })

    // Validate steps
    if (workflowResult.steps.validateExtraction?.status === "failed") {
      const error = workflowResult.steps.validateExtraction.error
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Image extraction validation failed: ${error}`)
    }

    if (workflowResult.steps.validateExtraction?.status === "success") {
      const out = workflowResult.steps.validateExtraction.output as any
      return new StepResponse({
        entity_type: out.entity_type,
        items: out.items || [],
        summary: out.summary,
      })
    }

    // Fallback: attempt to read from extractItems if validate step missing
    if (workflowResult.steps.extractItems?.status === "success") {
      const out = workflowResult.steps.extractItems.output as any
      return new StepResponse({
        entity_type: out.entity_type,
        items: out.items || [],
        summary: out.summary,
      })
    }

    // Surface the REAL failure instead of a generic message (#769). The vision
    // call lives in extractItems; its error carries the provider's actual reason
    // (e.g. "cannot identify image file", auth/quota, network), which is what an
    // operator needs to fix their AI-platform config or the source image.
    const extractErr = (workflowResult.steps.extractItems as any)?.error
    if (workflowResult.steps.extractItems?.status === "failed" && extractErr) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Image extraction failed: ${summarizeAiStepError(extractErr)}`
      )
    }

    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Image extraction produced no result (no items and no step error)"
    )
  }
)

const verifyExtraction = createStep(
  "verify-extraction",
  async (
    input: { data: ImageExtractionOutput; rules?: ImageExtractionInput["verify"] }
  ) => {
    const issues: string[] = []
    const { data, rules } = input

    if (!rules) {
      return new StepResponse({ ...data, verification: { passed: true, issues } })
    }

    // min items
    if (typeof rules.min_items === "number" && data.items.length < rules.min_items) {
      issues.push(`Expected at least ${rules.min_items} items, got ${data.items.length}`)
    }

    // required fields present for all items
    if (rules.required_fields?.length) {
      for (const it of data.items) {
        for (const f of rules.required_fields) {
          if (f === "name" && !it.name) issues.push("Missing name on at least one item")
          if (f === "quantity" && (it.quantity === undefined || it.quantity === null))
            issues.push("Missing quantity on at least one item")
          if (f === "unit" && !it.unit) issues.push("Missing unit on at least one item")
        }
      }
    }

    // expected items
    if (rules.expected_items?.length) {
      for (const exp of rules.expected_items) {
        const found = data.items.find((it) => {
          const nameOk = exp.name ? it.name?.toLowerCase().includes(exp.name.toLowerCase()) : true
          const qtyOk = typeof exp.min_quantity === "number" ? (it.quantity ?? 0) >= exp.min_quantity : true
          const unitOk = exp.unit ? (it.unit ?? "").toLowerCase() === exp.unit.toLowerCase() : true
          return nameOk && qtyOk && unitOk
        })
        if (!found) {
          issues.push(
            `Expected item not satisfied: ${exp.name ?? "<any>"} min_qty=${exp.min_quantity ?? "-"} unit=${exp.unit ?? "-"}`
          )
        }
      }
    }

    const passed = issues.length === 0
    return new StepResponse({ ...data, verification: { passed, issues } })
  }
)

export const imageExtractionMedusaWorkflow = createWorkflow(
  "image-extraction-medusa",
  (input: ImageExtractionInput) => {
    const withId = deriveResourceId(input)
    const enhanced = buildEnhancedNotes(withId)
    const extracted = runMastraExtraction(enhanced)
    const verified = verifyExtraction({ data: extracted, rules: input.verify })

    return new WorkflowResponse(verified)
  }
)
