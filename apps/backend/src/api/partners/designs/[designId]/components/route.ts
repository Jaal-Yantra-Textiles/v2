/**
 * @file Partner API route for a design's components (BOM children).
 * @module API/Partners/Designs/Components
 *
 * Roadmap #6 — promote admin Designs to partner-ui. Mirrors
 * `GET /admin/designs/:id/components` (same `listDesignComponents` query +
 * `{ components, count }` response shape), but guarded to the owning
 * partner and scoped so the partner only sees components that are THEIR
 * own designs (no cross-tenant leak via the `component_design` relation).
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { DESIGN_MODULE } from "../../../../../modules/designs"
import type DesignService from "../../../../../modules/designs/service"
import { assertPartnerOwnsDesign } from "../../helpers"
import { scopeComponentsToPartner, ComponentEntry } from "./scope-components"

/**
 * List the partner-owned component designs that make up this bundle.
 * @route GET /partners/designs/{designId}/components
 *
 * @returns {Object} 200 - { components, count }
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
  // admin-assigned design is not a partner's to inspect components of.
  const { partner } = await assertPartnerOwnsDesign(req, designId)

  const designService = req.scope.resolve(DESIGN_MODULE) as DesignService

  const components = (await designService.listDesignComponents(
    { parent_design_id: designId },
    { relations: ["component_design"] }
  )) as ComponentEntry[]

  // Scope strictly to components this partner owns (no cross-tenant leak).
  const scoped = scopeComponentsToPartner(components, partner.id)

  res.status(200).json({ components: scoped, count: scoped.length })
}
