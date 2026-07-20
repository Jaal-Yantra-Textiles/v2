import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ExecArgs } from "@medusajs/framework/types"

/**
 * One-off: correct the country_code on a specific order's shipping/billing
 * addresses.
 *
 * Why a script (and not the API): Medusa's order-update flow guards the address
 * country — `POST /admin|partners/orders/:id` returns
 * `400 "Country code cannot be changed"` because an order address's country is
 * treated as locked to the order's region. We therefore write straight to the
 * `order_address` rows via the raw PG connection, bypassing that flow guard.
 *
 * Concrete case (#79, order_01KXWHFP132AM0H940WFD2P0XW): the customer is in
 * Jerusalem, Israel but checked out before an Israel region existed, so the
 * storefront fell back to `um` (US Minor Outlying Islands, a member of the
 * America/USD region). The order is captured in USD and not yet fulfilled — we
 * fix ONLY the address country so the shipping label is correct, and
 * deliberately leave the region/currency alone (moving a paid order to the
 * ILS Israel region would break payment reconciliation).
 *
 * The address country will then no longer be a member of the order's region.
 * That mismatch is cosmetic (admin shows Israel + America) and is exactly what
 * the API guard prevents — acceptable here for a manual correction.
 *
 * Idempotent: addresses already on the target country are skipped.
 *
 * Usage (prod ships transpiled JS — use the .js extension via ECS run-task,
 * see reference_prod_ecs_run_task_scripts):
 *   ORDER_ID=order_01KXWHFP132AM0H940WFD2P0XW TARGET_COUNTRY=il DRY_RUN=1 \
 *     npx medusa exec ./src/scripts/backfill-order-address-country.ts
 *   ORDER_ID=order_01KXWHFP132AM0H940WFD2P0XW TARGET_COUNTRY=il \
 *     npx medusa exec ./src/scripts/backfill-order-address-country.ts
 */
export default async function backfillOrderAddressCountry({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any

  const orderId = (process.env.ORDER_ID || "").trim()
  const target = (process.env.TARGET_COUNTRY || "").trim().toLowerCase()
  const dryRun = process.env.DRY_RUN === "1"

  if (!orderId || !target) {
    logger.error(
      "[backfill-order-address-country] ORDER_ID and TARGET_COUNTRY are required"
    )
    return
  }
  if (!/^[a-z]{2}$/.test(target)) {
    logger.error(
      `[backfill-order-address-country] TARGET_COUNTRY must be a 2-letter ISO code, got '${target}'`
    )
    return
  }

  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "region_id",
      "currency_code",
      "shipping_address.id",
      "shipping_address.country_code",
      "shipping_address.city",
      "billing_address.id",
      "billing_address.country_code",
    ],
    filters: { id: orderId },
  })

  const order = orders?.[0] as any
  if (!order) {
    logger.error(`[backfill-order-address-country] order ${orderId} not found`)
    return
  }

  const targets = [
    { label: "shipping", addr: order.shipping_address },
    { label: "billing", addr: order.billing_address },
  ].filter((t) => t.addr?.id)

  logger.info(
    `[backfill-order-address-country] order #${order.display_id} (${order.id}) region=${order.region_id} ${order.currency_code} — ${targets.length} address(es), target='${target}'${dryRun ? " (dry run)" : ""}`
  )

  let changed = 0
  for (const { label, addr } of targets) {
    const current = (addr.country_code || "").toLowerCase()
    if (current === target) {
      logger.info(
        `[backfill] ${label} (${addr.id}) already '${target}' — skip`
      )
      continue
    }
    if (dryRun) {
      logger.info(
        `[backfill] would set ${label} (${addr.id}) country_code '${current}' -> '${target}'`
      )
      changed++
      continue
    }
    const res = await pg.raw(
      `UPDATE "order_address" SET "country_code" = ?, "updated_at" = now() WHERE "id" = ?`,
      [target, addr.id]
    )
    const rows = res?.rowCount ?? res?.rows?.length ?? 0
    logger.info(
      `[backfill] ${label} (${addr.id}) country_code '${current}' -> '${target}' (${rows} row)`
    )
    changed++
  }

  logger.info(
    `[backfill-order-address-country] done — ${changed} address(es) ${dryRun ? "would be " : ""}updated`
  )
}
