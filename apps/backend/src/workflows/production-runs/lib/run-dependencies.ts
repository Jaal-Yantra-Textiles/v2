import { PRODUCTION_RUNS_MODULE } from "../../../modules/production_runs"
import type ProductionRunService from "../../../modules/production_runs/service"
import { ORDER_INVENTORY_MODULE } from "../../../modules/inventory_orders"
import type InventoryOrderService from "../../../modules/inventory_orders/service"

/**
 * What a production run is waiting on before it may be dispatched (#1529).
 *
 * A run has two kinds of upstream edge and they are NOT interchangeable:
 *
 *   depends_on_run_ids              another partner's production run
 *   depends_on_inventory_order_ids  goods being supplied to this partner
 *
 * Both are read here, in one place, because the two callers that need the
 * answer must not be allowed to disagree: the dispatch guard (which REFUSES a
 * run whose upstream is unmet) and the release subscribers (which DISPATCH a
 * run whose upstream just became met). If those two ever hold different
 * opinions the chain either stalls with everything apparently ready, or is
 * released and then bounced by the guard — both of which look like nothing
 * happened, from the outside.
 */

/** An inventory order is a met dependency only once the goods have ARRIVED. */
export const INVENTORY_DEPENDENCY_MET_STATUS = "Delivered"

/** A production run is a met dependency only once it is completed. */
export const RUN_DEPENDENCY_MET_STATUS = "completed"

export const cleanIds = (values: unknown): string[] =>
  (Array.isArray(values) ? values : []).filter(
    (v): v is string => typeof v === "string" && v.length > 0
  )

export type UnmetDependencies = {
  runs: string[]
  inventoryOrders: string[]
}

export const hasUnmet = (unmet: UnmetDependencies): boolean =>
  unmet.runs.length > 0 || unmet.inventoryOrders.length > 0

/**
 * Human-readable reason for a refusal, naming what is actually outstanding.
 * Kept out of the caller so the dispatch error and any future surface describe
 * a stalled chain the same way.
 */
export const describeUnmet = (unmet: UnmetDependencies): string => {
  const parts: string[] = []
  if (unmet.runs.length) {
    parts.push(`runs to complete (${unmet.runs.join(", ")})`)
  }
  if (unmet.inventoryOrders.length) {
    parts.push(
      `goods to be delivered (${unmet.inventoryOrders.join(", ")})`
    )
  }
  return parts.join(" and ")
}

/**
 * A dependency that cannot be READ is treated as UNMET, not as met.
 *
 * The alternative — a failed lookup falling through as satisfied — would
 * release a stage on the strength of a database hiccup, sending a partner work
 * whose materials may not exist. Refusing is recoverable: the release
 * subscribers re-evaluate on the next upstream transition, and an admin can
 * always dispatch by hand.
 */
export const resolveUnmetDependencies = async (
  container: any,
  run: {
    depends_on_run_ids?: unknown
    depends_on_inventory_order_ids?: unknown
  }
): Promise<UnmetDependencies> => {
  const runIds = cleanIds(run?.depends_on_run_ids)
  const inventoryOrderIds = cleanIds(run?.depends_on_inventory_order_ids)

  const unmet: UnmetDependencies = { runs: [], inventoryOrders: [] }

  if (runIds.length) {
    const productionRunService: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )
    const depRuns = await Promise.all(
      runIds.map((id) =>
        productionRunService
          .retrieveProductionRun(id)
          .catch(() => null)
      )
    )
    for (let i = 0; i < runIds.length; i++) {
      const dep = depRuns[i] as any
      if (!dep || String(dep.status) !== RUN_DEPENDENCY_MET_STATUS) {
        unmet.runs.push(runIds[i])
      }
    }
  }

  if (inventoryOrderIds.length) {
    const inventoryOrderService: InventoryOrderService = container.resolve(
      ORDER_INVENTORY_MODULE
    )
    const depOrders = await Promise.all(
      inventoryOrderIds.map((id) =>
        inventoryOrderService
          .retrieveInventoryOrder(id, { select: ["id", "status"] })
          .catch(() => null)
      )
    )
    for (let i = 0; i < inventoryOrderIds.length; i++) {
      const dep = depOrders[i] as any
      if (!dep || String(dep.status) !== INVENTORY_DEPENDENCY_MET_STATUS) {
        unmet.inventoryOrders.push(inventoryOrderIds[i])
      }
    }
  }

  return unmet
}
