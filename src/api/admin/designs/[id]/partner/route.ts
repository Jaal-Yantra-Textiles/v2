
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
import { linkDesignPartnerWorkflow } from "../../../../../workflows/designs/partner/link-design-to-partner";
import { LinkDesignPartner } from "../../validators";


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