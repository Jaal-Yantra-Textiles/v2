/**
 * #891 — the "Ship to next location" task template.
 *
 * Production runs already dispatch their checklist from task templates looked up
 * BY NAME (`send-production-run-to-production` → `listTaskTemplates({ name })`),
 * so adding this template makes the goods-movement step something an operator
 * can attach to a run the same way as every other step — no new dispatch
 * mechanism, and the hop shows up in the partner's normal task list rather than
 * as a button they have to know about.
 *
 * `metadata.action` is what makes the task more than a checklist line: the
 * partner UI reads it to render the transfer form (and POST
 * `/partners/production-runs/:id/transfers`) instead of a plain "mark done"
 * checkbox. Keeping the binding in metadata rather than a column means a task
 * template stays a template — the tasks module knows nothing about shipping.
 *
 * Exported as a plain definition so the CLI seed and the Data Plumbing console
 * job share one source of truth (the same pattern the visual-flow seeds use).
 */

export const GOODS_TRANSFER_TASK_TEMPLATE_NAME = "ship-to-next-location"

export const TEMPLATE_DEF = {
  name: GOODS_TRANSFER_TASK_TEMPLATE_NAME,
  description:
    "Move this run's finished output to its next location — a finishing or QC partner, a packaging warehouse, or into stock. Book a carrier (Shiprocket or Delhivery) or record a self-driven hop.",
  priority: "medium" as const,
  // Realistically a packing + handover step, not the transit time.
  estimated_duration: 30,
  eventable: true,
  notifiable: true,
  required_fields: [
    {
      name: "to_location_id",
      type: "stock_location",
      required: true,
      label: "Destination location",
    },
    {
      name: "reason",
      type: "enum",
      required: false,
      label: "Reason",
      options: ["finishing", "qc", "packaging", "stock", "customer", "other"],
    },
    {
      name: "carrier",
      type: "enum",
      required: false,
      label: "Carrier",
      options: ["shiprocket", "delhivery"],
      // Blank is meaningful: a van run between our own locations is a real
      // movement that should still be recorded.
      help: "Leave empty to record the hop without booking a carrier.",
    },
    { name: "quantity", type: "number", required: false, label: "Units" },
    { name: "weight_grams", type: "number", required: false, label: "Weight (g)" },
  ],
  metadata: {
    /**
     * The binding the partner UI dispatches on. A task carrying this action
     * renders the transfer form; everything else renders as a normal task.
     */
    action: "create_goods_transfer",
    entity: "production_run",
    endpoint: "/partners/production-runs/:id/transfers",
    issue: "891",
  },
}
