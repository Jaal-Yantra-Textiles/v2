import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import designOrderLink from "../../../../../links/design-order-link"
import designMediaFolderLink from "../../../../../links/design-media-folder-link"
import {
  COMMITTED_DESIGN_STATUSES,
  daysWaiting,
  expectsInventory,
  expectsPartner,
  expectsProductionRun,
  runsAwaitingProduct,
} from "./absence"

/**
 * GET /admin/designs/:id/graph
 *
 * The design spine as NODES and EDGES, for the graph view on the design page.
 *
 * Three edge states, and the third is the whole point:
 *
 *   present  — a declared link with something on the other end.
 *   derived  — true only through a shared record (two hops), never a link file.
 *   absent   — the model expects a neighbour here and there isn't one. A
 *              "future edge": it names the action that would create it.
 *
 * An absent edge is the thing a list of rows can never show. The motivating
 * case is `production_run.approved_product_id` — written by
 * `approve-run-output` on every approval, read by nothing, so a finished run
 * that was never listed for sale is indistinguishable from one that was.
 *
 * 🔴 Absences are asserted ONLY where the model genuinely expects the
 * neighbour (see `absentReasons` below). A graph that cries wolf on every
 * empty relation is worse than no graph: the reader stops believing the
 * dashed edges, which are the ones worth believing.
 */

type EdgeState = "present" | "derived" | "absent"

type GraphProp = { key: string; value: string }

type GraphNode = {
  key: string
  type: string
  label: string
  sublabel: string | null
  state: EdgeState
  count: number
  status: string | null
  href: string | null
  props: GraphProp[]
  /** Present only on an absent node: what would bring it into existence. */
  action: { label: string; href: string | null } | null
}

type GraphEdge = {
  from: string
  to: string
  /** The real link field or column name — never "related to". */
  label: string
  state: EdgeState
  /** Why this edge is absent or derived. Null on a present edge. */
  reason: string | null
}

const asArray = <T>(v: T | T[] | null | undefined): T[] =>
  Array.isArray(v) ? v.filter(Boolean) : v ? [v] : []

