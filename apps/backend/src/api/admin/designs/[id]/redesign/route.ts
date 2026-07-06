import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  resolveRedesignCredentials,
  DEFAULT_REDESIGN_MODEL,
} from "../../../../../mastra/services/redesign-credentials"
import { runRedesignEngine, RedesignEngineError } from "./redesign-engines"
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
    // Controlled 503 (not a thrown 500) so the actionable message reaches the UI —
    // Medusa's error handler scrubs the body of any 500-level error.
    return res.status(503).json({
      code: "no_provider",
      message:
        "No redesign provider configured. Add an OpenRouter (or Google) platform with role=ai_redesign in Settings → External Platforms, or set OPENROUTER_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY.",
    })
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
    const status = err instanceof RedesignEngineError ? err.status : 502
    const code = err instanceof RedesignEngineError ? err.kind : "provider"
    const message =
      err instanceof RedesignEngineError
        ? err.message
        : `Redesign failed unexpectedly: ${String(err?.message || err).slice(0, 160)}`
    logger.error(
      `[Redesign] ${creds.engine} failed [${code}] on design ${req.params.id}: ${err?.message || err}`
    )
    // Controlled response so the classified message survives (500s get scrubbed).
    return res.status(status).json({ code, message })
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
