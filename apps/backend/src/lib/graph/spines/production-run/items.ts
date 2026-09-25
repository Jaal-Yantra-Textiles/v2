import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import productionRunConsumptionLogsLink from "../../../../links/production-runs-consumption-logs"
import productionRunInventoryLink from "../../../../links/production-run-inventory-link"
import productionRunTasksLink from "../../../../links/production-runs-tasks"
import { asArray } from "../../builder"
import type { NodeItem, SpineContext } from "../../types"

/**
 * The members behind a production run's aggregate nodes (#2111 S2).
 *
 * 🔴 Nothing here offers a `remove`, and that is a decision rather than an
 * omission. Every edge on this spine is load-bearing in a way a bin icon must
 * not bypass: detaching an allocated material is the ADD-ONLY freeze's job and
 * is refused by design (removing, shrinking or relocating an allocation
 * retracts work a partner may already have done), a consumption log is the
 * record that stock was cut, and a task is what the partner was actually sent.
 * Each has a route of its own with its own guards.
 */

const taskItems = async (query: any, runId: string): Promise<NodeItem[]> => {
  const { data: links } = await query.graph({
    entity: productionRunTasksLink.entryPoint,
    filters: { production_runs_id: runId },
    fields: ["task_id"],
  })
  const ids = asArray<any>(links)
    .map((l) => l.task_id)
    .filter(Boolean)
  if (!ids.length) return []

  const { data: tasks } = await query.graph({
    entity: "task",
    filters: { id: ids },
    fields: ["id", "title", "status", "priority", "end_date"],
  })

  return asArray<any>(tasks).map((t) => ({
    id: String(t.id),
    label: String(t.title ?? t.id),
    sublabel: t.priority ? `${t.priority} priority` : null,
    status: t.status ? String(t.status) : null,
    href: null,
    props: [
      { key: "status", value: String(t.status ?? "—") },
      ...(t.end_date
        ? [{ key: "due", value: new Date(t.end_date).toISOString().slice(0, 10) }]
        : []),
    ],
    remove: null,
  }))
}

const materialItems = async (query: any, runId: string): Promise<NodeItem[]> => {
  const { data: links } = await query.graph({
    entity: productionRunInventoryLink.entryPoint,
    filters: { production_runs_id: runId },
    fields: [
      "inventory_item_id",
      "planned_quantity",
      "location_id",
      "inventory_item.title",
      "inventory_item.sku",
    ],
  })

  return asArray<any>(links)
    .filter((l) => l.inventory_item_id)
    .map((l) => ({
      id: String(l.inventory_item_id),
      label: String(l.inventory_item?.title ?? l.inventory_item_id),
      sublabel: l.inventory_item?.sku ? String(l.inventory_item.sku) : null,
      status: null,
      href: null,
      props: [
        /*
         * 🔴 `planned_quantity: null` means ISSUED, AMOUNT NOT AGREED — not
         * zero. Rendering it as 0 would state a figure nobody ever agreed to,
         * on the row a payout is argued from.
         */
        {
          key: "planned",
          value:
            l.planned_quantity === null || l.planned_quantity === undefined
              ? "not agreed"
              : String(l.planned_quantity),
        },
        ...(l.location_id ? [{ key: "drawn from", value: String(l.location_id) }] : []),
      ],
      remove: null,
    }))
}

const consumptionItems = async (query: any, runId: string): Promise<NodeItem[]> => {
  const { data: links } = await query.graph({
    entity: productionRunConsumptionLogsLink.entryPoint,
    filters: { production_runs_id: runId },
    fields: ["consumption_log_id"],
  })
  const ids = asArray<any>(links)
    .map((l) => l.consumption_log_id)
    .filter(Boolean)
  if (!ids.length) return []

  const { data: logs } = await query.graph({
    entity: "consumption_log",
    filters: { id: ids },
    fields: [
      "id",
      "quantity",
      "quantity_basis",
      "consumption_type",
      "consumed_by",
      "consumed_at",
      "is_committed",
    ],
  })

  return asArray<any>(logs).map((l) => ({
    id: String(l.id),
    label: `${l.quantity ?? "—"} ${l.consumption_type ?? "consumed"}`,
    sublabel: l.consumed_by ? `recorded by ${l.consumed_by}` : null,
    status: l.is_committed ? "committed" : "uncommitted",
    href: null,
    props: [
      { key: "quantity", value: String(l.quantity ?? "—") },
      /*
       * `per_piece` and `total` are not the same number. A log without its
       * basis cannot be added to another one, so the basis travels with it.
       */
      { key: "basis", value: String(l.quantity_basis ?? "—") },
      /*
       * Uncommitted means the stock has NOT been deducted yet — the log exists
       * and the cloth is still on the books.
       */
      { key: "committed", value: l.is_committed ? "yes" : "no" },
    ],
    remove: null,
  }))
}

const childRunItems = async (query: any, runId: string): Promise<NodeItem[]> => {
  const { data: runs } = await query.graph({
    entity: "production_runs",
    filters: { parent_run_id: runId },
    fields: ["id", "status", "role", "partner_id", "quantity", "produced_quantity"],
  })

  return asArray<any>(runs).map((r) => ({
    id: String(r.id),
    label: String(r.role ?? r.id),
    sublabel: r.partner_id ? String(r.partner_id) : "no partner",
    status: r.status ? String(r.status) : null,
    href: `/production-runs/${r.id}`,
    props: [
      { key: "ordered", value: String(r.quantity ?? "—") },
      /*
       * 🔴 `produced_quantity` is MIRRORED across a parent/child pair, so the
       * two numbers beside each other are not two garments. The pair is not
       * evidence of how many were made — that has to be asked.
       */
      { key: "produced", value: String(r.produced_quantity ?? "not stated") },
    ],
    remove: null,
  }))
}

const RESOLVERS: Record<string, (query: any, runId: string) => Promise<NodeItem[]>> = {
  tasks: taskItems,
  materials: materialItems,
  consumption: consumptionItems,
  child_runs: childRunItems,
}

export const PRODUCTION_RUN_ITEM_NODES = Object.keys(RESOLVERS)

export const resolveProductionRunItems = async (
  { scope, id }: SpineContext,
  nodeKey: string
): Promise<NodeItem[]> => {
  const resolver = RESOLVERS[nodeKey]
  if (!resolver) {
    return []
  }
  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as any
  return resolver(query, id)
}
