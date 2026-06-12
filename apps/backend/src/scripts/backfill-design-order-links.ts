import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ExecArgs } from "@medusajs/framework/types"
import { linkDesignsToOrder } from "../workflows/designs/link-designs-to-order"

/**
 * One-off: create missing design ↔ order links for historical purchases
 * (roadmap #29 / issue #379).
 *
 * The order.placed subscriber's linking block silently no-oped (it read
 * `cart_id` off the order model, but order↔cart is the `order_cart`
 * link), so customer purchases never reflected on the admin "Design
 * Orders" view — they stayed "In Cart"/pending. The subscriber is fixed;
 * this catches up every existing order via the same shared traversal
 * (order → cart → line items → design_line_item → design_order upsert).
 *
 * Idempotent — already-linked (design, order) pairs are skipped.
 *
 * Usage:
 *   DRY_RUN=1 npx medusa exec ./src/scripts/backfill-design-order-links.ts
 *   npx medusa exec ./src/scripts/backfill-design-order-links.ts
 *   (scope) ORDER_IDS=order_a,order_b
 */
export default async function backfillDesignOrderLinks({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const dryRun = process.env.DRY_RUN === "1"
  const scope = (process.env.ORDER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  // Walk every order that came from a cart — the only ones that can
  // carry design_line_item provenance.
  const { data: orderCarts } = await query.graph({
    entity: "order_cart",
    fields: ["order_id", "cart_id"],
    ...(scope.length ? { filters: { order_id: scope } } : {}),
    pagination: { skip: 0, take: 5000 },
  })

  logger.info(
    `[backfill-design-order-links] ${orderCarts?.length || 0} cart-backed order(s) to inspect${dryRun ? " (dry run)" : ""}`
  )

  let ordersLinked = 0
  let linksCreated = 0
  let errors = 0

  for (const oc of orderCarts || []) {
    try {
      const { linked, design_ids } = await linkDesignsToOrder(
        container as any,
        oc.order_id,
        { dryRun }
      )
      if (linked > 0) {
        ordersLinked++
        linksCreated += linked
        logger.info(
          `[backfill-design-order-links] order ${oc.order_id}: ${dryRun ? "would link" : "linked"} design(s) ${design_ids.join(", ")}`
        )
      }
    } catch (e: any) {
      errors++
      logger.error(
        `[backfill-design-order-links] order ${oc.order_id}: ${e?.message}`
      )
    }
  }

  logger.info(
    `[backfill-design-order-links] done — orders linked: ${ordersLinked}, links created: ${linksCreated}, errors: ${errors}${dryRun ? " (dry run — no writes)" : ""}`
  )
  if (errors > 0) process.exit(1)
}
