/**
 * @file Partner API routes for a partner-owned design's brief (roadmap #604, slice C).
 * @description Read + write the design-brief fields (concept_theme, persona,
 * competitors, price_point, design_budget) on a single PARTNER-OWNED design as a
 * self-contained sub-resource. Mirrors the admin slice-B contract
 * (`/admin/designs/:id/brief`) wire-for-wire, but every operation is guarded to
 * the OWNING partner via `assertPartnerOwnsDesign`.
 * @module API/Partners/Designs/Brief
 *
 * GET    /partners/designs/:designId/brief  → read the brief
 * POST   /partners/designs/:designId/brief  → replace the whole brief (unset → null)
 * PUT    /partners/designs/:designId/brief  → partial update (only provided keys change)
 *
 * Why these mutating routes are safe to self-serve: they operate on the
 * partner's OWN design only, and the brief columns are pure metadata of that
 * design (no product creation, no email, no cross-tenant fields) — the same
 * boundary that makes the partner `revise`/`tasks` mutations safe.
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import updateDesignWorkflow from "../../../../../workflows/designs/update-design"
import { assertPartnerOwnsDesign } from "../../helpers"
import {
  DesignBrief,
  UpdateDesignBrief,
  DESIGN_BRIEF_FIELDS,
  pickDesignBrief,
} from "./validators"

/**
 * Read the brief subset for a design. Ownership is asserted by the caller; this
 * issues a second query.graph for the brief scalar columns (the ownership guard
 * only selects id/owner/name/status).
 */
const readBrief = async (
  designId: string,
  scope: AuthenticatedMedusaRequest["scope"]
) => {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "design",
    filters: { id: designId },
    fields: ["id", ...DESIGN_BRIEF_FIELDS] as any,
  })
  const design = (data || [])[0]
  return pickDesignBrief(design)
}

/**
 * @route GET /partners/designs/{designId}/brief
 * @returns {Object} 200 - { brief }
 * @throws {MedusaError} 401 - Partner authentication required
 * @throws {MedusaError} 404 - Design not found
 * @throws {MedusaError} 400 (NOT_ALLOWED) - Design not owned by this partner
 */
export async function GET(
  req: AuthenticatedMedusaRequest & { params: { designId: string } },
  res: MedusaResponse
): Promise<void> {
  const { designId } = req.params
  await assertPartnerOwnsDesign(req, designId)
  const brief = await readBrief(designId, req.scope)
  res.status(200).json({ brief })
}

/**
 * Full replace — every brief column is set; unset fields become null.
 * @route POST /partners/designs/{designId}/brief
 */
export async function POST(
  req: AuthenticatedMedusaRequest<DesignBrief> & {
    params: { designId: string }
  },
  res: MedusaResponse
): Promise<void> {
  const { designId } = req.params
  await assertPartnerOwnsDesign(req, designId)

  const body = req.validatedBody ?? {}
  const input: Record<string, any> = {
    id: designId,
    concept_theme: body.concept_theme ?? null,
    persona: body.persona ?? null,
    competitors: body.competitors ?? null,
    price_point: body.price_point ?? null,
    design_budget: body.design_budget ?? null,
  }
  // cost_currency is shared with manufacturing cost — only overwrite it when
  // the caller explicitly sends one, never null it out on a brief replace.
  if (body.cost_currency != null) {
    input.cost_currency = body.cost_currency
  }

  const { errors } = await updateDesignWorkflow(req.scope).run({
    input: input as any,
  })
  if (errors.length > 0) {
    throw errors
  }

  const brief = await readBrief(designId, req.scope)
  res.status(200).json({ brief })
}

/**
 * Partial update — only keys present in the body are written.
 * @route PUT /partners/designs/{designId}/brief
 */
export async function PUT(
  req: AuthenticatedMedusaRequest<UpdateDesignBrief> & {
    params: { designId: string }
  },
  res: MedusaResponse
): Promise<void> {
  const { designId } = req.params
  await assertPartnerOwnsDesign(req, designId)

  const body = req.validatedBody ?? {}
  const input: Record<string, any> = { id: designId }
  for (const key of DESIGN_BRIEF_FIELDS) {
    if (key in body && (body as any)[key] !== undefined) {
      input[key] = (body as any)[key]
    }
  }

  const { errors } = await updateDesignWorkflow(req.scope).run({
    input: input as any,
  })
  if (errors.length > 0) {
    throw errors
  }

  const brief = await readBrief(designId, req.scope)
  res.status(200).json({ brief })
}
