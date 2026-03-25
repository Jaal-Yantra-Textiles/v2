
/**
 * HTTP POST handler to link a design to one or more partners.
 *
 * Extracts the design id from req.params.id and the partner ids from
 * req.validatedBody.partnerIds, then runs the linkDesignPartnerWorkflow
 * within the request scope. On successful linking the workflow result
 * is returned with a 201 status. If the workflow reports any errors,
 * those errors are logged and rethrown.
 *
 * @param req - MedusaRequest<LinkDesignPartner>:
 *   - req.params.id: string — the design id to link
 *   - req.validatedBody.partnerIds: string[] — partner ids to associate with the design
 * @param res - MedusaResponse used to send the HTTP response
 *
 * @returns {void} Sends a 201 response with the workflow result as JSON.
 *
 * @throws {any} Rethrows workflow errors if the returned errors array is non-empty.
 *
 * @example
 * // Example client call (fetch)
 * await fetch('/admin/designs/123/partner', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ partnerIds: ['partner_1', 'partner_2'] })
 * });
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { linkDesignPartnerWorkflow } from "../../../../../workflows/designs/partner/link-design-to-partner";
import { LinkDesignPartner } from "../../validators";
import { DESIGN_MODULE } from "../../../../../modules/designs";
import { PARTNER_MODULE } from "../../../../../modules/partner";


 export const POST = async (
    req: MedusaRequest<LinkDesignPartner>,
    res: MedusaResponse,
  ) => {

    const designId = req.params.id
    
    const { result, errors } = await linkDesignPartnerWorkflow(req.scope).run({
      input: {
        design_id: designId,
        partner_ids: req.validatedBody.partnerIds
      },
    })
  
    if (errors.length > 0) {
      console.warn("Error reported at", errors);
      throw errors;
    }
  
    res.status(201).json( result );
  };

/**
 * DELETE /admin/designs/:id/partner
 * Unlink a partner from a design.
 * Body: { partnerId: string }
 * Only allowed if the partner has no active production runs for this design.
 */
export const DELETE = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const designId = req.params.id
  const { partnerId } = (req.body || {}) as { partnerId?: string }

  if (!partnerId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "partnerId is required"
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  // Check for active production runs for this partner + design
  const { data: runs } = await query.graph({
    entity: "production_runs",
    filters: {
      design_id: designId,
      partner_id: partnerId,
      status: { $nin: ["completed", "cancelled"] },
    },
    fields: ["id", "status"],
  })

  if (runs?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Cannot unlink partner — ${runs.length} active production run(s) exist. Complete or cancel them first.`
    )
  }

  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
  await remoteLink.dismiss({
    [DESIGN_MODULE]: { design_id: designId },
    [PARTNER_MODULE]: { partner_id: partnerId },
  })

  res.json({ design_id: designId, partner_id: partnerId, unlinked: true })
}