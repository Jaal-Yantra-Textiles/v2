import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getOrderDetailWorkflow } from "@medusajs/core-flows"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

// #403 (orders unification → admin): override the built-in admin order DETAIL so
// /admin/orders/:id self-describes its kind + work-status, mirroring what the
// partner detail route already does (`/partners/orders/:id`).
//
// Mechanism: a project route file at this exact path overrides the core handler
// (routes-loader: last-registered wins; project src/api is scanned after core).
// Core's `validateAndTransformQuery` middleware for `/admin/orders/:id` still
// runs, so `req.queryConfig.fields` is populated when GET runs — and core's
// `validateAndTransformBody` still runs for POST. Overriding the file replaces
// BOTH methods, so we re-export core's order-update POST unchanged below; only
// GET gains the link/work-status attachment.
//
// Shim boundary (#342/#403): production_run / inventory_order stay the
// execution-authoring artifacts. This is a READ-ONLY augmentation — the links
// are 1:1 reverse accessors resolved best-effort, never written through here.

// Re-export core's order-update handler verbatim — admin order updates must keep
// working after the override.
export { POST } from "@medusajs/medusa/api/admin/orders/[id]/route"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await getOrderDetailWorkflow(req.scope).run({
    input: {
      fields: (req as any).queryConfig.fields,
      order_id: req.params.id,
      version: (req as any).validatedQuery?.version,
    },
  })

  // The core order query config does not expand our custom order links, so
  // attach them directly (mirrors `list-partner-orders.ts` discrimination and
  // the partner detail route). The order↔execution links are 1:1, so each
  // reverse accessor resolves to a single `{ id }` object; the UI tolerates
  // object-or-array. `unified_order_status.partner_status` is the PR-F sidecar
  // column the work-status badge reads. Best-effort: a graph hiccup must not
  // break the detail route — fall back to plain retail rendering.
  try {
    const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "orders",
      fields: [
        "id",
        "production_runs.id",
        "inventory_orders.id",
        "unified_order_status.partner_status",
      ],
      filters: { id: req.params.id },
    })
    const links = data?.[0]
    if (links) {
      ;(result as any).production_runs = links.production_runs
      ;(result as any).inventory_orders = links.inventory_orders
      ;(result as any).unified_order_status = links.unified_order_status
    }
  } catch {
    // leave the order as-is; the UI falls back to retail rendering
  }

  res.json({ order: result })
}
