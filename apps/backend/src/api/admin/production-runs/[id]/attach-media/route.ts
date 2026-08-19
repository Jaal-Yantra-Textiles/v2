import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import type ProductionRunService from "../../../../../modules/production_runs/service"

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
 *
 * This does NOT copy the file — it records the URL the messaging system
 * already persisted when the inbound WhatsApp media was received.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest & { params: { id: string } },
  res: MedusaResponse
) => {
  const runId = req.params.id
  const service: ProductionRunService = req.scope.resolve(PRODUCTION_RUNS_MODULE)

  const run = (await service.retrieveProductionRun(runId).catch(() => null)) as any
  if (!run) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Production run ${runId} not found`
    )
  }

  if (run.status === "cancelled") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Cannot attach media to a cancelled production run"
    )
  }

  const parsed = AttachMediaBodySchema.safeParse(req.body)
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      parsed.error.issues.map((i) => i.message).join(", ")
    )
  }

  const body = parsed.data

  const existingMeta = (run.metadata as Record<string, any>) || {}
  const existingMedia: any[] = Array.isArray(existingMeta.attached_media)
    ? existingMeta.attached_media
    : []

  const attachment = {
    url: body.media_url,
    mime_type: body.media_mime_type ?? null,
    filename: body.filename ?? null,
    message_id: body.message_id ?? null,
    conversation_id: body.conversation_id ?? null,
    attached_by: "admin",
    attached_at: new Date().toISOString(),
  }

  await service.updateProductionRuns({
    id: runId,
    metadata: {
      ...existingMeta,
      attached_media: [...existingMedia, attachment],
    },
  })

  // Audit
  try {
    await service.createProductionRunActivities({
      production_run_id: runId,
      activity_type: "note",
      kind: "media_attached",
      actor_type: "admin",
      actor_id: (req as any).auth_context?.actor_id ?? null,
      partner_id: run.partner_id ?? null,
      channel: body.message_id ? "whatsapp" : null,
      message_id: body.message_id ?? null,
      template_name: null,
      recipient: null,
      summary: `Media attached: ${body.filename || body.media_url.split("/").pop() || "file"}`,
      payload: {
        media_url: body.media_url,
        media_mime_type: body.media_mime_type ?? null,
        filename: body.filename ?? null,
        from_message_id: body.message_id ?? null,
        from_conversation_id: body.conversation_id ?? null,
        source: "messaging_inbox",
      },
      occurred_at: new Date(),
    } as any)
  } catch {
    // Best-effort
  }

  const updated = await service.retrieveProductionRun(runId)

  res.status(200).json({
    production_run: updated,
    message: "Media attached to run",
  })
}
