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

import { PARTNER_CAPABILITY_MODULE } from "../../../../../../modules/partner_capability"
import { normalizeCapabilityActions } from "../../../../../../modules/partner_capability/lib/actions"
import { sampleTechniqueSlug } from "../../../../../../modules/partner_capability/lib/techniques"
import { attachCapabilityMedia } from "../../../../../../workflows/partner/capability-media"
import { deletePartnerCapabilityWorkflow } from "../../../../../../workflows/partner/delete-partner-capability"
import { AdminUpdatePartnerCapabilityReq } from "../validators"

/**
 * @route POST /admin/partners/:id/capabilities/:sampleId
 * @scope admin
 *
 * Correct a sample in place (wrong action, typo in the technique…), keeping its
 * id so briefs and quotes that cite it as evidence still point at it.
 * Looked up through the partner, like DELETE. `technique_slug` is recomputed
 * from the merged technique + actions, never taken from the body.
 */
export const POST = async (
  req: MedusaRequest<AdminUpdatePartnerCapabilityReq>,
  res: MedusaResponse
) => {
  const { id: partnerId, sampleId } = req.params
  const service: any = req.scope.resolve(PARTNER_CAPABILITY_MODULE)
  const [current] = await service.listPartnerCapabilitySamples({ id: sampleId, partner_id: partnerId })
  if (!current) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Sample ${sampleId} not found for partner ${partnerId}`)
  }

  const body = req.validatedBody
  const patch: Record<string, unknown> = { id: sampleId }
  for (const key of ["title", "technique", "material", "product_type", "notes", "captured_at"] as const) {
    if (body[key] !== undefined) patch[key] = body[key]
  }
  if (body.actions !== undefined) {
    const actions = normalizeCapabilityActions(body.actions ?? [])
    patch.actions = actions.length ? actions : null
  }
  const technique = patch.technique !== undefined ? patch.technique : current.technique
  const actions = patch.actions !== undefined ? patch.actions : current.actions
  patch.technique_slug = sampleTechniqueSlug(technique as string | null, actions as string[] | null)

  const updated = await service.updatePartnerCapabilitySamples(patch)
  const [sample] = await attachCapabilityMedia(req.scope, [updated])
  return res.json({ sample: sample ?? updated })
}

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
