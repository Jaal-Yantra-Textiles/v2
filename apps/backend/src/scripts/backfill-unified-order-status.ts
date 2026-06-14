import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { setUnifiedOrderPartnerStatus } from "../workflows/inventory_orders/dual-write-unified-order"

/**
 * #342 Chunk 9b (PR-F / T4) — backfill the `unified_order_status` sidecar column
 * from the existing `order.metadata.partner_status` on every unified order.
 *
 * Background: PR-F promotes `partner_status` off the order's metadata blob onto a
 * typed 1:1 sidecar row (see src/modules/unified_order_status). New transitions
 * write BOTH surfaces, but historicals only carry the metadata copy. This script
 * upserts the sidecar row for each order whose metadata still holds a
 * `partner_status`, so PR-G can repoint the read sites onto the column.
 *
 * Safe to re-run: idempotent. Skips orders with no `metadata.partner_status` and
 * orders whose sidecar row already matches; only writes when the column is
 * absent or stale.
 *
 * Pass `dry-run` positionally (medusa exec does not forward `--flags`):
 *   npx medusa exec ./src/scripts/backfill-unified-order-status.ts dry-run
 *   npx medusa exec ./src/scripts/backfill-unified-order-status.ts
 */

const PAGE = 200

export default async function backfillUnifiedOrderStatus({ container, args }: ExecArgs) {
  // `medusa exec <file> <args..>` forwards positional args as a string[] (it does
  // NOT forward `--flags`). Accept both `dry-run` and `--dry-run`.
  const a: any = args ?? []
  const tokens: string[] = (Array.isArray(a) ? a : Object.keys(a)).map(String)
  const dryRun = tokens.some((t) => t.replace(/^--/, "") === "dry-run")

  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)

  logger.info(
    `[backfill-unified-order-status] starting${dryRun ? " (DRY RUN — no writes)" : ""}`
  )

  let skip = 0
  let upserted = 0
  let alreadySet = 0
  let noStatus = 0
  let errors = 0

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data: rows } = await query.graph({
      entity: "order",
      fields: ["id", "metadata", "unified_order_status.partner_status"],
      pagination: { take: PAGE, skip },
    })

    if (!rows?.length) break

    for (const row of rows as any[]) {
      const metaStatus = row?.metadata?.partner_status
      if (!metaStatus) {
        // Retail orders + work-orders not yet partner-tracked carry no status.
        noStatus++
        continue
      }
      if (row?.unified_order_status?.partner_status === metaStatus) {
        // Already promoted (new write path, or a prior run of this script).
        alreadySet++
        continue
      }
      if (dryRun) {
        upserted++
        logger.info(
          `[backfill-unified-order-status] DRY would set order ${row.id} → ${metaStatus}`
        )
        continue
      }
      try {
        await setUnifiedOrderPartnerStatus(container, row.id, String(metaStatus))
        upserted++
      } catch (e: any) {
        errors++
        logger.error(
          `[backfill-unified-order-status] order ${row.id} → ${metaStatus} failed: ${e?.message ?? e}`
        )
      }
    }

    skip += PAGE
  }

  logger.info(
    `[backfill-unified-order-status] DONE${dryRun ? " (DRY RUN)" : ""} — upserted=${upserted} alreadySet=${alreadySet} noStatus=${noStatus} errors=${errors}`
  )
}
