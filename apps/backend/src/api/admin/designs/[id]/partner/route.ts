
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
 *   - req.validatedBody.partnerIds: string[] — partner ids to link with no stage
 *   - req.validatedBody.partners: { partner_id, stage_role? }[] — with a stage (#2306)
 * @param res - MedusaResponse used to send the HTTP response
 *
 * @returns {void} Sends a 201 response: `{ linked, stage_changed }` partner ids.
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
import {
  DesignPartnerRosterEntry,
  linkDesignPartnerWorkflow,
} from "../../../../../workflows/designs/partner/link-design-to-partner";
import { LinkDesignPartner } from "../../validators";
import { DESIGN_MODULE } from "../../../../../modules/designs";
import { PARTNER_MODULE } from "../../../../../modules/partner";
import designPartnersLink from "../../../../../links/design-partners-link";

/**
 * Both body shapes as one list. A partner named in `partners` wins over the
 * same id in `partnerIds`, since only `partners` can say what their stage is.
 */
const toRosterEntries = (body: LinkDesignPartner): DesignPartnerRosterEntry[] => {
  const entries = new Map<string, DesignPartnerRosterEntry>()
  for (const id of body.partnerIds ?? []) {
    entries.set(id, { partner_id: id })
  }
  for (const p of body.partners ?? []) {
    entries.set(p.partner_id, p)
  }
  return [...entries.values()]
}


 export const POST = async (
    req: MedusaRequest<LinkDesignPartner>,
    res: MedusaResponse,
  ) => {
    const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

    const designId = req.params.id
    
    const { result, errors } = await linkDesignPartnerWorkflow(req.scope).run({
      input: {
        design_id: designId,
        partners: toRosterEntries(req.validatedBody),
      },
    })
  
    if (errors.length > 0) {
      logger.warn(`Error reported at ${JSON.stringify(errors)}`);
      throw errors;
    }
  
    res.status(201).json( result );
  };

/**
 * GET /admin/designs/:id/partner
 * The design's roster (#2306 S1): each linked partner with its production
 * stage (`stage_role`) and its relationship to the design (`role`). The
 * design's own `partners.*` field cannot carry these — they live on the link.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  const { data } = await query.graph({
    entity: designPartnersLink.entryPoint,
    filters: { design_id: req.params.id },
    fields: [
      "partner_id",
      "role",
      "stage_role",
      "sla_days",
      "created_at",
      "partner.id",
      "partner.name",
      "partner.handle",
      "partner.logo",
    ],
  })

  const roster = (data ?? []).map((l: any) => ({
    partner_id: l.partner_id,
    role: l.role ?? null,
    stage_role: l.stage_role ?? null,
    sla_days: l.sla_days ?? null,
    created_at: l.created_at,
    partner: l.partner ?? null,
  }))

  res.json({ design_id: req.params.id, roster, count: roster.length })
}

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