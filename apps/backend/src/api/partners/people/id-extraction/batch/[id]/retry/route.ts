import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { idExtractionBatchProcessingWorkflow } from "../../../../../../../workflows/ai/id-extraction-batch"
import { getPartnerFromAuthContext } from "../../../../../helpers"
import { PERSON_MODULE } from "../../../../../../../modules/person"

/**
 * POST /partners/people/id-extraction/batch/:id/retry
 *
 * Re-runs what is still outstanding — failed reads by default, or everything
 * unread with `?scope=pending`.
 *
 * 🔑 This is a RESUME, not a re-do. The processing step asks the database which
 * items are still outstanding rather than replaying a list, so a batch that a
 * deploy killed halfway (#1742 — the loop dies, `status` keeps saying
 * `running`) finishes from where it stopped and already-read photographs are
 * never paid for twice.
 *
 * ⚠️ A human pressing this is never refused on `resume_attempts`. That counter
 * exists to stop the SWEEPER looping forever on a batch that fails for a reason
 * which will not change; an operator looking at the errors is making a call.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner?.id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner is associated with this session."
    )
  }

  const service: any = req.scope.resolve(PERSON_MODULE)
  const batch = await service
    .retrieveIdExtractionBatch(req.params.id)
    .catch(() => null)

  if (!batch || batch.partner_id !== partner.id) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `No such batch: ${req.params.id}`
    )
  }

  const scope = req.query.scope === "pending" ? "pending" : "failed"

  const items = await service.listIdExtractionBatchItems({ batch_id: batch.id })
  const outstanding = items.filter((i: any) =>
    scope === "failed"
      ? i.status === "failed"
      : i.status === "pending" || i.status === "failed"
  )

  /**
   * ⚠️ Two different nothings, and they must not read the same. An empty
   * outstanding set is a retry that has already succeeded — reporting it as
   * invalid data would make a sweeper log an error every time it met a batch
   * somebody had finished by hand.
   */
  if (outstanding.length === 0) {
    return res.status(200).json({
      success: true,
      nothing_to_do: true,
      message:
        scope === "failed"
          ? "Nothing failed in this batch."
          : "Every photograph in this batch has been read.",
      batch_id: batch.id,
    })
  }

  await service.updateIdExtractionBatches({
    selector: { id: batch.id },
    data: {
      status: "running",
      finished_at: null,
      resume_attempts: (batch.resume_attempts ?? 0) + 1,
    },
  })

  /**
   * Fire the processing workflow without awaiting it: the run is paced at one
   * photograph per interval and would blow through the edge limit if this
   * request waited for it. Failures land on the items and on the batch, which
   * is where the caller reads them anyway.
   */
  void idExtractionBatchProcessingWorkflow(req.scope)
    .run({ input: { batch_id: batch.id, scope } })
    .catch(() => {
      /* recorded per item; the batch's own status carries the outcome */
    })

  return res.status(202).json({
    success: true,
    message: `Re-reading ${outstanding.length} photograph(s) in the background.`,
    batch_id: batch.id,
    scope,
    outstanding: outstanding.length,
  })
}