const money = (v: unknown, currency?: string | null): string | null => {
  const n = typeof v === "string" ? Number(v) : (v as number)
  if (!Number.isFinite(n)) return null
  return `${(currency || "").toUpperCase()} ${Number(n).toLocaleString()}`.trim()
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const designId = req.params.id
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  /**
   * The relations read straight off the entity are exactly the four the design
   * detail loader already proves resolve this way (DESIGN_DETAIL_FIELDS).
   * Anything beyond them is read through the link's own entryPoint below —
   * a `query.graph` hop from an entity to a linked field can come back with NO
   * KEY AT ALL rather than an error, and an empty graph is the one failure this
   * route must never render as "nothing there".
   */
  const { data: designs } = await query.graph({
    entity: "designs",
    filters: { id: designId },
    fields: [
      "*",
      "partners.*",
      "tasks.*",
      "inventory_items.*",
      "customers.*",
    ],
  })

  const design = (designs || [])[0]
  if (!design) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Design ${designId} was not found`
    )
  }

  const partners = asArray<any>(design.partners)
  const tasks = asArray<any>(design.tasks)
  const inventoryItems = asArray<any>(design.inventory_items)
  const customers = asArray<any>(design.customers)
  const mediaFiles = asArray<any>(design.media_files)
  const moodboard = asArray<any>(design.moodboard)

  const { data: runs } = await query.graph({
    entity: "production_runs",
    filters: { design_id: designId },
    fields: ["*"],
  })
  const runList = asArray<any>(runs)

  // Orders and media folders travel through their link tables, not the entity.
  const [{ data: orderLinks }, { data: folderLinks }] = await Promise.all([
    query.graph({
      entity: designOrderLink.entryPoint,
      filters: { design_id: designId },
      fields: ["order_id"],
    }),
    query.graph({
      entity: designMediaFolderLink.entryPoint,
      filters: { design_id: designId },
      fields: ["folder_id"],
    }),
  ])
  const orderIds = asArray<any>(orderLinks).map((l) => l.order_id).filter(Boolean)
  const folderIds = asArray<any>(folderLinks).map((l) => l.folder_id).filter(Boolean)

  // ---- derived facts the absence rules key on -----------------------------

  const runsWithProduct = runList.filter((r) => !!r.approved_product_id)
  const productIds = Array.from(
    new Set(runsWithProduct.map((r) => r.approved_product_id))
  )
  const outstandingRuns = runsAwaitingProduct(runList)

  const committed = COMMITTED_DESIGN_STATUSES.has(String(design.status))
  // The task enum is pending | in_progress | completed | cancelled | accepted |
  // assigned — "completed" is the only terminal-done value, so don't invent
  // synonyms that would silently count nothing.
  const doneTasks = tasks.filter((t) => String(t.status) === "completed").length

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  const push = (node: GraphNode, edge: Omit<GraphEdge, "from" | "to">) => {
    nodes.push(node)
    edges.push({ from: "design", to: node.key, ...edge })
  }

  // ---- production runs ----------------------------------------------------

  const runStatusCounts = runList.reduce<Record<string, number>>((acc, r) => {
    const k = String(r.status)
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {})

  const producedTotal = runList.reduce(
    (sum, r) => sum + (Number(r.produced_quantity) || 0),
    0
  )

  if (runList.length) {
    push(
      {
        key: "runs",
        type: "production_run",
        label: "Production runs",
        sublabel: `${runList.length} run${runList.length === 1 ? "" : "s"}`,
        state: "present",
        count: runList.length,
        status: null,
        href: `/designs/${designId}/production-runs`,
        props: [
          ...Object.entries(runStatusCounts).map(([k, v]) => ({
            key: k,
            value: String(v),
          })),
          { key: "produced", value: String(producedTotal) },
          {
            key: "awaiting_reassignment",
            value: String(runStatusCounts["awaiting_reassignment"] || 0),
          },
        ],
        action: null,
      },
      { label: "design_id", state: "present", reason: null }
    )
  } else {
    push(
      {
        key: "runs",
        type: "production_run",
        label: "Production runs",
        sublabel: committed ? "none yet" : "not started",
        state: expectsProductionRun(design.status, runList.length) ? "absent" : "present",
        count: 0,
        status: null,
        href: `/designs/${designId}/production-runs`,
        props: [{ key: "design status", value: String(design.status) }],
        action: committed
          ? {
              label: "Send to production",
              href: `/designs/${designId}/production-run`,
            }
          : null,
      },
      {
        label: "design_id",
        state: expectsProductionRun(design.status, runList.length) ? "absent" : "present",
        reason: committed
          ? `Design is ${design.status} and no run has been created.`
          : null,
      }
    )
  }

  // ---- product: the motivating absent edge --------------------------------

  if (productIds.length) {
    push(
      {
        key: "product",
        type: "product",
        label: "Product",
        sublabel: `${productIds.length} listed`,
        state: "present",
        count: productIds.length,
        status: null,
        href: `/products/${productIds[0]}`,
        props: [
          { key: "from runs", value: String(runsWithProduct.length) },
          { key: "product id", value: String(productIds[0]) },
        ],
        action: null,
      },
      { label: "approved_product_id", state: "present", reason: null }
    )
  } else if (outstandingRuns.length) {
    const waitingDays = daysWaiting(outstandingRuns)

    push(
      {
        key: "product",
        type: "product",
        label: "Product",
        sublabel: "never created",
        state: "absent",
        count: 0,
        status: null,
        href: null,
        props: [
          { key: "runs finished", value: String(outstandingRuns.length) },
          { key: "approved_product_id", value: "null" },
          ...(waitingDays !== null
            ? [{ key: "waiting", value: `${waitingDays} days` }]
            : []),
          { key: "produced", value: String(producedTotal) },
        ],
        action: {
          label: "List this run as a product",
          href: `/designs/${designId}/production-runs`,
        },
      },
      {
        label: "approved_product_id",
        state: "absent",
        reason:
          "A run finished and no catalogue product was created from it. The column is written on approval and read by nothing, so this never appears in a list.",
      }
    )
  }

  // ---- partners -----------------------------------------------------------

  const partnerExpected = expectsPartner(runList, partners.length)
  if (partners.length) {
    push(
      {
        key: "partners",
        type: "partner",
        label: "Partners",
        sublabel: partners.map((p) => p.name).filter(Boolean).join(", ") || null,
        state: "present",
        count: partners.length,
        status: null,
        href: `/designs/${designId}/partners`,
        props: partners.slice(0, 4).map((p) => ({
          key: p.name || p.id,
          value: String(p.status ?? "linked"),
        })),
        action: null,
      },
      { label: "partner", state: "present", reason: null }
    )
  } else if (partnerExpected) {
    push(
      {
        key: "partners",
        type: "partner",
        label: "Partners",
        sublabel: "none linked",
        state: "absent",
        count: 0,
        status: null,
        href: `/designs/${designId}/partners`,
        props: [{ key: "outsourced runs", value: String(runList.filter((r) => r.execution_mode === "outsourced").length) }],
        action: {
          label: "Link a partner",
          href: `/designs/${designId}/linkPartner`,
        },
      },
      {
        label: "partner",
        state: "absent",
        reason:
          "A run is set to outsourced execution but no partner is linked to the design.",
      }
    )
  }

  // ---- tasks --------------------------------------------------------------

  if (tasks.length) {
    push(
      {
        key: "tasks",
        type: "task",
        label: "Tasks",
        sublabel: `${doneTasks} of ${tasks.length} done`,
        state: "present",
        count: tasks.length,
        status: null,
        href: `/designs/${designId}/tasks`,
        props: [
          { key: "done", value: String(doneTasks) },
          { key: "open", value: String(tasks.length - doneTasks) },
        ],
        action: null,
      },
      { label: "tasks", state: "present", reason: null }
    )
  }

  // ---- inventory ----------------------------------------------------------

  if (inventoryItems.length) {
    push(
      {
        key: "inventory",
        type: "inventory_item",
        label: "Inventory",
        sublabel: `${inventoryItems.length} item${inventoryItems.length === 1 ? "" : "s"}`,
        state: "present",
        count: inventoryItems.length,
        status: null,
        href: `/designs/${designId}`,
        props: inventoryItems.slice(0, 4).map((i) => ({
          key: i.title || i.sku || i.id,
          value: String(i.sku ?? ""),
        })),
        action: null,
      },
      { label: "inventory_item", state: "present", reason: null }
    )
  } else if (expectsInventory(runList, inventoryItems.length)) {
    push(
      {
        key: "inventory",
        type: "inventory_item",
        label: "Inventory",
        sublabel: "nothing linked",
        state: "absent",
        count: 0,
        status: null,
        href: `/designs/${designId}`,
        props: [{ key: "runs", value: String(runList.length) }],
        action: { label: "Link inventory", href: `/designs/${designId}/addinv` },
      },
      {
        label: "inventory_item",
        state: "absent",
        reason:
          "A run exists but no inventory item is linked, so material consumption cannot be costed against this design.",
      }
    )
  }

  // ---- media --------------------------------------------------------------

  const mediaCount = mediaFiles.length + folderIds.length
  if (mediaCount || moodboard.length) {
    push(
      {
        key: "media",
        type: "media",
        label: "Media",
        sublabel: `${mediaFiles.length} file${mediaFiles.length === 1 ? "" : "s"}`,
        state: "present",
        count: mediaCount,
        status: null,
        href: `/designs/${designId}/media`,
        props: [
          { key: "files", value: String(mediaFiles.length) },
          { key: "folders", value: String(folderIds.length) },
          { key: "moodboard", value: String(moodboard.length) },
        ],
        action: null,
      },
      { label: "media_folder", state: "present", reason: null }
    )
  }

  // ---- orders (and the customers behind them) -----------------------------

  if (orderIds.length) {
    push(
      {
        key: "orders",
        type: "order",
        label: "Orders",
        sublabel: `${orderIds.length} order${orderIds.length === 1 ? "" : "s"}`,
        state: "present",
        count: orderIds.length,
        status: null,
        href: `/orders/${orderIds[0]}`,
        props: [{ key: "orders", value: String(orderIds.length) }],
        action: null,
      },
      { label: "order", state: "present", reason: null }
    )
  }

  if (customers.length) {
    push(
      {
        key: "customers",
        type: "customer",
        label: "Customers",
        sublabel: `${customers.length}`,
        state: "present",
        count: customers.length,
        status: null,
        href: null,
        props: customers.slice(0, 3).map((c) => ({
          key: c.email || c.id,
          value: [c.first_name, c.last_name].filter(Boolean).join(" ") || "—",
        })),
        action: null,
      },
      { label: "customer", state: "present", reason: null }
    )
  }

  // ---- the spine ----------------------------------------------------------

  const spine = {
    key: "design",
    type: "design",
    label: design.name || designId,
    sublabel: String(design.status),
    state: "present" as EdgeState,
    count: 1,
    status: String(design.status),
    href: `/designs/${designId}`,
    props: [
      { key: "status", value: String(design.status) },
      { key: "priority", value: String(design.priority ?? "—") },
      { key: "type", value: String(design.design_type ?? "—") },
      { key: "revision", value: String(design.revision_number ?? 1) },
      ...(design.target_completion_date
        ? [
            {
              key: "target",
              value: new Date(design.target_completion_date)
                .toISOString()
                .slice(0, 10),
            },
          ]
        : []),
      ...(money(design.estimated_cost, design.cost_currency)
        ? [{ key: "estimated", value: money(design.estimated_cost, design.cost_currency)! }]
        : []),
    ],
    action: null,
  }

  res.json({
    graph: {
      spine,
      nodes,
      edges,
      summary: {
        links: edges.filter((e) => e.state === "present").length,
        absent: edges.filter((e) => e.state === "absent").length,
        derived: edges.filter((e) => e.state === "derived").length,
      },
    },
  })
}
