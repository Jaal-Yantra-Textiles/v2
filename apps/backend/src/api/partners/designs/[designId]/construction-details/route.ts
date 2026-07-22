import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { DESIGN_MODULE } from "../../../../../modules/designs"
import type DesignService from "../../../../../modules/designs/service"
import {
  SUPPORTED_TECHNIQUES,
  techniqueLabel,
} from "../../../../../modules/designs/construction-techniques"
import { assertPartnerCanAuthorDesign } from "../../helpers"

/**
 * Partner mirror of the admin construction-details routes (#1113 Feature B).
 * Lets the invited designer author construction details (technique + params +
 * fabricRules) straight from the moodboard picker. Author-scoped: owner OR
 * assigned/invited designer. Stored as DesignSpecifications(category:"Construction")
 * exactly like the admin path, so the tech-pack generator + DETAIL_RENDERERS
 * pick them up unchanged.
 */

const ConstructionDetailBodySchema = z.object({
  technique: z.enum(SUPPORTED_TECHNIQUES),
  label: z.string().trim().min(1).optional(),
  params: z.record(z.string(), z.number()).optional(),
  fabricRules: z.array(z.string().trim().min(1)).optional(),
  note: z.string().trim().optional(),
})

export const GET = async (
  req: AuthenticatedMedusaRequest & { params: { designId: string } },
  res: MedusaResponse
) => {
  const designId = req.params.designId
  await assertPartnerCanAuthorDesign(req, designId)

  const designService = req.scope.resolve(DESIGN_MODULE) as DesignService
  const specs = await designService.listDesignSpecifications({
    design_id: designId,
    category: "Construction",
  })
  res.json({ construction_details: specs, count: specs.length })
}

export const POST = async (
  req: AuthenticatedMedusaRequest & { params: { designId: string } },
  res: MedusaResponse
) => {
  const designId = req.params.designId
  await assertPartnerCanAuthorDesign(req, designId)

  const parsed = ConstructionDetailBodySchema.safeParse(req.body)
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    )
  }
  const { technique, label, params, fabricRules, note } = parsed.data

  const designService = req.scope.resolve(DESIGN_MODULE) as DesignService
  const title = label ?? techniqueLabel(technique)
  const created = await designService.createDesignSpecifications({
    design_id: designId,
    title,
    category: "Construction",
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
