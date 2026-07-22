import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { updateDesignWorkflow } from "../../../../../../workflows/designs/update-design"
import {
  buildMoodboardScene,
  briefHasContent,
  mergeFramesIntoScene,
  type MoodboardScene,
} from "../../../../../../workflows/designs/moodboard/build-moodboard-scene"
import {
  assessTechPackCompleteness,
  buildTechPackInputFromDesign,
  type DesignForTechPack,
} from "../../../../../../workflows/designs/moodboard/techpack-input-from-design"
import { assertPartnerCanAuthorDesign } from "../../../helpers"

/**
 * POST /partners/designs/:designId/moodboard/generate
 *
 * Partner mirror of the admin generate route (#1113 S2). Builds the design's
 * moodboard scene from its structured data — including the **brief anchor
 * frames** (Concept & Identity · Audience & Positioning · Timeline & Budget) —
 * and persists it to `design.moodboard`.
 *
 * Differs from the admin route in two deliberate ways:
 *  1. Access = owner OR assigned partner (the invited designer holds an
 *     assignment link, not ownership).
 *  2. A brief-only design (no measurements/construction yet) can still generate
 *     — the tech-pack completeness gate only applies to the tech-pack frames, so
 *     a freshly-assembled brief renders its cards without a hard failure.
 *
 * Merges into any existing moodboard by frame name (mergeFramesIntoScene), so
 * regenerating refreshes the brief/tech-pack frames without clobbering the
 * designer's own additions — this is the "new moodboard inside one document".
 */
export const POST = async (
  req: AuthenticatedMedusaRequest & { params: { designId: string } },
  res: MedusaResponse
) => {
  const designId = req.params.designId
  await assertPartnerCanAuthorDesign(req, designId)

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
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
      // Brief columns → the anchor frames.
      "concept_theme",
      "aesthetic_keywords",
      "persona",
      "competitors",
      "price_point",
      "design_budget",
      "cost_currency",
      "milestones",
      "target_completion_date",
      // Tech-pack sources.
      "moodboard",
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
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Design ${designId} not found`)
  }

  const input = buildTechPackInputFromDesign(design as unknown as DesignForTechPack)

  // A brief-only design can generate its brief frames. Only require tech-pack
  // completeness when there's no brief to render at all.
  const completeness = assessTechPackCompleteness(input)
  if (!briefHasContent(input.brief) && !completeness.ok) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Nothing to generate yet. Add a brief (concept, audience, or timeline) or ${completeness.missing.join(
        " and "
      )}.`
    )
  }

  const scene = buildMoodboardScene(input)
  const merged = mergeFramesIntoScene(
    (design as any).moodboard as MoodboardScene | null,
    scene
  )

  const { errors } = await updateDesignWorkflow(req.scope).run({
    input: { id: designId, moodboard: merged } as any,
  })
  if (errors.length > 0) {
    throw errors
  }

  res.json({ moodboard: merged })
}
