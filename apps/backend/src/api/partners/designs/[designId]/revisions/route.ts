/**
 * @file Partner API route for a design's revision lineage.
 * @module API/Partners/Designs/Revisions
 *
 * Roadmap #6 — promote admin Designs to partner-ui. Mirrors
 * `GET /admin/designs/:id/revisions` (same lineage walk + response
 * shape), but guarded to the owning partner and scoped so the partner
 * only sees the slice of the lineage they own (no cross-tenant leak via
 * the `revised_from_id` chain).
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { assertPartnerOwnsDesign } from "../../helpers"
import { scopeLineageToPartner, LineageEntry } from "./lineage"

const LINEAGE_FIELDS = [
  "id",
  "name",
  "status",
  "revision_number",
  "revision_notes",
  "revised_from_id",
  "owner_partner_id",
  "created_at",
  "updated_at",
]

/**
 * Get the revision lineage of a partner-owned design.
 * @route GET /partners/designs/{designId}/revisions
 *
 * @returns {Object} 200 - { design_id, root_design_id, current_revision, lineage }
 * @throws {MedusaError} 401 - Partner authentication required
 * @throws {MedusaError} 403 - Design is not owned by this partner
 * @throws {MedusaError} 404 - Design not found
 */
export async function GET(
  req: AuthenticatedMedusaRequest & { params: { designId: string } },
  res: MedusaResponse
) {
  const { designId } = req.params

  // Ownership guard (401/403/404). Self-serve designs only — an
  // admin-assigned design is not a partner's to inspect revisions of.
  const { partner } = await assertPartnerOwnsDesign(req, designId)

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Fetch the current design with the fields needed for the lineage.
  const {
    data: [design],
  } = await query.graph({
    entity: "design",
    fields: LINEAGE_FIELDS,
    filters: { id: designId },
  })

  // Walk up the chain to find all ancestors (newest-first unshift → oldest-first).
  let currentReviseFromId = (design as LineageEntry).revised_from_id
  const ancestors: LineageEntry[] = []

  while (currentReviseFromId) {
    const {
      data: [ancestor],
    } = await query.graph({
      entity: "design",
      fields: LINEAGE_FIELDS,
      filters: { id: currentReviseFromId },
    })

    if (!ancestor) break
    ancestors.unshift(ancestor as LineageEntry)
    currentReviseFromId = (ancestor as LineageEntry).revised_from_id
  }

  // Walk down from the current design to find all descendants (BFS).
  const descendants: LineageEntry[] = []
  const queue = [designId]

  while (queue.length) {
    const parentId = queue.shift()!
    const { data: children } = await query.graph({
      entity: "design",
      fields: LINEAGE_FIELDS,
      filters: { revised_from_id: parentId },
    })

    for (const child of children as LineageEntry[]) {
      descendants.push(child)
      queue.push(child.id)
    }
  }

  // Full lineage: ancestors → current → descendants.
  const full = [...ancestors, design as LineageEntry, ...descendants]

  // Scope strictly to designs this partner owns (no cross-tenant leak).
  const { lineage, root_design_id } = scopeLineageToPartner(full, partner.id)

  res.status(200).json({
    design_id: designId,
    root_design_id,
    current_revision: (design as LineageEntry).revision_number,
    lineage,
  })
}
