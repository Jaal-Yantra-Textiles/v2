import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { getPartnerFromAuthContext } from "../../../../helpers"
import { PERSON_MODULE } from "../../../../../../modules/person"

/**
 * GET /partners/people/id-extraction/batch/:id
 *
 * The batch and every photograph in it — the per-item report #1816 asked for.
 * This is what a client polls while the background run works through the
 * photos, and what an operator reads before approving.
 */
export const GET = async (
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

  /**
   * 🔴 A batch belonging to another partner is reported as NOT FOUND, not as
   * forbidden. "Forbidden" confirms the id exists, which is a partner
   * enumeration oracle across tenants.
   */
  if (!batch || batch.partner_id !== partner.id) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `No such batch: ${req.params.id}`
    )
  }

  const items = await service.listIdExtractionBatchItems(
    { batch_id: batch.id },
    { order: { position: "ASC" } }
  )

  const by = (s: string) => items.filter((i: any) => i.status === s).length
  const completed = by("completed")
  const failed = by("failed")
  const approved = by("approved")
  const pending = by("pending")

  return res.json({
    batch: {
      ...batch,
      total: items.length,
      completed,
      failed,
      approved,
      pending,
      /**
       * The batch row's own `status` says what the WORKFLOW is doing. This says
       * whether there is anything left to do, which is the question a resume
       * asks — and the two disagree exactly when a deploy has killed the loop
       * while `status` still reads `running` (#1742).
       */
      outstanding: pending + failed,
    },
    items: items.map((i: any) => ({
      id: i.id,
      position: i.position,
      image_url: i.image_url,
      status: i.status,
      draft: i.draft,
      person_id: i.person_id,
      model_used: i.model_used,
      error: i.error,
      attempts: i.attempts,
      attempted_at: i.attempted_at,
    })),
  })
}
