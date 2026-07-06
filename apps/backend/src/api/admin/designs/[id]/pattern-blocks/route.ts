import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  PATTERN_BLOCKS,
  draftPatternBlockFromSizeSet,
  type DraftedBlock,
  type PatternBlockId,
} from "../../../../../workflows/designs/pattern-blocks/draft-pattern-block"

/**
 * GET /admin/designs/:id/pattern-blocks
 *
 * Drafts FreeSewing pattern blocks (bodice / skirt / trouser) for a design,
 * sized from its first DesignSizeSet (measurements in inches). Designs without a
 * size set still get default-sized blocks (the resolver backfills from a standard
 * model). Returns a clean, Library-styled SVG per cut piece.
 *
 * Query:
 *  - block: optional PatternBlockId to draft a single block (else all).
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const designId = req.params.id

  const { data } = await query.graph({
    entity: "designs",
    filters: { id: designId },
    fields: ["id", "size_sets.id", "size_sets.size_label", "size_sets.measurements"],
  })

  const design = data?.[0]
  const sizeSets = design?.size_sets ?? []
  const sizeSet = sizeSets[0]
  const measurements = (sizeSet?.measurements ?? null) as
    | Record<string, number>
    | null

  const requested = req.query.block as PatternBlockId | undefined
  const validIds = new Set(PATTERN_BLOCKS.map((b) => b.id))
  const ids =
    requested && validIds.has(requested as PatternBlockId)
      ? [requested as PatternBlockId]
      : PATTERN_BLOCKS.map((b) => b.id)

  const blocks: DraftedBlock[] = []
  for (const id of ids) {
    try {
      blocks.push(await draftPatternBlockFromSizeSet(id, measurements, "in"))
    } catch {
      // A block that fails to draft (e.g. degenerate measurements) is skipped
      // rather than failing the whole response.
    }
  }

  res.json({
    blocks,
    catalog: PATTERN_BLOCKS,
    size_label: sizeSet?.size_label ?? null,
  })
}
