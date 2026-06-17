import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ExecArgs } from "@medusajs/framework/types"

/**
 * One-off: stamp `completed_at` on carts that were converted to a real order
 * via the admin "Design Order → Convert" path but were left with
 * `completed_at = null` (issue #443).
 *
 * Background: `convert-design-order.ts` historically stamped only
 * `metadata.converted_order_id` and never set `completed_at`. The abandoned-cart
 * recovery flow's only "this cart converted" guard is `completed_at IS NULL`, so
 * those carts stayed eligible and customers who had already purchased could get
 * the "You left something beautiful behind" email. The convert flow now sets
 * `completed_at` going forward; this catches up existing carts.
 *
 * `completed_at` is set to the linked order's `created_at` when resolvable, else
 * now. Idempotent — carts that already have `completed_at` are skipped.
 *
 * Usage:
 *   DRY_RUN=1 npx medusa exec ./src/scripts/backfill-converted-cart-completed-at.ts
 *   npx medusa exec ./src/scripts/backfill-converted-cart-completed-at.ts
 *   (scope to specific carts) CART_IDS=cart_a,cart_b npx medusa exec ...
 *
 * Prod note: the runtime image ships transpiled JS only — run with the `.js`
 * extension via ECS run-task (see reference_prod_ecs_run_task_scripts).
 */
export default async function backfillConvertedCartCompletedAt({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const cartService: any = container.resolve(Modules.CART)

  const dryRun = process.env.DRY_RUN === "1"
  const scope = (process.env.CART_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  // Non-completed carts only — converted carts we still need to close out.
  const { data: carts } = await query.graph({
    entity: "cart",
    fields: ["id", "completed_at", "metadata", "created_at"],
    filters: scope.length
      ? { id: scope }
      : ({ completed_at: null } as any),
    pagination: { skip: 0, take: 5000 },
  })

  const candidates = (carts || []).filter(
    (c: any) => !c.completed_at && (c.metadata as any)?.converted_order_id
  )

  logger.info(
    `[backfill-converted-cart-completed-at] ${candidates.length} converted-but-not-completed cart(s) to fix${dryRun ? " (dry run)" : ""}`
  )

  let fixed = 0
  let errors = 0

  for (const cart of candidates) {
    const orderId = (cart.metadata as any).converted_order_id as string
    // Prefer the order's created_at as the "completed" instant; fall back to now.
    let completedAt = new Date()
    try {
      const { data: orders } = await query.graph({
        entity: "order",
        fields: ["id", "created_at"],
        filters: { id: orderId },
      })
      if (orders?.[0]?.created_at) {
        completedAt = new Date(orders[0].created_at)
      }
    } catch {
      // best-effort; keep `now`
    }

    if (dryRun) {
      logger.info(
        `[backfill] would set completed_at=${completedAt.toISOString()} on ${cart.id} (order ${orderId})`
      )
      fixed++
      continue
    }

    try {
      await cartService.updateCarts(cart.id, { completed_at: completedAt })
      logger.info(
        `[backfill] set completed_at=${completedAt.toISOString()} on ${cart.id} (order ${orderId})`
      )
      fixed++
    } catch (e: any) {
      errors++
      logger.error(
        `[backfill] failed on ${cart.id}: ${e?.message ?? e}`
      )
    }
  }

  logger.info(
    `[backfill-converted-cart-completed-at] done — ${fixed} ${dryRun ? "would be " : ""}fixed, ${errors} error(s)`
  )
}
