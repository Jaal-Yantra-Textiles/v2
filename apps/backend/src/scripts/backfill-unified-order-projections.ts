import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { backfillInventoryOrderProjectionWorkflow } from "../workflows/inventory_orders/backfill-project-inventory-order"
import { projectRunToUnifiedOrder } from "../workflows/production-runs/dual-write-unified-run-order"

/**
 * #445 / #342 T4 — PROJECTION backfill for legacy-only work-orders (BOTH kinds:
 * inventory orders AND design orders / production runs).
 *
 * The link-only backfill (`backfill-unified-order-links.ts`) intentionally left
 * pre-T2 rows that were never dual-written as legacy-only — the prod run on
 * 2026-06-14 reported a COMBINED `noBackref=90` across inventory_orders +
 * production_runs. Those rows (e.g. partner GOF's inventory order, and any
 * pre-T3.2 design run) don't appear under the unified `/orders` surface because
 * they have no core `order`. This script mints the missing projection for each,
 * reusing each kind's create-path projector so semantics match exactly:
 *   - inventory_orders → backfillInventoryOrderProjectionWorkflow
 *     (gather legacy row + lines/locations/partner → dualWrite → partner mirror
 *      → status mirror)
 *   - production_runs  → projectRunToUnifiedOrder (self-contained + idempotent:
 *     order + order↔run link + design link + partner/sub_partner links +
 *     status sidecar, derived from the run's current status/lifecycle)
 *
 * Candidate = row with NO order↔execution link AND NO `metadata.unified_order_id`
 * backref. Already-projected rows are skipped, so the script is safe to re-run.
 *
 * DRY RUN BY DEFAULT. It only writes when you pass `apply`. medusa exec forwards
 * positional args (not `--flags`); all of these also accept a `--` prefix:
 *   npx medusa exec ./src/scripts/backfill-unified-order-projections.ts
 *   npx medusa exec ./src/scripts/backfill-unified-order-projections.ts apply
 *   npx medusa exec ./src/scripts/backfill-unified-order-projections.ts apply assigned-only
 *   npx medusa exec ./src/scripts/backfill-unified-order-projections.ts apply entity=inventory
 *   npx medusa exec ./src/scripts/backfill-unified-order-projections.ts apply entity=design
 *   npx medusa exec ./src/scripts/backfill-unified-order-projections.ts apply partner=part_123
 *   npx medusa exec ./src/scripts/backfill-unified-order-projections.ts apply order=inv_order_123
 */

const PAGE = 200

type ProjectResult = {
  unified_order_id: string | null
  skipped?: string
  error?: string
}

type Target = {
  key: "inventory" | "design"
  entity: "inventory_orders" | "production_runs"
  label: string
  // fields used to detect already-projected + assignment
  fields: string[]
  // pull the assigned partner id from a candidate row (link vs column)
  partnerIdOf: (row: any) => string | null
  // run the kind-specific create-path projection
  project: (container: any, id: string) => Promise<ProjectResult>
}

