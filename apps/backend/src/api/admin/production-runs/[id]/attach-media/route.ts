import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { attachMediaToProductionRunWorkflow } from "../../../../../workflows/production-runs/attach-media-to-production-run"

const AttachMediaBodySchema = z.object({
  media_url: z.string().url("media_url must be a valid URL"),
  media_mime_type: z.string().optional(),
  filename: z.string().optional(),
  message_id: z.string().optional(),
  conversation_id: z.string().optional(),
})

/**
 * POST /admin/production-runs/:id/attach-media
 *
 * Attach a media file (image / video / document) from a WhatsApp message to
 * a production run. The media URL and metadata are appended to
 * `run.metadata.attached_media` so they survive alongside the run, and an
 * activity note is written to the timeline so the attachment is auditable.
 * When the run links a design (`run.design_id`), the same URL is also
 * appended to the design's `media_files` gallery.
 *
 * All of that is done inside `attachMediaToProductionRunWorkflow` — this
 * route only validates the body and fans out the single workflow run.
 *
 * This does NOT copy the file — it records the URL the messaging system
 * already persisted when the inbound WhatsApp media was received.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest & { params: { id: string } },
  res: MedusaResponse
) => {
  const runId = req.params.id

  const parsed = AttachMediaBodySchema.safeParse(req.body)
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      parsed.error.issues.map((i) => i.message).join(", ")
    )
  }

  const body = parsed.data

  const { result, errors } = await attachMediaToProductionRunWorkflow(
    req.scope
  ).run({
    input: {
      production_run_id: runId,
      media_url: body.media_url,
      media_mime_type: body.media_mime_type ?? null,
      filename: body.filename ?? null,
      message_id: body.message_id ?? null,
      conversation_id: body.conversation_id ?? null,
      actor_id: (req as any).auth_context?.actor_id ?? null,
    },
    throwOnError: false,
  })

  if (errors?.length) {
    throw (
      errors[0].error ||
      new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Failed to attach media to run"
      )
    )
  }

  res.status(200).json({
    production_run: result.production_run,
    design: result.design,
    message: "Media attached to run",
  })
}