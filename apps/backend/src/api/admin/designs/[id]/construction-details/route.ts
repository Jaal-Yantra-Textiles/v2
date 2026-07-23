import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { DESIGN_MODULE } from "../../../../../modules/designs"
import type DesignService from "../../../../../modules/designs/service"
import {
  SUPPORTED_TECHNIQUES,
  techniqueLabel,
} from "../../../../../modules/designs/construction-techniques"

/**
 * Construction details = DesignSpecifications with category "Construction" whose
 * metadata carries { technique, params, fabricRules } — the source the #892
 * tech-pack generator reads for the "Construction details" frame. These routes let
 * the admin manage them on a real design (instead of via seed scripts), so a design
 * can satisfy the generation completeness gate.
 *
 * Techniques + presets come from the canonical construction-techniques module
 * (#1113 Feature B) — the single source shared with the renderer, admin UI and
 * partner picker.
 */

export { SUPPORTED_TECHNIQUES }

export const ConstructionDetailBodySchema = z.object({
  technique: z.enum(SUPPORTED_TECHNIQUES),
  label: z.string().trim().min(1).optional(),
  params: z.record(z.string(), z.number()).optional(),
  fabricRules: z.array(z.string().trim().min(1)).optional(),
  note: z.string().trim().optional(),
})

/**
 * GET /admin/designs/:id/construction-details
 * List this design's Construction specs (the renderable construction details).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const designService = req.scope.resolve(DESIGN_MODULE) as DesignService

  const specs = await designService.listDesignSpecifications({
    design_id: id,
    category: "Construction",
  })

  res.json({ construction_details: specs, count: specs.length })
}

/**
 * POST /admin/designs/:id/construction-details
 * Attach a construction detail. Body: { technique, label?, params?, fabricRules?, note? }
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params

  const parsed = ConstructionDetailBodySchema.safeParse(req.body)
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    )
  }
  const { technique, label, params, fabricRules, note } = parsed.data

  const designService = req.scope.resolve(DESIGN_MODULE) as DesignService

  const design = await designService.retrieveDesign(id).catch(() => null)
  if (!design) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Design ${id} not found`)
  }

  const title = label ?? techniqueLabel(technique)
  const created = await designService.createDesignSpecifications({
    design_id: id,
    title,
    category: "Construction",
    // `details` is required on the model; fall back to a derived description.
    details: note ?? `${title} (${technique})`,
    special_instructions: note ?? null,
    version: "1",
    metadata: {
      technique,
      ...(params && Object.keys(params).length ? { params } : {}),
      ...(fabricRules && fabricRules.length ? { fabricRules } : {}),
    },
  })

  res.status(201).json({ construction_detail: created })
}
