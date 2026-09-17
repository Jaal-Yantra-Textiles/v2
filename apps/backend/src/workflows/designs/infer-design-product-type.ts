import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { DESIGN_MODULE } from "../../modules/designs"
import DesignService from "../../modules/designs/service"
import {
  mayInferOver,
  normalizeProductType,
  parseInferredProductType,
} from "../../modules/designs/lib/product-type"
import { makeRoleAiGenerate } from "../../mastra/services/ai-platforms"
import {
  asChoice,
  asNoul,
  askSystemOne,
  choice,
  noul,
  typeSafeConfigured,
} from "../../lib/ai/typesafe"
import {
  buildGarmentState,
  GARMENT_PRESENCE_INSTRUCTIONS,
  GARMENT_TYPE_CRITERIA,
  GARMENT_TYPE_INSTRUCTIONS,
  isGarmentType,
  MIN_GARMENT_PRESENCE,
  NO_GARMENT_MATCH,
} from "../../modules/designs/lib/garment-types"

/**
 * Infer and store a design's garment type (#938).
 *
 * The type is the key that makes a production spec derivable, so it has to
 * exist before a draft product can be built from a design (#939). Most designs
 * will never have one typed by hand, hence this.
 *
 * ## Two rules this workflow exists to enforce
 *
 * 1. 🔴 **A human's type is never overwritten by a model.** `mayInferOver`
 *    refuses when `product_type_source` is `manual`, unless a person explicitly
 *    asks to re-infer. Without this a designer corrects "trousers" to "palazzo"
 *    and finds it back the next time anything touches the design — with the
 *    production spec, and therefore the cost, having moved underneath them.
 *
 * 2. 🔴 **Inference must never fail the thing that triggered it.** A design that
 *    cannot be created because a model was unreachable is a far worse outcome
 *    than a design with no type yet. Every failure path here returns a
 *    `skipped` result; none of them throws.
 */

/** Below this the model is guessing, and a wrong type moves a real cost. */
export const MIN_PRODUCT_TYPE_CONFIDENCE = 0.6

export type InferDesignProductTypeInput = {
  design_id: string
  /**
   * Re-infer even over a manually typed value. Set only from an explicit
   * "re-infer" action — that is a person choosing, not a model overruling one.
   */
  force?: boolean
}

export type InferDesignProductTypeOutput = {
  design_id: string
  product_type: string | null
  /** True when nothing was written. `skip_reason` always says why. */
  skipped: boolean
  skip_reason: string | null
  confidence: number | null
}

/** Mirrors the model's own enum so the restore below typechecks against it. */
type ProductTypeSource = "manual" | "inferred"

type Compensation = {
  design_id: string
  previous_type: string | null
  previous_source: ProductTypeSource | null
} | null

export const inferDesignProductTypeStep = createStep<
  InferDesignProductTypeInput,
  InferDesignProductTypeOutput,
  Compensation
