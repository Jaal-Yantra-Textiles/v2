import { Text } from "@medusajs/ui"
import { Link } from "react-router-dom"

import type { ResolvedRef } from "../../hooks/api/payment-submissions"

/**
 * The things a payout line paid for, as links (#1622).
 *
 * 🔴 Every payout screen rendered ULIDs. A run-sourced line said "7 run(s)" and
 * gave no way to reach one of them; a design line showed a 26-character id in a
 * monospace column. The ids were all correct and none of them was usable — you
 * could not stand on a payout and get to the work it paid for.
 *
 * Names come from the route (`resolvePaymentEntities`); an id that could not be
 * resolved still renders, as the id, because a payout must display even when
 * the thing it paid for has been deleted.
 */

/** Where each kind of thing lives in the admin. */
const HREF = {
  design: (id: string) => `/designs/${id}`,
  run: (id: string) => `/production-runs/${id}`,
  order: (id: string) => `/orders/${id}`,
  inventory_order: (id: string) => `/orders/inventory/${id}`,
  partner: (id: string) => `/partners/${id}`,
} as const

export type RefKind = keyof typeof HREF

export const RefLink = ({
  kind,
  refOrId,
  className,
}: {
  kind: RefKind
  refOrId: ResolvedRef | string | null | undefined
  className?: string
}) => {
  if (!refOrId) return null

  const ref: ResolvedRef =
    typeof refOrId === "string" ? { id: refOrId, name: refOrId } : refOrId

  return (
    <Link
      to={HREF[kind](ref.id)}
      className={className || "text-ui-fg-interactive hover:underline"}
      title={ref.detail ? `${ref.id} — ${ref.detail}` : ref.id}
    >
      {ref.name}
    </Link>
  )
}

/**
 * Every source a single line names — a run-sourced line born from a retail
 * order names BOTH, and showing only one of them loses half the provenance.
 *
 * `maxRuns` caps the run list rather than the whole cell: seven runs is a
 * normal grouped payout and all seven are worth reaching, but a hundred is a
 * wall. What is hidden is counted out loud — a silent truncation reads as
 * "that's all of them".
 */
export const PaymentLineLinks = ({
  item,
  maxRuns = 8,
}: {
  item: {
    design?: ResolvedRef | null
    design_id?: string | null
    order?: ResolvedRef | null
    order_id?: string | null
    inventory_order?: ResolvedRef | null
    inventory_order_id?: string | null
    runs?: ResolvedRef[] | null
    production_run_ids?: string[] | null
    task_id?: string | null
    task_name?: string | null
  }
  maxRuns?: number
}) => {
  const runs: ResolvedRef[] =
    item.runs && item.runs.length
      ? item.runs
      : (item.production_run_ids || []).map((id) => ({ id, name: id }))

  const shownRuns = runs.slice(0, maxRuns)
  const hiddenRuns = runs.length - shownRuns.length

  const design = item.design || item.design_id || null
  const order = item.order || item.order_id || null
  const inventoryOrder = item.inventory_order || item.inventory_order_id || null

  const nothing =
    !design && !order && !inventoryOrder && !runs.length && !item.task_id

  if (nothing) {
    return (
      <Text size="small" className="text-ui-fg-muted">
        —
      </Text>
    )
  }

  const linkClass = "text-ui-fg-interactive text-xs hover:underline"

  return (
    <div className="flex flex-col gap-y-1">
      {design && (
        <div className="flex items-center gap-x-1">
          <Text size="xsmall" className="text-ui-fg-muted">
            Design
          </Text>
          <RefLink kind="design" refOrId={design} className={linkClass} />
        </div>
      )}
      {inventoryOrder && (
        <div className="flex items-center gap-x-1">
          <Text size="xsmall" className="text-ui-fg-muted">
            Inventory order
          </Text>
          <RefLink
            kind="inventory_order"
            refOrId={inventoryOrder}
            className={linkClass}
          />
        </div>
      )}
      {order && (
        <div className="flex items-center gap-x-1">
          <Text size="xsmall" className="text-ui-fg-muted">
            Order
          </Text>
          <RefLink kind="order" refOrId={order} className={linkClass} />
        </div>
      )}
      {item.task_id && (
        <div className="flex items-center gap-x-1">
          <Text size="xsmall" className="text-ui-fg-muted">
            Task
          </Text>
          <Text size="xsmall">{item.task_name || item.task_id}</Text>
        </div>
      )}
      {shownRuns.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Text size="xsmall" className="text-ui-fg-muted">
            Runs
          </Text>
          {shownRuns.map((run) => (
            <RefLink key={run.id} kind="run" refOrId={run} className={linkClass} />
          ))}
          {hiddenRuns > 0 && (
            <Text size="xsmall" className="text-ui-fg-muted">
              +{hiddenRuns} more
            </Text>
          )}
        </div>
      )}
    </div>
  )
}
