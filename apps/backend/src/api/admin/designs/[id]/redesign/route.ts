import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  resolveRedesignCredentials,
  DEFAULT_REDESIGN_MODEL,
} from "../../../../../mastra/services/redesign-credentials"
import { runRedesignEngine } from "./redesign-engines"
import {
  RedesignBodySchema,
  buildRedesignPrompt,
  resolveImageInput,
  MOCK_REDESIGN_IMAGE,
} from "./redesign-support"

/**
 * POST /admin/designs/:id/redesign
 *
 * Structure-preserving AI restyle (#892). Takes an input flat/photo + a design
 * direction and returns exploratory render(s) from Nano-Banana (Gemini 2.5 Flash
 * Image) — the bake-off winner. This is EXPLORATION output; the deterministic vector
 * tech-pack remains the sewable spec. Returns URLs only (the caller decides whether to
 * drop a render into the moodboard); it does not mutate the design.
 *
 * Body: { image_url | image_base64, prompt }
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const parsed = RedesignBodySchema.safeParse(req.body)
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    )
  }
  const body = parsed.data
  const fullPrompt = buildRedesignPrompt(body.prompt)

  // In integration tests, skip the paid AI call but exercise all wiring around it.
  if (process.env.TEST_TYPE) {
    return res.status(200).json({
      redesign: {
        image_url: MOCK_REDESIGN_IMAGE,
        provider: "test-mock",
        model: DEFAULT_REDESIGN_MODEL,
        prompt: fullPrompt,
      },
    })
  }

  const creds = await resolveRedesignCredentials(req.scope)
  if (!creds) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "No redesign provider configured. Add an OpenRouter (or Google) platform with role=ai_redesign in Settings → External Platforms, or set OPENROUTER_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY."
    )
  }

  const image = resolveImageInput(body)

  logger.info(
    `[Redesign] ${creds.engine} (${creds.model}, key from ${creds.source}) on design ${req.params.id}: "${body.prompt.slice(0, 60)}…"`
  )

  let imageDataUrl: string
  try {
    imageDataUrl = await runRedesignEngine(creds.engine, {
      apiKey: creds.apiKey,
      model: creds.model,
      prompt: fullPrompt,
      image,
    })
  } catch (err: any) {
    logger.error(`[Redesign] ${creds.engine} call failed: ${err?.message || err}`)
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Redesign generation failed: ${err?.message || "unknown error"}`
    )
  }

  logger.info(`[Redesign] Success — design ${req.params.id} via ${creds.engine}`)
  return res.status(200).json({
    redesign: {
      image_url: imageDataUrl,
      provider: creds.engine,
      model: creds.model,
      prompt: fullPrompt,
    },
  })
}
