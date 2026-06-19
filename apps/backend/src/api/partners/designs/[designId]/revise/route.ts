/**
 * @file Partner API route to revise a partner-owned design.
 * @module API/Partners/Designs/Revise
 *
 * Roadmap #6/#337 — promote admin Designs to partner-ui. Mirrors
 * `POST /admin/designs/:id/revise` (same `reviseDesignWorkflow` call and
 * `{ design, message }` response shape), but guarded to the OWNING partner.
 *
 * Why this mutating route is safe to self-serve (unlike the other admin
 * design mutations — approve/notify-customer/partner/cancel-assignment):
 *   - It operates on the partner's OWN design only (`assertPartnerOwnsDesign`,
 *     `owner_partner_id === partner.id`).
 *   - `reviseDesignWorkflow` re-creates the partner ↔ design link on the new
 *     revision (see its `linkPartnersToNewDesignStep`), so the revision stays
 *     partner-owned and isolated — no cross-tenant leak.
 *   - No external side-effects: it does not create a storefront product,
 *     email a customer, or change partner assignments.
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { reviseDesignWorkflow } from "../../../../../workflows/designs/revise-design"
import { assertPartnerOwnsDesign } from "../../helpers"
import { ReviseDesignInput } from "./validators"
import { isDesignRevisable, REVISABLE_STATUSES } from "./revisable"

/**
 * Create a new revision of a partner-owned design; the original is superseded.
 * @route POST /partners/designs/{designId}/revise
 *
 * @returns {Object} 200 - { design, message }
 * @throws {MedusaError} 401 - Partner authentication required
 * @throws {MedusaError} 404 - Design not found
 * @throws {MedusaError} 400 (NOT_ALLOWED) - Design not owned by this partner
 * @throws {MedusaError} 400 (NOT_ALLOWED) - Design status is not revisable
 */
export async function POST(
  req: AuthenticatedMedusaRequest<ReviseDesignInput> & {
    params: { designId: string }
  },
  res: MedusaResponse
): Promise<void> {
  const { designId } = req.params

  // Ownership guard (401/404/NOT_ALLOWED). Only the partner that created the
  // design may revise it — an admin-assigned design is not theirs to fork.
  const { design } = await assertPartnerOwnsDesign(req, designId)

  // Friendly pre-flight so the partner gets a clear 422 instead of the
  // generic error the workflow throws for a non-revisable status.
  if (!isDesignRevisable(design.status)) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Design cannot be revised from status "${design.status}". Must be one of: ${REVISABLE_STATUSES.join(", ")}`
    )
  }

  const { revision_notes, overrides } = req.validatedBody

  const { result } = await reviseDesignWorkflow(req.scope).run({
    input: {
      design_id: designId,
      revision_notes,
      overrides,
    },
    throwOnError: true,
  })

  res.status(200).json({
    design: result,
    message:
      "Design revised successfully. Original design has been superseded.",
  })
}
