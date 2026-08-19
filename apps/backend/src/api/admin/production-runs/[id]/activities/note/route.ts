import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { PRODUCTION_RUNS_MODULE } from "../../../../../../modules/production_runs"
import type ProductionRunService from "../../../../../../modules/production_runs/service"

const NoteBodySchema = z.object({
  summary: z.string().min(1, "summary is required"),
  message_id: z.string().optional(),
  conversation_id: z.string().optional(),
  partner_id: z.string().optional(),
  payload: z.record(z.string(), z.any()).optional(),
})

/**
 * POST /admin/production-runs/:id/activities/note
 *
 * Append a free-form note activity to a run's timeline. Designed for the
 * WhatsApp messaging inbox — an admin reads a partner's message and logs it
 * against the relevant run so the activity timeline reflects what the
 * partner actually said (rather than only system-emitted lifecycle events).
 *
 * When `message_id` is supplied the activity is stamped with
 * `channel: "whatsapp"` so the timeline can distinguish messages-originated
 * notes from admin-typed ones.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest & { params: { id: string } },
  res: MedusaResponse
) => {
  const runId = req.params.id
  const service: ProductionRunService = req.scope.resolve(PRODUCTION_RUNS_MODULE)

  const run = await service.retrieveProductionRun(runId).catch(() => null)
  if (!run) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Production run ${runId} not found`
    )
  }

  const parsed = NoteBodySchema.safeParse(req.body)
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      parsed.error.issues.map((i) => i.message).join(", ")
    )
  }

  const body = parsed.data

  const activity = await service.createProductionRunActivities({
    production_run_id: runId,
    activity_type: "note",
    kind: "whatsapp_message_logged",
    actor_type: "admin",
    actor_id: (req as any).auth_context?.actor_id ?? null,
    partner_id: body.partner_id ?? (run as any).partner_id ?? null,
    channel: body.message_id ? "whatsapp" : null,
    message_id: body.message_id ?? null,
    template_name: null,
    recipient: null,
    summary: body.summary,
    payload: {
      ...body.payload,
      ...(body.message_id ? { message_id: body.message_id } : {}),
      ...(body.conversation_id ? { conversation_id: body.conversation_id } : {}),
      source: "messaging_inbox",
    },
    occurred_at: new Date(),
  } as any)

  res.status(201).json({ activity })
}
