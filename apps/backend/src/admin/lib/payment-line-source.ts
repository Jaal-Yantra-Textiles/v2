/**
 * How one payout line describes itself.
 *
 * PURE, and shared so a screen cannot invent its own vocabulary. The submission
 * page previously hardcoded "Design" for every line and filtered on two of the
 * four source types, which made run- and inventory-order-sourced payouts render
 * nowhere while a stat tile counted them as designs.
 */

export type PaymentLineLike = {
  source_type?: string | null
  design_id?: string | null
  design_name?: string | null
  task_id?: string | null
  task_name?: string | null
  inventory_order_id?: string | null
  inventory_order_name?: string | null
  order_id?: string | null
  production_run_ids?: string[] | null
}

export type PaymentLineSource = {
  /** `design` | `task` | `run` | `inventory_order` | `unknown` */
  kind: string
  /** Human label for the source column — "Design", "Inventory order", … */
  label: string
  /** What this line is for, in words. Never an id. */
  title: string
  /** The id worth showing next to the title, if any. */
  reference: string | null
}

/**
 * A line's kind, falling back to its ids.
 *
 * ⚠️ A missing `source_type` is NOT "design". Rows written before #1614 have
 * no source_type at all, and only their ids can say what they are — the old
 * code's `!i.source_type && i.design_id` was right about that and it is kept.
 */
export const paymentLineKind = (line: PaymentLineLike): string => {
  if (line.source_type) return String(line.source_type)
  if (line.inventory_order_id) return "inventory_order"
  if (line.production_run_ids?.length) return "run"
  if (line.task_id) return "task"
  if (line.design_id) return "design"
  return "unknown"
}

export const describePaymentLine = (
  line: PaymentLineLike
): PaymentLineSource => {
  const kind = paymentLineKind(line)

  switch (kind) {
    case "design":
      return {
        kind,
        label: "Design",
        title: line.design_name || "Untitled design",
        reference: line.design_id || null,
      }

    case "task":
      return {
        kind,
        label: "Task",
        title: line.task_name || "Untitled task",
        reference: line.task_id || null,
      }

    case "inventory_order":
      return {
        kind,
        label: "Inventory order",
        title: line.inventory_order_name || "Inventory order",
        reference: line.inventory_order_id || null,
      }

    case "run": {
      const runCount = line.production_run_ids?.length || 0

      return {
        kind,
        label: "Production runs",
        // The grouping is the point: order #79's seven runs are ONE payout,
        // so the line says how many runs it covers rather than naming one.
        title:
          line.design_name ||
          (runCount ? `${runCount} production run${runCount === 1 ? "" : "s"}` : "Production run"),
        reference: line.order_id || line.production_run_ids?.[0] || null,
      }
    }

    default:
      return {
        kind: "unknown",
        label: "Unattributed",
        title: "Unattributed line",
        reference: null,
      }
  }
}
