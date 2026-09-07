/**
 * @route DELETE /admin/partners/:id/capabilities/:sampleId
 * @scope admin
 *
 * Remove a wrong or obsolete entry from a partner's capability library.
 *
 * 🔴 The workflow looks the sample up THROUGH the partner: filtered by both
 * id and partner_id, so a sample id that belongs to another partner 404s
 * rather than deleting their evidence. The uploaded photographs are NOT
 * deleted — other samples may reference them, and the media module owns their
 * lifecycle.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { deletePartnerCapabilityWorkflow } from "../../../../../../workflows/partner/delete-partner-capability"

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: partnerId, sampleId } = req.params

  const { result, errors } = await deletePartnerCapabilityWorkflow(
    req.scope
  ).run({
    input: {
      partner_id: partnerId,
      sample_id: sampleId,
    },
  })

  if (errors?.length) {
    throw (
      errors[0].error ||
      new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Failed to delete capability sample"
      )
    )
  }

  return res.json({
    id: result.id,
    partner_id: partnerId,
    object: "partner_capability_sample",
    deleted: true,
  })
}
