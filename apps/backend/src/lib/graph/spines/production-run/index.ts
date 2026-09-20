import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import orderProductionRunLink from "../../../../links/order-production-run"
import productionRunConsumptionLogsLink from "../../../../links/production-runs-consumption-logs"
import productionRunInventoryLink from "../../../../links/production-run-inventory-link"
import productionRunTasksLink from "../../../../links/production-runs-tasks"
import { GraphBuilder, asArray, resolveExisting } from "../../builder"
import type { Graph, GraphNode, SpineContext, SpineDescriptor } from "../../types"
import {
  completedWithoutOutput,
  completedWithoutProduct,
  isDependencyMet,
  isOpen,
  openWithoutPartner,
  partnerSilent,
} from "./absence"
import { PRODUCTION_RUN_ITEM_NODES, resolveProductionRunItems } from "./items"

/**
 * The PRODUCTION RUN spine (#2111 S2) — "why has this run not started, and who
 * is it for?"
 *
 * The design spine answers what we intend to make and the partner spine answers
 * who we work with. Neither answers the question a multi-partner network exists
 * to answer: *what is this partner waiting on, and where does the result go?*
 * That question spans five modules and, until this file, could only be answered
 * by opening four tools in order.
 *
 * 🔴 The two upstream edges are the point of the whole epic. A run sitting at
 * `approved` with `depends_on_inventory_order_ids` set is WAITING, not stuck —
 * and the distinction is invisible on every existing screen. Exactly **1 of 146
 * runs on prod** carries one today (the S1 proof run), which is why the node
 * names the orders individually rather than aggregating them: at this volume
 * the reader wants the order, not a count.
 *
 * 🔴 NO NODE ON THIS SPINE CARRIES AN `action`, and that is deliberate.
 *
 * A node's action renders as a button on the run page, and every verb this
 * spine could offer — reassign, assign a partner, approve the output, re-run
 * dispatch — is an admin operation the page itself owns and GATES. The parked
 * run proved it: that page withholds Reassign on purpose, and this card put an
 * inert button reading "Reassign the run" beside the place it was being
 * withheld. A reader cannot tell an inert suggestion from the real control, so
 * the card was quietly contradicting the page.
 *
 * `production-run-reassign.spec.ts` is what caught it — it asserts Reassign is
 * absent there, and Playwright matches an accessible name by SUBSTRING, so
 * "Reassign the run" answered to "Reassign". It was right to.
 *
 * So this spine states and does not offer: each edge's `reason` says what is
 * missing and what it costs, and every verb stays with the page that knows
 * whether it is allowed.
 *
 * 🔴 Every link is read through its `entryPoint`, never as a field hop off
 * `production_runs`. A hop from an entity to a linked field can come back with
 * NO KEY AT ALL rather than an error, and here that would claim a run consumed
 * nothing and has no tasks — indistinguishable from the real thing on a run
 * that genuinely has neither, which is most of them.
 */
