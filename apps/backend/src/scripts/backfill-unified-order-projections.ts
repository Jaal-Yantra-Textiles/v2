import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { backfillInventoryOrderProjectionWorkflow } from "../workflows/inventory_orders/backfill-project-inventory-order"

/**
 * #445 / #342 T4 — PROJECTION backfill for legacy-only inventory orders.
 *
 * The link-only backfill (`backfill-unified-order-links.ts`) intentionally left
 * pre-T2 rows that were never dual-written as legacy-only — the prod run on
 * 2026-06-14 reported `noBackref=90`. Those orders (e.g. partner GOF's) don't
 * appear under the unified `/orders` surface because they have no core `order`.
 * This script mints the missing projection for each, reusing the create-path
 * dual-write so semantics match exactly, and re-applies the partner D3 link +
 * current status for assigned orders so partners see them in `/orders`.
 *
 * Candidate = inventory order with NO order↔inventory_order link AND NO
 * `metadata.unified_order_id` backref. Anything already projected is skipped, so
 * the script is safe to re-run (projected rows gain the link and drop out).
 *
 * DRY RUN BY DEFAULT. It only writes when you pass `apply`. medusa exec forwards
 * positional args (not `--flags`); all of these also accept a `--` prefix:
 *   npx medusa exec ./src/scripts/backfill-unified-order-projections.ts
 *   npx medusa exec ./src/scripts/backfill-unified-order-projections.ts apply
 *   npx medusa exec ./src/scripts/backfill-unified-order-projections.ts apply assigned-only
 *   npx medusa exec ./src/scripts/backfill-unified-order-projections.ts apply partner=part_123
 *   npx medusa exec ./src/scripts/backfill-unified-order-projections.ts apply order=inv_order_123
 */

const PAGE = 200

export default async function backfillUnifiedOrderProjections({
  container,
  args,
}: ExecArgs) {
  const a: any = args ?? []
  const tokens: string[] = (Array.isArray(a) ? a : Object.keys(a)).map(String)
  const norm = tokens.map((t) => t.replace(/^--/, ""))
  const has = (flag: string) => norm.some((t) => t === flag)
  const valueOf = (key: string): string | undefined => {
    const hit = norm.find((t) => t.startsWith(`${key}=`))
    return hit ? hit.slice(key.length + 1) : undefined
  }

  const apply = has("apply")
  const assignedOnly = has("assigned-only")
  const onlyPartnerId = valueOf("partner")
  const onlyOrderId = valueOf("order")

  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)

  logger.info(
    `[backfill-projections] starting${apply ? " (APPLY — will create unified orders)" : " (DRY RUN — no writes)"}` +
      `${assignedOnly ? " assigned-only" : ""}` +
      `${onlyPartnerId ? ` partner=${onlyPartnerId}` : ""}` +
      `${onlyOrderId ? ` order=${onlyOrderId}` : ""}`
  )

  let scanned = 0
  let alreadyProjected = 0
  let candidates = 0
  let candidatesAssigned = 0
  let candidatesUnassigned = 0
  let projected = 0
  let projectedAssigned = 0
  let skippedScope = 0
  let failed = 0

  let skip = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data: rows } = await query.graph({
      entity: "inventory_orders",
      fields: ["id", "status", "order.id", "metadata", "partner.id"],
      pagination: { take: PAGE, skip },
      ...(onlyOrderId ? { filters: { id: onlyOrderId } } : {}),
    })
    if (!rows?.length) break

    for (const row of rows as any[]) {
      scanned++

      // Already on the unified surface (link or transitional backref) → skip.
      if (row?.order?.id || row?.metadata?.unified_order_id) {
        alreadyProjected++
        continue
      }

      const partnerId = Array.isArray(row.partner)
        ? row.partner?.[0]?.id ?? null
        : row.partner?.id ?? null
      const isAssigned = Boolean(partnerId)

      candidates++
      if (isAssigned) candidatesAssigned++
      else candidatesUnassigned++

      // Scope filters
      if (assignedOnly && !isAssigned) {
        skippedScope++
        continue
      }
      if (onlyPartnerId && partnerId !== onlyPartnerId) {
        skippedScope++
        continue
      }

      if (!apply) {
        logger.info(
          `[backfill-projections] DRY would project ${row.id} (status=${row.status}, ${isAssigned ? `partner=${partnerId}` : "unassigned"})`
        )
        continue
      }

      try {
        const { result } = await backfillInventoryOrderProjectionWorkflow(
          container
        ).run({ input: { inventoryOrderId: row.id } })

        if (result?.unified_order_id) {
          projected++
          if (isAssigned) projectedAssigned++
          logger.info(
            `[backfill-projections] projected ${row.id} → order ${result.unified_order_id}` +
              `${isAssigned ? ` (partner ${partnerId})` : ""}`
          )
        } else {
          failed++
          logger.error(
            `[backfill-projections] ${row.id}: projection returned no order (${result?.skipped ?? result?.error ?? "unknown"})`
          )
        }
      } catch (e: any) {
        failed++
        logger.error(
          `[backfill-projections] ${row.id} failed: ${e?.message ?? e}`
        )
      }
    }

    if (onlyOrderId) break
    skip += PAGE
  }

  logger.info(
    `[backfill-projections] DONE${apply ? "" : " (DRY RUN)"} — ` +
      `scanned=${scanned} alreadyProjected=${alreadyProjected} ` +
      `candidates=${candidates} (assigned=${candidatesAssigned} unassigned=${candidatesUnassigned}) ` +
      `skippedScope=${skippedScope} projected=${projected} projectedAssigned=${projectedAssigned} failed=${failed}`
  )
}
