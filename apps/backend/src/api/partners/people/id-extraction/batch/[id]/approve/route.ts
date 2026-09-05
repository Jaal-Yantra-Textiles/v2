import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { approveIdExtractionBatchWorkflow } from "../../../../../../../workflows/ai/approve-id-extraction-batch"
import { getPartnerFromAuthContext } from "../../../../../helpers"
import type { PartnerIdExtractionBatchApproveReqType } from "../../validators"

/**
 * POST /partners/people/id-extraction/batch/:id/approve
 *
 * Turns drafts into people on the partner's roster.
 *
 * 🔴 This is the ONLY door from a batch to a person. The reading workflow never
 * creates one, however confident the model sounded — in prod the same ID card
 * read five times did not split the name identically (4x "Tarun Debnath", 1x
 * "Tarun"). At ten photographs a run that would seed a roster with wrong names
 * and nothing would mark which.
 *
 * `corrections` is where the operator's fix lands, keyed by item id. A
 * correction can rescue a draft the reader itself refused for having no name.
 *
 * Partial success is normal and reported per item: approving eight of ten does
 * not roll back the eight because the ninth had no surname.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const body = (req.validatedBody ??
    req.body ??
    {}) as PartnerIdExtractionBatchApproveReqType

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner?.id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner is associated with this session."
    )
  }

  const { result } = await approveIdExtractionBatchWorkflow(req.scope).run({
    input: {
      batch_id: req.params.id,
      item_ids: body.item_ids ?? null,
      corrections: (body.corrections ?? null) as any,
      // Ownership is enforced inside the workflow, against the batch row.
      partner_id: partner.id,
    },
  })

  const out = result as any

  return res.status(out.approved > 0 ? 201 : 200).json({
    message:
      out.approved > 0
        ? `${out.approved} person(s) added to your people.${
            out.skipped ? ` ${out.skipped} skipped — see results.` : ""
          }`
        : "Nothing was approved — see results for why.",
    batch_id: out.batch_id,
    approved: out.approved,
    skipped: out.skipped,
    results: out.results,
  })
}
