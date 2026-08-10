/**
 * POST /admin/assistant/vision
 *
 * Read an attached image on demand. Attaching a photo to the assistant does not
 * send its pixels to any model — the image is stored and the assistant is merely
 * told one exists. This route is what actually looks at it, and it only runs when
 * the operator asks ("read this", "what materials are in this photo").
 *
 * That split is a cost decision AND a correctness one. The admin assistant's own
 * model is whatever the operator configured for `ai_admin_assistant`, and the
 * model configured in prod today (`@cf/zai-org/glm-5.2`) is text-only: Cloudflare
 * accepts an `image_url` part, **silently drops it, and still returns HTTP 200**.
 * A blind model answering confidently is worse than an error, so vision is
 * resolved separately through the `ai_image_extraction` role — the same resolver
 * inventory import-from-image (#769) uses — and the known text-only models are
 * refused up front rather than trusted to complain.
 *
 * Live probe (2026-08-10, prod CF account) that set these rules:
 *   @cf/zai-org/glm-5.2                    → 200, image dropped, "no image"
 *   @cf/google/gemma-4-26b-a4b-it          → correct, but 22-33s AND it emits its
 *                                            answer into `reasoning_content`,
 *                                            leaving `content` EMPTY if the token
 *                                            budget runs out first
 *   @cf/meta/llama-4-scout-17b-16e-instruct→ correct, ~5s
 *   @cf/meta/llama-3.2-11b-vision-instruct → 403, Meta licence not accepted
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { generateText } from "ai"

import {
  resolveRoleVisionModel,
  logAiUsage,
} from "../../../../mastra/services/ai-platforms"
import type { AdminAssistantVisionReq } from "./validators"
import { explainEmptyAnswer, explainFailure, isKnownTextOnly } from "./guards"

const FEATURE = "admin/assistant/vision"
const ROLE = "ai_image_extraction"

const DEFAULT_PROMPT =
  "Describe this image for a textile operations team. If it contains handwriting, " +
  "printed text, tables or numbers, transcribe them exactly, preserving line order. " +
  "Do not guess at anything you cannot actually see."

/**
 * Reasoning-style vision models spend tokens thinking before they answer, and on
 * Cloudflare's OpenAI-compatible endpoint that thinking goes to `reasoning_content`
 * while `content` stays empty until the answer is reached. Capping this low is how
 * you get a convincing "the model returned nothing".
 */
const MAX_OUTPUT_TOKENS = 4000

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const body = (req as any).validatedBody as AdminAssistantVisionReq

  const resolved = await resolveRoleVisionModel(
    req.scope as any,
    ROLE,
    body.model
  )

  // The free fallback is an OpenRouter vision model — usable, but only if a key
  // exists. Without one there is nothing to call, so say so precisely instead of
  // failing inside the provider.
  if (resolved.source === "free" && !process.env.OPENROUTER_API_KEY) {
    res.status(503).json({
      error:
        "No vision provider is configured. Add a platform with role " +
        "ai_image_extraction in Settings → External Platforms (Cloudflare Workers " +
        "AI works — e.g. @cf/google/gemma-4-26b-a4b-it), or set OPENROUTER_API_KEY.",
    })
    return
  }

  if (isKnownTextOnly(resolved.modelId)) {
    res.status(422).json({
      error:
        `The model configured for image reading (${resolved.modelId}) is text-only — ` +
        `it accepts an image and silently ignores it, so any answer would be invented. ` +
        `Point the ai_image_extraction platform at a vision model ` +
        `(e.g. @cf/google/gemma-4-26b-a4b-it for accuracy, ` +
        `@cf/meta/llama-4-scout-17b-16e-instruct for speed).`,
      model: resolved.modelId,
    })
    return
  }

  const startedAt = Date.now()
  const usageBase = {
    feature: FEATURE,
    role: ROLE,
    provider: resolved.providerType,
    source: resolved.source,
    platformId: resolved.platformId,
    model: resolved.modelId,
  } as const

  let text: string
  let finishReason: string | undefined
  try {
    const result = await generateText({
      model: resolved.model,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: body.prompt || DEFAULT_PROMPT },
            { type: "image", image: new URL(body.image_url) },
          ],
        },
      ],
    })
    text = (result.text ?? "").trim()
    finishReason = result.finishReason
    logAiUsage(logger, {
      ...usageBase,
      ok: true,
      ms: Date.now() - startedAt,
      tokens: result.usage?.totalTokens,
    })
  } catch (e: any) {
    logAiUsage(logger, {
      ...usageBase,
      ok: false,
      ms: Date.now() - startedAt,
      error: e,
    })
    const { status, error } = explainFailure(e, resolved.modelId)
    res.status(status).json({ error, model: resolved.modelId })
    return
  }

  // Empty answer from a reasoning model that spent its whole budget thinking.
  // Distinguish it from "the model had nothing to say" so nobody re-debugs this.
  if (!text) {
    res.status(502).json({
      error: explainEmptyAnswer(resolved.modelId, finishReason),
      model: resolved.modelId,
      finish_reason: finishReason,
    })
    return
  }

  res.json({
    text,
    model: resolved.modelId,
    provider: resolved.providerType,
    source: resolved.source,
    ms: Date.now() - startedAt,
  })
}