const resolveProductionRunGraph = async ({
  scope,
  id,
}: SpineContext): Promise<Graph> => {
  const runId = id
  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as any

  const { data: runs } = await query.graph({
    entity: "production_runs",
    filters: { id: runId },
    fields: ["*"],
  })

  const run = (runs || [])[0]
  if (!run) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Production run ${runId} was not found`
    )
  }

  const dependsOnOrderIds = asArray<string>(
    run.depends_on_inventory_order_ids
  ).map(String)
  const dependsOnRunIds = asArray<string>(run.depends_on_run_ids).map(String)

  const [
    { data: children },
    { data: parents },
    { data: designs },
    { data: partners },
    { data: upstreamOrders },
    { data: upstreamRuns },
    { data: taskLinks },
    { data: logLinks },
    { data: materialLinks },
    { data: workOrderLinks },
  ] = await Promise.all([
    query.graph({
      entity: "production_runs",
      filters: { parent_run_id: runId },
      fields: ["id", "status", "role", "partner_id", "produced_quantity"],
    }),
    run.parent_run_id
      ? query.graph({
          entity: "production_runs",
          filters: { id: String(run.parent_run_id) },
          fields: ["id", "status", "role", "partner_id", "quantity"],
        })
      : Promise.resolve({ data: [] }),
    run.design_id
      ? query.graph({
          entity: "designs",
          filters: { id: String(run.design_id) },
          fields: ["id", "name", "status", "design_type"],
        })
      : Promise.resolve({ data: [] }),
    run.partner_id
      ? query.graph({
          entity: "partners",
          filters: { id: String(run.partner_id) },
          fields: ["id", "name", "handle", "status", "is_verified"],
        })
      : Promise.resolve({ data: [] }),
    dependsOnOrderIds.length
      ? query.graph({
          entity: "inventory_orders",
          filters: { id: dependsOnOrderIds },
          fields: ["id", "status", "quantity", "expected_delivery_date"],
        })
      : Promise.resolve({ data: [] }),
    dependsOnRunIds.length
      ? query.graph({
          entity: "production_runs",
          filters: { id: dependsOnRunIds },
          fields: ["id", "status", "partner_id"],
        })
      : Promise.resolve({ data: [] }),
    query.graph({
      entity: productionRunTasksLink.entryPoint,
      filters: { production_runs_id: runId },
      fields: ["task_id"],
    }),
    query.graph({
      entity: productionRunConsumptionLogsLink.entryPoint,
      filters: { production_runs_id: runId },
      fields: ["consumption_log_id"],
    }),
    query.graph({
      entity: productionRunInventoryLink.entryPoint,
      filters: { production_runs_id: runId },
      fields: ["inventory_item_id"],
    }),
    query.graph({
      entity: orderProductionRunLink.entryPoint,
      filters: { production_runs_id: runId },
      fields: ["order_id"],
    }),
  ])

  const childRuns = asArray<any>(children)
  const parentRun = asArray<any>(parents)[0]
  const design = asArray<any>(designs)[0]
  const partner = asArray<any>(partners)[0]
  const orderList = asArray<any>(upstreamOrders)
  const runList = asArray<any>(upstreamRuns)

  /*
   * 🔴 A LINK ROW IS NOT A RECORD. Counting link rows is how a partner's
   * `people` node once said "4 linked" against four person ids that do not
   * exist. Same treatment here for every aggregate.
   */
  const [taskIds, logIds, materialIds] = await Promise.all([
    resolveExisting(
      query,
      "task",
      asArray<any>(taskLinks).map((l) => String(l.task_id)).filter(Boolean)
    ),
    resolveExisting(
      query,
      "consumption_log",
      asArray<any>(logLinks)
        .map((l) => String(l.consumption_log_id))
        .filter(Boolean)
    ),
    resolveExisting(
      query,
      "inventory_item",
      asArray<any>(materialLinks)
        .map((l) => String(l.inventory_item_id))
        .filter(Boolean)
    ),
  ])
  const workOrderIds = asArray<any>(workOrderLinks)
    .map((l) => String(l.order_id))
    .filter(Boolean)

  const builder = new GraphBuilder("production_run")
  const push = builder.push.bind(builder)

  // ---- upstream: what this run is waiting on ------------------------------

  if (orderList.length) {
    const unmet = orderList.filter((o) => !isDependencyMet(o.status))
    push(
      {
        key: "depends_on_inventory_orders",
        type: "inventory_order",
        label: "Waiting on materials",
        sublabel: unmet.length
          ? `${unmet.length} of ${orderList.length} not delivered`
          : `${orderList.length} delivered`,
        state: unmet.length ? "derived" : "present",
        count: orderList.length,
        status: unmet.length ? "blocked" : "met",
        href: null,
        props: orderList.map((o) => ({
          key: String(o.id),
          value: String(o.status ?? "—"),
        })),
        action: null,
      },
      {
        label: "depends_on_inventory_order_ids",
        state: unmet.length ? "derived" : "present",
        /*
         * 🔴 The sentence names `Delivered` explicitly. The gate is met there
         * and NOT at `Shipped`, and a reader who assumes otherwise will chase
         * a partner who does not have the cloth yet.
         */
        reason: unmet.length
          ? `Dispatch is held until ${unmet.length === 1 ? "this order reaches" : "these orders reach"} Delivered — not Shipped. ${unmet
              .map((o) => `${o.id} is ${o.status}`)
              .join("; ")}.`
          : null,
      }
    )
  }

  if (runList.length) {
    const unmet = runList.filter((r) => String(r.status) !== "completed")
    push(
      {
        key: "depends_on_runs",
        type: "production_run",
        label: "Waiting on other work",
        sublabel: unmet.length
          ? `${unmet.length} of ${runList.length} not completed`
          : `${runList.length} completed`,
        state: unmet.length ? "derived" : "present",
        count: runList.length,
        status: unmet.length ? "blocked" : "met",
        href: null,
        props: runList.map((r) => ({
          key: String(r.id),
          value: String(r.status ?? "—"),
        })),
        action: null,
      },
      {
        label: "depends_on_run_ids",
        state: unmet.length ? "derived" : "present",
        /*
         * This edge is DERIVED at approval from the assignment `order` and is
         * settable by no route — so the reason says where it came from, or a
         * reader will look for a field to edit that does not exist.
         */
        reason: unmet.length
          ? `Another partner's work comes first. Set at approval from the assignment order, not editable directly. ${unmet
              .map((r) => `${r.id} is ${r.status}`)
              .join("; ")}.`
          : null,
      }
    )
  }

  // ---- who it is for ------------------------------------------------------

  if (run.order_line_item_id) {
    push(
      {
        key: "order_line",
        type: "order_line_item",
        label: "Commissioned by",
        sublabel: run.order_id ? String(run.order_id) : "an order line",
        state: "present",
        count: 1,
        status: null,
        href: run.order_id ? `/orders/${run.order_id}` : null,
        props: [
          { key: "line", value: String(run.order_line_item_id) },
          ...(run.order_id ? [{ key: "order", value: String(run.order_id) }] : []),
        ],
        action: null,
      },
      { label: "order_line_item_id", state: "present", reason: null }
    )
  } else {
    /*
     * 🔴 124 of 146 runs on prod are here, and the edge is stated rather than
     * blamed. A design-led stock run legitimately has no commissioning line and
     * nothing on the row tells the two apart — but the CONSEQUENCE is the same
     * either way and is worth saying out loud every time.
     */
    push(
      {
        key: "order_line",
        type: "order_line_item",
        label: "Commissioned by",
        sublabel: "nobody",
        state: "absent",
        count: 0,
        status: null,
        href: null,
        props: [],
        action: null,
      },
      {
        label: "order_line_item_id",
        state: "absent",
        reason:
          "A run is a customer's only through `order_line_item_id`. With none, fulfillment cannot match this run to what was sold and mints a duplicate run of its own — born completed, with no activity trail. Correct for stock production; expensive for anything commissioned.",
      }
    )
  }

  if (workOrderIds.length) {
    push(
      {
        key: "work_order",
        type: "order",
        label: "Collated under",
        sublabel: `${workOrderIds.length} design work-order${workOrderIds.length === 1 ? "" : "s"}`,
        state: "present",
        count: workOrderIds.length,
        status: null,
        href: `/orders/${workOrderIds[0]}`,
        props: workOrderIds.map((oid) => ({ key: "order", value: oid })),
        action: null,
      },
      { label: "order ↔ production_run", state: "present", reason: null }
    )
  }

  // ---- who does it --------------------------------------------------------

  if (partner) {
    const silent = partnerSilent(run)
    push(
      {
        key: "partner",
        type: "partner",
        label: String(partner.name ?? partner.id),
        sublabel: silent
          ? `chased ${run.reminder_count ?? 0}×, no answer`
          : String(partner.handle ?? partner.status ?? ""),
        state: silent ? "derived" : "present",
        count: 1,
        status: silent ? "escalated" : String(partner.status ?? ""),
        href: `/partners/${partner.id}`,
        props: [
          { key: "status", value: String(partner.status ?? "—") },
          { key: "verified", value: partner.is_verified ? "yes" : "no" },
          ...(run.execution_mode
            ? [{ key: "mode", value: String(run.execution_mode) }]
            : []),
        ],
        action: null,
      },
      {
        label: "partner_id",
        state: silent ? "derived" : "present",
        reason: silent
          ? "The partner is assigned and has not answered. Reminders reached escalation and the run has not moved since — assigned is not the same as accepted."
          : null,
      }
    )
  } else if (openWithoutPartner(run, childRuns.length > 0)) {
    push(
      {
        key: "partner",
        type: "partner",
        label: "Partner",
        sublabel: "nobody assigned",
        state: "absent",
        count: 0,
        status: null,
        href: null,
        props: [{ key: "status", value: String(run.status ?? "—") }],
        action: null,
      },
      {
        label: "partner_id",
        state: "absent",
        reason:
          "This run is live and has nobody to do it, and no child run carries a partner either. Note that `assign-partner` alone tells them nothing — `send-to-partner` is what commissions the work.",
      }
    )
  }

  // ---- what it makes ------------------------------------------------------

  if (design) {
    push(
      {
        key: "design",
        type: "design",
        label: String(design.name ?? design.id),
        sublabel: String(design.design_type ?? ""),
        state: "present",
        count: 1,
        status: String(design.status ?? ""),
        href: `/designs/${design.id}`,
        props: [{ key: "status", value: String(design.status ?? "—") }],
        action: null,
      },
      { label: "design_id", state: "present", reason: null }
    )
  }

  if (run.approved_product_id || run.product_id) {
    const productId = String(run.approved_product_id ?? run.product_id)
    push(
      {
        key: "product",
        type: "product",
        label: "Product",
        sublabel: run.approved_product_id ? "approved from this run" : "linked",
        state: "present",
        count: 1,
        status: null,
        href: `/products/${productId}`,
        props: [
          { key: "product", value: productId },
          ...(run.approved_variant_id
            ? [{ key: "variant", value: String(run.approved_variant_id) }]
            : []),
        ],
        action: null,
      },
      {
        label: run.approved_product_id ? "approved_product_id" : "product_id",
        state: "present",
        reason: null,
      }
    )
  } else if (completedWithoutProduct(run)) {
    push(
      {
        key: "product",
        type: "product",
        label: "Product",
        sublabel: "never minted",
        state: "absent",
        count: 0,
        status: null,
        href: null,
        props: [],
        action: null,
      },
      {
        label: "approved_product_id",
        state: "absent",
        reason:
          "The run finished and nothing in the catalogue was minted from it, so its output cannot be sold or fulfilled. 64 of 77 completed runs are in this state. Output approval needs the run at `completed` and goes through the output review, not a status edit.",
      }
    )
  }

  // ---- what came out of it ------------------------------------------------

  if (completedWithoutOutput(run)) {
    push(
      {
        key: "output",
        type: "run_output",
        label: "Produced",
        sublabel: "nobody said",
        state: "absent",
        count: 0,
        status: null,
        href: null,
        props: [{ key: "ordered", value: String(run.quantity ?? "—") }],
        action: null,
      },
      {
        label: "produced_quantity",
        state: "absent",
        /*
         * 🔴 Distinguished from a reported zero on purpose — see absence.ts.
         * A payout is measured against this field.
         */
        reason:
          "This run is completed and `produced_quantity` was never set. That is not the same as a reported zero: a payout is measured against this number and capped at the ordered quantity, so an unstated result is an unsettled one. 25 of 77 completed runs.",
      }
    )
  } else if (run.produced_quantity !== null && run.produced_quantity !== undefined) {
    const short =
      typeof run.quantity === "number" &&
      Number(run.produced_quantity) < Number(run.quantity)
    push(
      {
        key: "output",
        type: "run_output",
        label: "Produced",
        sublabel: `${run.produced_quantity}${run.quantity ? ` of ${run.quantity}` : ""}`,
        state: "present",
        count: Number(run.produced_quantity) || 0,
        status: short ? "short" : null,
        href: null,
        props: [
          { key: "produced", value: String(run.produced_quantity) },
          { key: "ordered", value: String(run.quantity ?? "—") },
          ...(run.rejected_quantity
            ? [{ key: "rejected", value: String(run.rejected_quantity) }]
            : []),
        ],
        action: null,
      },
      { label: "produced_quantity", state: "present", reason: null }
    )
  }

  /*
   * Where the finished goods landed. 🔴 `stocked_at_location_id` is null on
   * 146 of 146 runs — nothing produced here has ever been banked. That is a
   * platform-wide fact (#2053), not a property of the run in front of you, so
   * it is stated ONLY on a completed run that produced something, where it is
   * a real gap in THIS run's trail, and never as a fault on every graph.
   */
  if (run.stocked_at_location_id) {
    push(
      {
        key: "stock",
        type: "stock_location",
        label: "Banked at",
        sublabel: String(run.stocked_quantity ?? ""),
        state: "present",
        count: 1,
        status: null,
        href: null,
        props: [
          { key: "location", value: String(run.stocked_at_location_id) },
          { key: "quantity", value: String(run.stocked_quantity ?? "—") },
        ],
        action: null,
      },
      { label: "stocked_at_location_id", state: "present", reason: null }
    )
  } else if (
    String(run.status) === "completed" &&
    Number(run.produced_quantity) > 0
  ) {
    push(
      {
        key: "stock",
        type: "stock_location",
        label: "Banked at",
        sublabel: "nowhere",
        state: "absent",
        count: 0,
        status: null,
        href: null,
        props: [{ key: "produced", value: String(run.produced_quantity) }],
        action: null,
      },
      {
        label: "stocked_at_location_id",
        state: "absent",
        reason:
          "Goods were made and never banked into a stock location, so nothing can be sold or shipped from them. No run on the platform has ever carried this field — see #2053, where 13 partners have no location able to hold finished goods.",
      }
    )
  }

  // ---- the work itself ----------------------------------------------------

  if (taskIds.length) {
    push(
      {
        key: "tasks",
        type: "task",
        label: "Tasks",
        sublabel: `${taskIds.length} minted`,
        state: "present",
        count: taskIds.length,
        status: null,
        href: null,
        props: [{ key: "tasks", value: String(taskIds.length) }],
        action: null,
      },
      { label: "production_run ↔ task", state: "present", reason: null }
    )
  } else if (
    isOpen(run.status) &&
    String(run.dispatch_state ?? "") === "completed"
  ) {
    /*
     * Dispatch says it finished and no task exists. That is the shape the S1
     * proof measured deliberately — a held run mints zero tasks and the
     * partner is never pinged — so it is only a fault once dispatch claims to
     * have completed.
     */
    push(
      {
        key: "tasks",
        type: "task",
        label: "Tasks",
        sublabel: "none minted",
        state: "absent",
        count: 0,
        status: null,
        href: null,
        props: [{ key: "dispatch", value: String(run.dispatch_state) }],
        action: null,
      },
      {
        label: "production_run ↔ task",
        state: "absent",
        reason:
          "Dispatch is recorded as completed and no task was minted, so the partner was never actually given the work.",
      }
    )
  }

  if (materialIds.length) {
    push(
      {
        key: "materials",
        type: "inventory_item",
        label: "Materials allocated",
        sublabel: `${materialIds.length} item${materialIds.length === 1 ? "" : "s"}`,
        state: "present",
        count: materialIds.length,
        status: null,
        href: null,
        props: [{ key: "items", value: String(materialIds.length) }],
        action: null,
      },
      { label: "production_run ↔ inventory_item", state: "present", reason: null }
    )
  }

  if (logIds.length) {
    push(
      {
        key: "consumption",
        type: "consumption_log",
        label: "Consumption",
        sublabel: `${logIds.length} log${logIds.length === 1 ? "" : "s"}`,
        state: "present",
        count: logIds.length,
        status: null,
        href: null,
        props: [{ key: "logs", value: String(logIds.length) }],
        action: null,
      },
      { label: "production_run ↔ consumption_log", state: "present", reason: null }
    )
  } else if (materialIds.length && String(run.status) === "completed") {
    push(
      {
        key: "consumption",
        type: "consumption_log",
        label: "Consumption",
        sublabel: "nothing recorded",
        state: "absent",
        count: 0,
        status: null,
        href: null,
        props: [{ key: "allocated", value: String(materialIds.length) }],
        action: null,
      },
      {
        label: "production_run ↔ consumption_log",
        state: "absent",
        reason:
          "Material was allocated to this run and the run is finished, but nothing was ever logged as consumed — so the cost of the cloth cannot follow the garment, and the stock it was drawn from still reads as full.",
      }
    )
  }

  // ---- the pair -----------------------------------------------------------

  if (parentRun) {
    push(
      {
        key: "parent_run",
        type: "production_run",
        label: "Parent run",
        sublabel: String(parentRun.role ?? parentRun.status ?? ""),
        state: "present",
        count: 1,
        status: String(parentRun.status ?? ""),
        href: `/production-runs/${parentRun.id}`,
        props: [{ key: "run", value: String(parentRun.id) }],
        action: null,
      },
      {
        label: "parent_run_id",
        state: "present",
        /*
         * 🔴 Named because the pair is routinely misread as one garment. Both
         * halves can be separately payable, and `produced_quantity` is mirrored
         * across them — so the pair is not evidence of how many were made.
         */
        reason: null,
      }
    )
  }

  if (childRuns.length) {
    const withPartner = childRuns.filter((c) => c.partner_id).length
    push(
      {
        key: "child_runs",
        type: "production_run",
        label: "Child runs",
        sublabel: `${childRuns.length}, ${withPartner} with a partner`,
        state: "present",
        count: childRuns.length,
        status: null,
        href: null,
        props: childRuns.map((c) => ({
          key: String(c.id),
          value: String(c.status ?? "—"),
        })),
        action: null,
      },
      {
        label: "parent_run_id",
        state: "present",
        reason: null,
      }
    )
  }

  const spine: GraphNode = {
    key: "production_run",
    type: "production_run",
    label: design ? String(design.name ?? runId) : String(runId),
    sublabel: [run.run_type, run.role].filter(Boolean).join(" · ") || null,
    state: "present",
    count: 1,
    status: String(run.status ?? ""),
    href: `/production-runs/${runId}`,
    props: [
      { key: "status", value: String(run.status ?? "—") },
      { key: "ordered", value: String(run.quantity ?? "—") },
      ...(run.execution_mode
        ? [{ key: "mode", value: String(run.execution_mode) }]
        : []),
      ...(run.dispatch_state
        ? [{ key: "dispatch", value: String(run.dispatch_state) }]
        : []),
    ],
    action: null,
  }

  return builder.build(spine)
}

export const productionRunSpine: SpineDescriptor = {
  key: "production_run",
  label: "Production run",
  resolve: resolveProductionRunGraph,
  items: resolveProductionRunItems,
  itemNodes: PRODUCTION_RUN_ITEM_NODES,
}
