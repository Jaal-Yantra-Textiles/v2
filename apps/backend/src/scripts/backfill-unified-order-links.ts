import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ORDER_INVENTORY_MODULE } from "../modules/inventory_orders"
import { PRODUCTION_RUNS_MODULE } from "../modules/production_runs"

/**
 * #342 PR-E (Chunk 9 / T4) — backfill the D5 order↔execution link onto
 * historicals so the transitional `metadata.unified_order_id` fallback reads can
 * be retired.
 *
 * Background: rows projected BEFORE PR-A made the link authoritative carry the
 * unified order pointer only as the `metadata.unified_order_id` backref (Chunk 6
 * then stopped writing it). Until those rows also get the managed
 * order↔inventory_order / order↔production_run link, the four
 * `<link> ?? metadata.unified_order_id` fallback reads cannot be deleted. This
 * script creates exactly that link, link-only (it does NOT project rows that
 * were never dual-written — those stay legacy-only by design, see the doc's
 * "T4 plan" scope decision).
 *
 * Safe to re-run: idempotent on link existence (skips rows that already resolve
 * `order.id`) and on order existence (skips dangling backrefs whose unified
 * order no longer exists, reporting them).
 *
 * Pass `dry-run` positionally (medusa exec does not forward `--flags`):
 *   npx medusa exec ./src/scripts/backfill-unified-order-links.ts dry-run
 *   npx medusa exec ./src/scripts/backfill-unified-order-links.ts
 */

const PAGE = 200

type Target = {
  entity: "inventory_orders" | "production_runs"
  module: string
  // the link table's id field for the legacy side
  idField: "inventory_orders_id" | "production_runs_id"
}

const TARGETS: Target[] = [
  { entity: "inventory_orders", module: ORDER_INVENTORY_MODULE, idField: "inventory_orders_id" },
  { entity: "production_runs", module: PRODUCTION_RUNS_MODULE, idField: "production_runs_id" },
]

export default async function backfillUnifiedOrderLinks({ container, args }: ExecArgs) {
  // `medusa exec <file> <args..>` forwards positional args as a string[] (it does
  // NOT forward `--flags` — its own parser rejects unknown ones). Accept both
  // `dry-run` and `--dry-run`, and tolerate an object form defensively.
  const a: any = args ?? []
  const tokens: string[] = (Array.isArray(a) ? a : Object.keys(a)).map(String)
  const dryRun = tokens.some((t) => t.replace(/^--/, "") === "dry-run")

  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)
  const orderService: any = container.resolve(Modules.ORDER)
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)

  logger.info(
    `[backfill-unified-order-links] starting${dryRun ? " (DRY RUN — no links created)" : ""}`
  )

  let grandLinked = 0
  let grandSkippedLinked = 0
  let grandDangling = 0
  let grandNoBackref = 0
  let grandErrors = 0

  for (const target of TARGETS) {
    let skip = 0
    let linked = 0
    let alreadyLinked = 0
    let dangling = 0
    let noBackref = 0
    let errors = 0

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data: rows } = await query.graph({
        entity: target.entity,
        fields: ["id", "order.id", "metadata"],
        pagination: { take: PAGE, skip },
      })

      if (!rows?.length) break

      // Candidates: no managed link yet, but a metadata backref points somewhere.
      const candidates: { legacyId: string; unifiedOrderId: string }[] = []
      for (const row of rows as any[]) {
        if (row?.order?.id) {
          alreadyLinked++
          continue
        }
        const backref = row?.metadata?.unified_order_id
        if (!backref) {
          // Never projected (pre-T2) OR backref already cleaned — leave as-is.
          noBackref++
          continue
        }
        candidates.push({ legacyId: row.id, unifiedOrderId: String(backref) })
      }

      if (candidates.length) {
        // Validate the backref'd orders still exist before linking, so we never
        // create a dangling link to a deleted order.
        const uniqueOrderIds = [...new Set(candidates.map((c) => c.unifiedOrderId))]
        const { data: orders } = await query.graph({
          entity: "order",
          fields: ["id"],
          filters: { id: uniqueOrderIds },
        })
        const liveOrderIds = new Set((orders as any[]).map((o) => o.id))

        for (const c of candidates) {
          if (!liveOrderIds.has(c.unifiedOrderId)) {
            dangling++
            logger.warn(
              `[backfill-unified-order-links] ${target.entity} ${c.legacyId}: backref order ${c.unifiedOrderId} not found — skipping (manual review)`
            )
            continue
          }
          if (dryRun) {
            linked++
            logger.info(
              `[backfill-unified-order-links] DRY would link ${target.entity} ${c.legacyId} → order ${c.unifiedOrderId}`
            )
            continue
          }
          try {
            await remoteLink.create([
              {
                [Modules.ORDER]: { order_id: c.unifiedOrderId },
                [target.module]: { [target.idField]: c.legacyId },
              },
            ])
            linked++
          } catch (e: any) {
            // Most likely the link already exists (race / partial prior run) —
            // treat as idempotent, but count genuine failures.
            const msg = String(e?.message ?? e)
            if (/already exist|duplicate/i.test(msg)) {
              alreadyLinked++
            } else {
              errors++
              logger.error(
                `[backfill-unified-order-links] ${target.entity} ${c.legacyId} → order ${c.unifiedOrderId} failed: ${msg}`
              )
            }
          }
        }
      }

      skip += PAGE
    }

    logger.info(
      `[backfill-unified-order-links] ${target.entity}: linked=${linked} alreadyLinked=${alreadyLinked} danglingBackref=${dangling} noBackref=${noBackref} errors=${errors}`
    )
    grandLinked += linked
    grandSkippedLinked += alreadyLinked
    grandDangling += dangling
    grandNoBackref += noBackref
    grandErrors += errors
  }

  logger.info(
    `[backfill-unified-order-links] DONE${dryRun ? " (DRY RUN)" : ""} — linked=${grandLinked} alreadyLinked=${grandSkippedLinked} danglingBackref=${grandDangling} noBackref=${grandNoBackref} errors=${grandErrors}`
  )

  if (grandDangling > 0) {
    logger.warn(
      `[backfill-unified-order-links] ${grandDangling} row(s) have a backref to a missing order — review before retiring the fallback reads.`
    )
  }
}
