import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getOrderDetailWorkflow } from "@medusajs/medusa/core-flows"
import { Modules } from "@medusajs/framework/utils"
import { validatePartnerOrderOwnership } from "../../helpers"

/**
 * GET / POST partner order detail.
 *
 * Field selection is handled by `validateAndTransformQuery` middleware
 * (registered in `apps/backend/src/api/middlewares.ts`) using Medusa's
 * own admin order query config. That middleware:
 *
 *   1. Validates `?fields=...` from the request
 *   2. Merges with the admin defaults (`retrieveTransformQueryConfig.defaults`)
 *   3. Normalises field paths so bare cross-module references
 *      (e.g. `region.automatic_taxes`) get expanded via remote-link
 *      instead of being passed to MikroORM as a bare populate
 *
 * Without the middleware, bare relation paths trip
 * "Cannot read properties of undefined (reading 'kind')" inside
 * MikroORM's `expandDotPaths` because the Order entity has only
 * `region_id` scalars, not ORM relations for cross-module entities.
 *
 * The previous DEFAULT_FIELDS-on-the-route approach bypassed the
 * middleware and broke whenever the partner-ui added a new field — see
 * the order detail crash that motivated this refactor.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderOwnership(req.auth_context, req.params.id, req.scope)

  const { result } = await getOrderDetailWorkflow(req.scope).run({
    input: {
      fields: (req as any).queryConfig.fields,
      order_id: req.params.id,
      version: (req as any).validatedQuery?.version,
    },
  })

  res.json({ order: result })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderOwnership(req.auth_context, req.params.id, req.scope)

  const orderService = req.scope.resolve(Modules.ORDER) as any
  const order = await orderService.updateOrders(req.params.id, req.body as any)

  res.json({ order })
}
