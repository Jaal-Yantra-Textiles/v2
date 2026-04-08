import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MedusaError } from "@medusajs/utils"

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const designId = req.params.id
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Fetch the current design
  const { data: [design] } = await query.graph({
    entity: "design",
    fields: [
      "id",
      "name",
      "status",
      "revision_number",
      "revision_notes",
      "revised_from_id",
      "created_at",
      "updated_at",
    ],
    filters: { id: designId },
  })

  if (!design) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Design ${designId} not found`
    )
  }

  // Walk up the chain to find the root
  let rootId = design.id
  let currentReviseFromId = design.revised_from_id
  const ancestors: any[] = []

  while (currentReviseFromId) {
    const { data: [ancestor] } = await query.graph({
      entity: "design",
      fields: [
        "id",
        "name",
        "status",
        "revision_number",
        "revision_notes",
        "revised_from_id",
        "created_at",
        "updated_at",
      ],
      filters: { id: currentReviseFromId },
    })

    if (!ancestor) break
    ancestors.unshift(ancestor)
    rootId = ancestor.id
    currentReviseFromId = ancestor.revised_from_id
  }

  // Walk down from root to find all descendants
  const descendants: any[] = []
  const queue = [designId]

  while (queue.length) {
    const parentId = queue.shift()!
    const { data: children } = await query.graph({
      entity: "design",
      fields: [
        "id",
        "name",
        "status",
        "revision_number",
        "revision_notes",
        "revised_from_id",
        "created_at",
        "updated_at",
      ],
      filters: { revised_from_id: parentId },
    })

    for (const child of children) {
      descendants.push(child)
      queue.push(child.id)
    }
  }

  // Build the full lineage: ancestors → current → descendants
  const lineage = [...ancestors, design, ...descendants]

  res.status(200).json({
    design_id: designId,
    root_design_id: rootId,
    current_revision: design.revision_number,
    lineage,
  })
}
