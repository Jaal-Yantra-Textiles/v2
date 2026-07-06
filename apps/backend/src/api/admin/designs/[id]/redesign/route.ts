import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  resolveRedesignCredentials,
  DEFAULT_REDESIGN_MODEL,
} from "../../../../../mastra/services/redesign-credentials"
import {
  RedesignBodySchema,
  buildRedesignPrompt,
  fileToDataUrl,
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
      "No redesign provider configured. Add an OpenRouter platform with role=ai_redesign in Settings → External Platforms, or set OPENROUTER_API_KEY."
    )
  }

  const image = resolveImageInput(body)

  const { createOpenRouter } = await import("@openrouter/ai-sdk-provider")
  const { generateText } = await import("ai")
  const openrouter = createOpenRouter({ apiKey: creds.apiKey })

  logger.info(
    `[Redesign] Nano-Banana (${creds.model}, key from ${creds.source}) on design ${req.params.id}: "${body.prompt.slice(0, 60)}…"`
  )

  let result: any
  try {
    result = await generateText({
      model: openrouter(creds.model),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: fullPrompt },
            { type: "image", image },
          ],
        },
      ],
    })
  } catch (err: any) {
    logger.error(`[Redesign] Gemini call failed: ${err?.message || err}`)
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Redesign generation failed: ${err?.message || "unknown error"}`
    )
  }

  const file = (result.files || []).find((f: any) =>
    f.mediaType?.startsWith("image/")
  )
  if (!file) {
    logger.error(
      `[Redesign] No image in response (text: ${String(result.text).slice(0, 120)})`
    )
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Nano-Banana returned no image. Try a more specific prompt or a clearer input image."
    )
  }

  logger.info(`[Redesign] Success — design ${req.params.id}`)
  return res.status(200).json({
    redesign: {
      image_url: fileToDataUrl(file),
      provider: "openrouter",
      model: creds.model,
      prompt: fullPrompt,
    },
  })
}
