/**
 * @file Admin API routes for a design's brief (roadmap #604, slice B).
 * @description Read + write the design-brief fields (concept_theme, persona,
 * competitors, price_point, design_budget) on a single design as a
 * self-contained sub-resource.
 * @module API/Admin/Designs/Brief
 *
 * GET    /admin/designs/:id/brief  → read the brief
 * POST   /admin/designs/:id/brief  → replace the whole brief (unset → null)
 * PUT    /admin/designs/:id/brief  → partial update (only provided keys change)
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import updateDesignWorkflow from "../../../../../workflows/designs/update-design"
import { refetchDesign } from "../../helpers"
import {
  DesignBrief,
  UpdateDesignBrief,
  DESIGN_BRIEF_FIELDS,
  pickDesignBrief,
} from "./validators"

// Read the brief subset (refetchDesign always selects "*", so the brief
// scalar columns are present without enumerating them).
const readBrief = async (id: string, scope: MedusaRequest["scope"]) => {
  const design = await refetchDesign(id, scope, [
    "id",
    ...DESIGN_BRIEF_FIELDS,
  ] as any)
  if (!design) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Design with id: ${id} was not found`
    )
  }
  return pickDesignBrief(design)
}

export const GET = async (
  req: MedusaRequest & { params: { id: string } },
  res: MedusaResponse
) => {
  const brief = await readBrief(req.params.id, req.scope)
  res.status(200).json({ brief })
}

// POST — full replace: every brief column is set, unset fields become null.
export const POST = async (
  req: MedusaRequest<DesignBrief> & { params: { id: string } },
  res: MedusaResponse
) => {
  const body = req.validatedBody ?? {}
  const input: Record<string, any> = {
    id: req.params.id,
    concept_theme: body.concept_theme ?? null,
    aesthetic_keywords: body.aesthetic_keywords ?? null,
    persona: body.persona ?? null,
    competitors: body.competitors ?? null,
    price_point: body.price_point ?? null,
    design_budget: body.design_budget ?? null,
    milestones: body.milestones ?? null,
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

  const brief = await readBrief(req.params.id, req.scope)
  res.status(200).json({ brief })
}

// PUT — partial update: only keys present in the body are written.
export const PUT = async (
  req: MedusaRequest<UpdateDesignBrief> & { params: { id: string } },
  res: MedusaResponse
) => {
  const body = req.validatedBody ?? {}
  const input: Record<string, any> = { id: req.params.id }
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

  const brief = await readBrief(req.params.id, req.scope)
  res.status(200).json({ brief })
}