const TARGETS: Target[] = [
  {
    key: "inventory",
    entity: "inventory_orders",
    label: "inventory order",
    fields: ["id", "status", "order.id", "metadata", "partner.id"],
    partnerIdOf: (row) =>
      Array.isArray(row.partner)
        ? row.partner?.[0]?.id ?? null
        : row.partner?.id ?? null,
    project: async (container, id) => {
      const { result } = await backfillInventoryOrderProjectionWorkflow(
        container
      ).run({ input: { inventoryOrderId: id } })
      return result as ProjectResult
    },
  },
  {
    key: "design",
    entity: "production_runs",
    label: "design run",
    // `order.id` = the order↔production_run link (unified pointer); `order_id`
    // is the legacy retail column and must NOT be used for the projected check.
    fields: ["id", "status", "order.id", "metadata", "partner_id"],
    partnerIdOf: (row) => row.partner_id ?? null,
    project: (container, id) => projectRunToUnifiedOrder(container, id),
  },
]

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
  const entityFilter = valueOf("entity") // inventory | design | (unset = both)

  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)

  logger.info(
    `[backfill-projections] starting${apply ? " (APPLY — will create unified orders)" : " (DRY RUN — no writes)"}` +
      `${entityFilter ? ` entity=${entityFilter}` : " entity=both"}` +
      `${assignedOnly ? " assigned-only" : ""}` +
      `${onlyPartnerId ? ` partner=${onlyPartnerId}` : ""}` +
      `${onlyOrderId ? ` order=${onlyOrderId}` : ""}`
  )

  const makeCounts = () => ({
    scanned: 0,
    alreadyProjected: 0,
    candidates: 0,
    candidatesAssigned: 0,
    candidatesUnassigned: 0,
    skippedScope: 0,
    projected: 0,
    projectedAssigned: 0,
    failed: 0,
  })
  const grand = makeCounts()

  for (const target of TARGETS) {
    if (entityFilter && entityFilter !== target.key) continue

    const t = makeCounts()

    let skip = 0
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data: rows } = await query.graph({
        entity: target.entity,
        fields: target.fields,
        pagination: { take: PAGE, skip },
        ...(onlyOrderId ? { filters: { id: onlyOrderId } } : {}),
      })
      if (!rows?.length) break

      for (const row of rows as any[]) {
        t.scanned++

        if (row?.order?.id || row?.metadata?.unified_order_id) {
          t.alreadyProjected++
          continue
        }

        const partnerId = target.partnerIdOf(row)
        const isAssigned = Boolean(partnerId)

        t.candidates++
        if (isAssigned) t.candidatesAssigned++
        else t.candidatesUnassigned++

        if (assignedOnly && !isAssigned) {
          t.skippedScope++
          continue
        }
        if (onlyPartnerId && partnerId !== onlyPartnerId) {
          t.skippedScope++
          continue
        }

        if (!apply) {
          logger.info(
            `[backfill-projections] DRY would project ${target.label} ${row.id} (status=${row.status}, ${isAssigned ? `partner=${partnerId}` : "unassigned"})`
          )
          continue
        }

        try {
          const result = await target.project(container, row.id)
          if (result?.unified_order_id) {
            t.projected++
            if (isAssigned) t.projectedAssigned++
            logger.info(
              `[backfill-projections] projected ${target.label} ${row.id} → order ${result.unified_order_id}${isAssigned ? ` (partner ${partnerId})` : ""}`
            )
          } else {
            t.failed++
            logger.error(
              `[backfill-projections] ${target.label} ${row.id}: no order (${result?.skipped ?? result?.error ?? "unknown"})`
            )
          }
        } catch (e: any) {
          t.failed++
          logger.error(
            `[backfill-projections] ${target.label} ${row.id} failed: ${e?.message ?? e}`
          )
        }
      }

      if (onlyOrderId) break
      skip += PAGE
    }

    logger.info(
      `[backfill-projections] ${target.entity}: scanned=${t.scanned} alreadyProjected=${t.alreadyProjected} ` +
        `candidates=${t.candidates} (assigned=${t.candidatesAssigned} unassigned=${t.candidatesUnassigned}) ` +
        `skippedScope=${t.skippedScope} projected=${t.projected} projectedAssigned=${t.projectedAssigned} failed=${t.failed}`
    )
    for (const k of Object.keys(grand) as (keyof typeof grand)[]) grand[k] += t[k]
  }

  logger.info(
    `[backfill-projections] DONE${apply ? "" : " (DRY RUN)"} — ` +
      `scanned=${grand.scanned} alreadyProjected=${grand.alreadyProjected} ` +
      `candidates=${grand.candidates} (assigned=${grand.candidatesAssigned} unassigned=${grand.candidatesUnassigned}) ` +
      `skippedScope=${grand.skippedScope} projected=${grand.projected} projectedAssigned=${grand.projectedAssigned} failed=${grand.failed}`
  )
}