>(
  "infer-design-product-type-step",
  async (input, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as any
    const designService: DesignService = container.resolve(DESIGN_MODULE)

    const skip = (
      reason: string,
      productType: string | null = null
    ): StepResponse<InferDesignProductTypeOutput, Compensation> =>
      new StepResponse(
        {
          design_id: input.design_id,
          product_type: productType,
          skipped: true,
          skip_reason: reason,
          confidence: null,
        },
        null
      )

    let design: any
    try {
      design = await designService.retrieveDesign(input.design_id)
    } catch {
      return skip("design_not_found")
    }
    if (!design) return skip("design_not_found")

    // A human's word outranks the model's, unless a human is the one asking.
    if (!mayInferOver(design.product_type_source, input.force)) {
      return skip("manually_set", design.product_type ?? null)
    }

    // Already inferred and unchanged — re-asking spends a model call to learn
    // the same thing. An explicit `force` still goes through.
    if (design.product_type && !input.force) {
      return skip("already_set", design.product_type)
    }

    let inferred: InferenceResult | null = null
    try {
      inferred = await runInference(design, container)
    } catch (err) {
      // 🔑 Never rethrow: this runs inside design creation, and a model outage
      // must not be able to stop a designer saving their work.
      logger?.warn?.(
        `[design-product-type] inference failed for ${input.design_id}: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
      return skip("inference_failed")
    }

    /**
     * 🔑 "This text names no garment" is an ANSWER, not a failure.
     *
     * The free-text path could never say it — a model asked to name a garment
     * always names one, so the only defence was to discard a low confidence
     * afterwards and report `unusable_result`, which reads as "the model
     * returned junk". A judgment offers `none_of_these` as an option it can
     * pick confidently, so a design describing fabric or a collection now says
     * so in the skip reason instead of looking like a parse failure.
     */
    if (inferred?.no_garment_named) {
      logger?.info?.(
        `[design-product-type] ${input.design_id}: the text names no garment ` +
          `(source: ${inferred.source ?? "unknown"})`
      )
      return skip("no_garment_named")
    }

    const confidence = Number(inferred?.confidence)
    const productType = normalizeProductType(inferred?.product_type)

    if (!productType) return skip("unusable_result")
    if (!Number.isFinite(confidence) || confidence < MIN_PRODUCT_TYPE_CONFIDENCE) {
      // A model asked to name a garment always names one. Storing a low-
      // confidence guess is how "handwoven pashmina" becomes a costed type.
      logger?.info?.(
        `[design-product-type] discarded "${productType}" for ${input.design_id} — confidence ${confidence} below ${MIN_PRODUCT_TYPE_CONFIDENCE}`
      )
      return skip("low_confidence")
    }

    const previousType = (design.product_type ?? null) as string | null
    const previousSource = (design.product_type_source ??
      null) as ProductTypeSource | null

    await designService.updateDesigns({
      selector: { id: input.design_id },
      data: { product_type: productType, product_type_source: "inferred" },
    })

    return new StepResponse(
      {
        design_id: input.design_id,
        product_type: productType,
        skipped: false,
        skip_reason: null,
        confidence,
      },
      {
        design_id: input.design_id,
        previous_type: previousType,
        previous_source: previousSource,
      }
    )
  },
  async (compensation, { container }) => {
    if (!compensation) return
    const designService: DesignService = container.resolve(DESIGN_MODULE)
    await designService.updateDesigns({
      selector: { id: compensation.design_id },
      data: {
        product_type: compensation.previous_type,
        product_type_source: compensation.previous_source,
      },
    })
  }
)

/**
 * The model call.
 *
 * 🔑 Goes through `makeRoleAiGenerate`, which the AI-platforms service
 * documents as "the single entry point every text AI feature should use". That
 * means the provider and model come from the **admin-configured External
 * Platform** tagged `ai_design_product_type` (category `ai`), falling back to
 * the auto-rotating OpenRouter free pool when no platform is tagged. So an
 * operator can point this at Cloudflare Workers AI, a Vercel AI Gateway, or
 * anything OpenAI-compatible without touching code.
 *
 * It returns TEXT, never throws, and yields "" on failure — which suits this
 * caller exactly, since an inference must never fail the design that triggered
 * it. It also logs provider/model/tokens per call via `logAiUsage`.
 *
 * 🔴 The text is then read by `parseInferredProductType` rather than trusted as
 * JSON. Free models routinely ignore a schema: `stealth/ox-alpha` returned a
 * correct answer as markdown prose with `response.object` undefined, which threw
 * on every call until the parser existed. A model's advertised `response_format`
 * support is a claim, not a guarantee — that same model advertises it.
 *
 * The `NODE_ENV === "test"` short-circuit follows `create-design-from-llm` and
 * `gen-ai-desc`: integration tests exercise the wiring, the normalisation and
 * the precedence rules — which is where the bugs live — without a network call
 * whose answer would differ run to run.
 */
async function runInference(design: any, container: any): Promise<InferenceResult> {
  if (process.env.NODE_ENV === "test") {
    return { product_type: mockTypeFor(design), confidence: 0.9, source: "mock" }
  }

  /**
   * 🔑 The judgment first, the generator only if it cannot answer.
   *
   * See `classifyWithSystemOne`. When TypeSafe is unconfigured or unreachable
   * this returns null and the original path runs unchanged — so this is
   * additive, and removing the env var reverts the behaviour completely.
   */
  const judged = await classifyWithSystemOne(design, container)
  if (judged) return judged

  const generate = makeRoleAiGenerate(
    container,
    "ai_design_product_type",
    "designs/product_type",
    { maxOutputTokens: 300 }
  )

  const text = await generate(buildPrompt(design))
  if (!text) throw new Error("model returned no text")

  const parsed = parseInferredProductType({ text })
  if (!parsed) {
    throw new Error(
      `could not read a garment type from the response: ${text.slice(0, 200)}`
    )
  }
  return { ...parsed, source: "generated" }
}

/** What either inference path hands back to the step. */
type InferenceResult = {
  product_type?: string | null
  confidence?: number | null
  /** The classifier answered that the text names no garment at all. */
  no_garment_named?: boolean
  /** Which path answered — the only way to evaluate one against the other. */
  source?: "judgment" | "generated" | "mock"
}

/**
 * Classify with TypeSafe System One — a typed choice instead of prose.
 *
 * ## What this replaces
 *
 * The generative path below asks for `{product_type, confidence, reasoning}` as
 * JSON and then needs `parseInferredProductType` to get it back: three routes,
 * ending in a regex for `**product_type:** trousers`. That parser exists because
 * `stealth/ox-alpha` returned a correct answer as markdown prose with
 * `response.object` undefined — while advertising `response_format` support.
 *
 * 🔴 The parsing was never the worst part. The gate was the model's OWN
 * `confidence` field, which it was simply asked to be honest about. A
 * self-reported number from a generative model is not calibrated, and
 * `MIN_PRODUCT_TYPE_CONFIDENCE` was a threshold on it. A Choice returns the
 * probability distribution across the options it actually considered, so the
 * same threshold now means something measurable.
 *
 * And the model can no longer answer "pashmina": it is not an option.
 *
 * Returns null — never throws — when System One is unconfigured, unreachable,
 * or answers with something outside the option list. The caller then runs the
 * original path, so this is strictly additive.
 */
async function classifyWithSystemOne(
  design: any,
  container: any
): Promise<InferenceResult | null> {
  if (!typeSafeConfigured()) return null

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as any

  /**
   * 🔑 Both questions in ONE request. They are independent and run in parallel
   * against the same state, so the gate costs a few tokens rather than a second
   * round trip — the speculative fan-out the docs describe. Code decides which
   * answer to consume.
   */
  const result = await askSystemOne(
    {
      state: buildGarmentState(design),
      questions: {
        is_garment: noul(GARMENT_PRESENCE_INSTRUCTIONS),
        garment: choice(GARMENT_TYPE_INSTRUCTIONS, GARMENT_TYPE_CRITERIA),
      },
    },
    { logger }
  )

  const answer = asChoice(result?.answers?.garment)
  if (!answer) return null

  /**
   * 🔴 The gate runs FIRST, and a confident garment answer does not survive it.
   *
   * Measured on 60 real prod raw-material rows: the Choice alone named a
   * garment for "Pant Cotton Material" at confidence 1.00. A confidence
   * threshold cannot catch that — the question's premise was already false. See
   * `GARMENT_PRESENCE_INSTRUCTIONS`.
   *
   * ⚠️ A MISSING gate answer does not block. An absent judgment is not a "no":
   * treating it as one would silently stop typing every design the moment the
   * question id changed or the model dropped one.
   */
  const gate = asNoul(result?.answers?.is_garment)
  if (gate && gate.noul < MIN_GARMENT_PRESENCE) {
    logger?.info?.(
      `[design-product-type] ${design?.id}: reads as a material, not a garment ` +
        `(is_garment ${gate.noul.toFixed(2)} < ${MIN_GARMENT_PRESENCE}); ` +
        `discarding "${answer.choice}" @ ${answer.confidence.toFixed(2)}`
    )
    return { no_garment_named: true, source: "judgment" }
  }

  if (answer.choice === NO_GARMENT_MATCH) {
    return { no_garment_named: true, source: "judgment" }
  }

  /**
   * ⚠️ An option we did not offer is a contract break, not an answer. Falling
   * through to the generator is the honest response: storing it would put an
   * unvetted string in the field this whole list exists to constrain.
   */
  if (!isGarmentType(answer.choice)) {
    logger?.warn?.(
      `[design-product-type] System One answered "${answer.choice}", which is ` +
        `not an offered option — falling back to generation.`
    )
    return null
  }

  logger?.info?.(
    `[design-product-type] ${design?.id}: "${answer.choice}" ` +
      `confidence ${answer.confidence.toFixed(2)} (judgment)`
  )

  return {
    product_type: answer.choice,
    confidence: answer.confidence,
    source: "judgment",
  }
}

/** PURE. The classification prompt. */
export function buildPrompt(design: {
  name?: string
  description?: string | null
  tags?: unknown
  designer_notes?: unknown
}): string {
  const tags = Array.isArray(design?.tags) ? design.tags.map(String) : []
  const notes =
    typeof design?.designer_notes === "string" ? design.designer_notes : ""

  return `Classify this textile design into a single garment type.

Design name: ${design?.name ?? ""}
${design?.description ? `Description: ${design.description}` : ""}
${tags.length ? `Tags: ${tags.join(", ")}` : ""}
${notes ? `Designer notes: ${notes}` : ""}

Reply with ONLY a JSON object and nothing else — no prose, no markdown, no code fences:

{"product_type": "...", "confidence": 0.0, "reasoning": "..."}

Fields:
1. product_type — ONE garment category as a single lowercase noun, using
   underscores for multi-word types. Examples: trousers, shirt, saree, kurta,
   palazzo, dupatta, blouse, jacket, scarf, stole, cushion_cover, table_runner.
   Name the garment, not the fabric, the technique, or the collection: a
   "handwoven pashmina stole" is a "stole", not "pashmina" and not "handloom".
2. confidence — 0 to 1, how certain you are. Be honest and use low values: if
   the text describes fabric or motif without saying what is made from it, you
   do not know, and a confident wrong type is worse than none.
3. reasoning — one short sentence naming the words you classified from.`
}

/**
 * Deterministic stand-in for the model under test.
 *
 * Keyword-matched off the design's own text so a test can assert a REAL
 * mapping ("Summer Trousers" → `trousers`) rather than a constant that would
 * pass whatever the normalisation did. Falls through to `unknown_garment`,
 * which lets a test cover the low-signal path too.
 */
function mockTypeFor(design: any): string {
  const haystack = [
    design?.name,
    design?.description,
    ...(Array.isArray(design?.tags) ? design.tags : []),
  ]
    .filter((v) => typeof v === "string")
    .join(" ")
    .toLowerCase()

  const known = [
    "trousers",
    "palazzo",
    "saree",
    "kurta",
    "shirt",
    "blouse",
    "jacket",
    "scarf",
    "stole",
    "dupatta",
  ]
  return known.find((k) => haystack.includes(k)) ?? "unknown_garment"
}

export const inferDesignProductTypeWorkflow = createWorkflow(
  "infer-design-product-type",
  (input: InferDesignProductTypeInput) => {
    const result = inferDesignProductTypeStep(input)
    return new WorkflowResponse(result)
  }
)

export default inferDesignProductTypeWorkflow
