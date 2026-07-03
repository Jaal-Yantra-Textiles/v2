import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import type { IEventBusModuleService } from "@medusajs/framework/types"
import partnerProductLink from "../../../../../links/partner-product"
import { ApprovalAction, decideApprovalTransition } from "./artisan-approval"

const LINK_ENTRY = partnerProductLink.entryPoint

/**
 * #859 S2 (#861) — shared handler for the admin approve/reject of an artisan's
 * proposed product.
 *
 * approve → publishes the product and emits `partner_product.approved` (the
 * cross-list subscriber + any visual flow react to it). reject → sets
 * `rejected` and emits `partner_product.rejected`. The generic product editor
 * is intentionally bypassed so the transition is an explicit, auditable action
 * carrying a dedicated event rather than a noisy `product.updated`.
 */
export async function runArtisanApproval(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
  action: ApprovalAction
) {
  const productId = req.params.id
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  // Resolve ownership (artisan products carry a partner-product link).
  const { data: ownerLinks = [] } = await query.graph({
    entity: LINK_ENTRY,
    fields: ["partner_id", "product_id"],
    filters: { product_id: productId },
  })
  const partnerId = ownerLinks[0]?.partner_id ?? null

  // Current product status.
  const { data: products = [] } = await query.graph({
    entity: "product",
    fields: ["id", "status"],
    filters: { id: productId },
  })
  const product = products[0]
  if (!product) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Product ${productId} not found`)
  }

  const decision = decideApprovalTransition(action, {
    hasOwnerLink: ownerLinks.length > 0,
    currentStatus: product.status,
  })
  if (!decision.ok) {
    throw new MedusaError(
      decision.code === "not_artisan_owned"
        ? MedusaError.Types.NOT_FOUND
        : MedusaError.Types.INVALID_DATA,
      decision.reason
    )
  }

  await updateProductsWorkflow(req.scope).run({
    input: { products: [{ id: productId, status: decision.nextStatus }] },
  })

  const eventBus = req.scope.resolve(Modules.EVENT_BUS) as IEventBusModuleService
  await eventBus.emit({
    name: decision.event,
    data: { id: productId, partner_id: partnerId },
  })

  return res.json({
    id: productId,
    status: decision.nextStatus,
    partner_id: partnerId,
    event: decision.event,
  })
}
