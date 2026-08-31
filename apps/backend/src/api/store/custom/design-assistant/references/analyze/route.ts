/**
 * Storefront design-assistant — analyse an uploaded reference on the fly.
 *
 *   POST /store/custom/design-assistant/references/analyze
 *
 * The maker uploads a reference image (presign → S3 PUT). The client calls
 * this the moment the upload finishes so the image is READ and described
 * immediately — not deferred to whenever the model happens to call
 * save_moodboard / generate_design_image. The vision result is:
 *
 *   1. returned to the client (shown on the thumbnail + sent with the message
 *      so the model grounds on it), and
 *   2. persisted on the MediaFile record (`metadata.vision_analysis`) so every
 *      later turn / tool call reuses it without another vision call.
 *
 * Public (no customer auth) — analysis is a read of a URL the client already
 * owns. Best-effort: a failed vision call still returns 200 with an empty
 * analysis rather than blocking the maker.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { analyzeReferenceImage } from "../../../../../../mastra/agents/tools/storefront-design-analysis"

const AnalyzeReferenceSchema = z.object({
  url: z.string().url().max(2000).describe("Public URL of the uploaded image."),
  name: z.string().trim().min(1).max(200).optional(),
  mime_type: z.string().trim().max(80).optional(),
})

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req as any).validatedBody ?? (req.body as any)
  const parsed = AnalyzeReferenceSchema.safeParse(body ?? {})

  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues?.[0]?.message ?? "Invalid body" })
  }

  const analysis = await analyzeReferenceImage(req.scope as any, parsed.data.url)

  return res.status(200).json({
    url: parsed.data.url,
    analysis,
  })
}