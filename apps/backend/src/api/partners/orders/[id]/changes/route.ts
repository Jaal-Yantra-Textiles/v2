import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { validatePartnerOrderOwnership } from "../../../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderOwnership(req.auth_context, req.params.id, req.scope)

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Pass the `change_type` filter through from the partner-ui. The
  // OrderTimeline narrows changes to edit/claim/exchange/return/transfer
  // /update_order — without this filter, every order_change row comes back
  // and the timeline mis-categorises drafts.
  const reqQuery = (req.query || {}) as Record<string, any>
  const filters: Record<string, any> = { order_id: req.params.id }
  if (reqQuery.change_type) {
    filters.change_type = Array.isArray(reqQuery.change_type)
      ? reqQuery.change_type
      : String(reqQuery.change_type).split(",")
  }

  const { data } = await query.graph({
    entity: "order_change",
    // `actions.*` not `*actions` — the asterisk-prefix form gets passed
    // to MikroORM as a literal field name on some entities and throws
    // "undefined is not an object (reading 'kind')" / "does not have
    // property '*actions'". Suffix form is the universally-safe one.
    // Without this, the partner-ui's OrderTimeline crashes at
    // `change.actions.forEach` because each change comes back without
    // its actions array.
    fields: ["*", "actions.*"],
    filters,
  })

  res.json({ order_changes: data || [] })
}
