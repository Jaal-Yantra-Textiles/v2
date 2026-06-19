/**
 * @file Partner API route for a design's "used-in" (parent bundles).
 * @module API/Partners/Designs/UsedIn
 *
 * Roadmap #6 — promote admin Designs to partner-ui. Mirrors
 * `GET /admin/designs/:id/used-in` (same `listDesignComponents` query +
 * `{ used_in, count }` response shape), but guarded to the owning partner
 * and scoped so the partner only sees the bundle designs THEY own (no
 * cross-tenant leak via the `parent_design` relation).
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { DESIGN_MODULE } from "../../../../../modules/designs"
import type DesignService from "../../../../../modules/designs/service"
import { assertPartnerOwnsDesign } from "../../helpers"
import { scopeUsagesToPartner, UsageEntry } from "./scope-usages"

/**
 * List the partner-owned bundle designs that include this design as a
 * component.
 * @route GET /partners/designs/{designId}/used-in
 *
 * @returns {Object} 200 - { used_in, count }
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
  // admin-assigned design is not a partner's to inspect usages of.
  const { partner } = await assertPartnerOwnsDesign(req, designId)

  const designService = req.scope.resolve(DESIGN_MODULE) as DesignService

  const usages = (await designService.listDesignComponents(
    { component_design_id: designId },
    { relations: ["parent_design"] }
  )) as UsageEntry[]

  // Scope strictly to bundles this partner owns (no cross-tenant leak).
  const used_in = scopeUsagesToPartner(usages, partner.id)

  res.status(200).json({ used_in, count: used_in.length })
}
