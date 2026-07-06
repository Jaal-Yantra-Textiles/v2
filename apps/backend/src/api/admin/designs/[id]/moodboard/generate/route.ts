import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import updateDesignWorkflow from "../../../../../../workflows/designs/update-design"
import { buildMoodboardScene } from "../../../../../../workflows/designs/moodboard/build-moodboard-scene"
import {
  buildTechPackInputFromDesign,
  type DesignForTechPack,
} from "../../../../../../workflows/designs/moodboard/techpack-input-from-design"

/**
 * POST /admin/designs/:id/moodboard/generate
 *
 * Seeds the design's `moodboard` with a freshly-built AI tech-pack scene (#892):
 * loads the design's structured data (header/flats/size-set/colorways + Construction
 * specs → construction details), runs the deterministic scene builder, persists the
 * result to `design.moodboard`, and returns it.
 *
 * This REPLACES any existing moodboard — it's a seed/regenerate action, not a merge.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const designId = req.params.id

  const { data } = await query.graph({
    entity: "designs",
    filters: { id: designId },
    fields: [
      "id",
      "name",
      "design_type",
      "metadata",
      "thumbnail_url",
      "color_palette",
      "size_sets.size_label",
      "size_sets.measurements",
      "specifications.title",
      "specifications.category",
      "specifications.details",
      "specifications.special_instructions",
      "specifications.metadata",
    ],
  })

  const design = data?.[0]
  if (!design) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Design ${designId} not found`
    )
  }

  const input = buildTechPackInputFromDesign(
    design as unknown as DesignForTechPack
  )
  const scene = buildMoodboardScene(input)

  const { errors } = await updateDesignWorkflow(req.scope).run({
    input: { id: designId, moodboard: scene } as any,
  })
  if (errors.length > 0) {
    throw errors
  }

  res.json({ moodboard: scene })
}
