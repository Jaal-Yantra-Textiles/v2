import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import designOrderLink from "../../../../links/design-order-link"
import designMediaFolderLink from "../../../../links/design-media-folder-link"
import productDesignLink from "../../../../links/product-design-link"
import designConsumptionLogLink from "../../../../links/design-consumption-log"
import designPersonLink from "../../../../links/designs-person-link"
import designRawMaterialGroupLink from "../../../../links/design-raw-material-group"
import { GraphBuilder, asArray, money } from "../../builder"
import type { EdgeState, Graph, GraphNode, SpineContext, SpineDescriptor } from "../../types"
import {
  COMMITTED_DESIGN_STATUSES,
  daysWaiting,
  expectsInventory,
  expectsPartner,
  expectsProductionRun,
  expectsSpecification,
  expectsConsumptionLog,
  productNodeState,
  runsAwaitingProduct,
} from "./absence"

/**
 * The DESIGN spine (#1847).
 *
 * Lifted out of `GET /admin/designs/:id/graph` unchanged so the admin canvas
 * and the MCP `get_entity_neighbours` tool resolve neighbours through one
 * implementation. The node and edge construction below is the prototype's,
 * verbatim; what changed is that it now returns a `Graph` instead of writing a
 * response, and pushes through the shared `GraphBuilder`.
 *
 * An absent edge is the thing a list of rows can never show. The motivating
 * case is `production_run.approved_product_id` — written by
 * `approve-run-output` on every approval, read by nothing, so a finished run
 * that was never listed for sale is indistinguishable from one that was.
 *
 * 🔴 Absences are asserted ONLY where the model genuinely expects the
 * neighbour (see `absence.ts`). A graph that cries wolf on every empty
 * relation is worse than no graph: the reader stops believing the dashed
 * edges, which are the ones worth believing.
 */
const resolveDesignGraph = async ({ scope, id }: SpineContext): Promise<Graph> => {
  const designId = id
  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as any

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
      // Intra-module hasMany relations — these resolve straight off the entity
      // (probed: every key comes back populated). Only MODULE LINKS need the
      // entryPoint treatment below.
      "specifications.*",
      "colors.*",
      "size_sets.*",
      "components.*",
      "used_in.*",
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
  const specifications = asArray<any>(design.specifications)
  const colors = asArray<any>(design.colors)
  const sizeSets = asArray<any>(design.size_sets)
  const components = asArray<any>(design.components)
  const usedIn = asArray<any>(design.used_in)

  const { data: runs } = await query.graph({
    entity: "production_runs",
    filters: { design_id: designId },
    fields: ["*"],
  })
  const runList = asArray<any>(runs)

  /**
   * Everything that travels through a LINK TABLE rather than the entity.
   *
   * 🔴 Read through `entryPoint`, never as a field hop off `designs`: a
   * `query.graph` hop from an entity to a linked field can come back with NO
   * KEY AT ALL rather than an error, and an empty graph is the one failure
   * this resolver must never render as "nothing there".
   *
   * One round trip for all of them — they are independent.
   */
  const [
    { data: orderLinks },
    { data: folderLinks },
    { data: productLinks },
    { data: consumptionLinks },
    { data: personLinks },
    { data: materialGroupLinks },
  ] = await Promise.all([
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
    query.graph({
      entity: productDesignLink.entryPoint,
      filters: { design_id: designId },
      fields: ["product_id"],
    }),
    query.graph({
      entity: designConsumptionLogLink.entryPoint,
      filters: { design_id: designId },
      fields: ["consumption_log_id"],
    }),
    query.graph({
      entity: designPersonLink.entryPoint,
      filters: { design_id: designId },
      fields: ["person_id", "role"],
    }),
    query.graph({
      entity: designRawMaterialGroupLink.entryPoint,
      filters: { design_id: designId },
      fields: ["raw_material_group_id", "resolved_raw_material_id"],
    }),
  ])
  const orderIds = asArray<any>(orderLinks).map((l) => l.order_id).filter(Boolean)
  const folderIds = asArray<any>(folderLinks).map((l) => l.folder_id).filter(Boolean)
  const linkedProductIds = asArray<any>(productLinks).map((l) => l.product_id).filter(Boolean)
  const consumptionIds = asArray<any>(consumptionLinks)
    .map((l) => l.consumption_log_id)
    .filter(Boolean)
  const people = asArray<any>(personLinks)
  const materialGroups = asArray<any>(materialGroupLinks)

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

  const builder = new GraphBuilder("design")
  const push = builder.push.bind(builder)

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

  const productState = productNodeState(
    productIds.length,
    outstandingRuns.length,
    linkedProductIds.length
  )

  if (productState === "present") {
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
  } else if (productState === "derived") {
    /**
     * Joined through `product_design` with no run having written
     * `approved_product_id`. A real relationship, but not this node's column —
     * so it draws dashed, and says which path it came down. Reading it as
     * "present" would claim a run produced it; reading it as "none" would deny
     * a link that exists.
     */
    push(
      {
        key: "product",
        type: "product",
        label: "Product",
        sublabel: `${linkedProductIds.length} linked directly`,
        state: "derived",
        count: linkedProductIds.length,
        status: null,
        href: `/products/${linkedProductIds[0]}`,
        props: [
          { key: "via", value: "product_design" },
          { key: "approved_product_id", value: "null" },
          { key: "product id", value: String(linkedProductIds[0]) },
        ],
        action: null,
      },
      {
        label: "product_design",
        state: "derived",
        reason:
          "This design is joined to a catalogue product through the product_design link, but no production run wrote approved_product_id. The product exists; it is not recorded as any run's output.",
      }
    )
  } else if (productState === "absent") {
    const waitingDays = daysWaiting(outstandingRuns)

    push(
      {
        key: "product",
        type: "product",
        label: "Product",
        sublabel: productIds.length
          ? `${productIds.length} listed, ${outstandingRuns.length} not`
          : "never created",
        state: "absent",
        count: 0,
        status: null,
        href: null,
        props: [
          { key: "runs awaiting", value: String(outstandingRuns.length) },
          ...(productIds.length
            ? [{ key: "already listed", value: String(productIds.length) }]
            : []),
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
          productIds.length
            ? "Some runs on this design were listed and others were not. The listed ones do not discharge the rest — each finished run owes its own product."
            : "A run finished and no catalogue product was created from it. The column is written on approval and read by nothing, so this never appears in a list.",
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

  // ---- specifications (the tech-pack) -------------------------------------

  if (specifications.length) {
    push(
      {
        key: "specifications",
        type: "specification",
        label: "Specifications",
        sublabel: `${specifications.length} detail${specifications.length === 1 ? "" : "s"}`,
        state: "present",
        count: specifications.length,
        status: null,
        href: `/designs/${designId}`,
        props: specifications.slice(0, 4).map((sp) => ({
          key: sp.name || sp.type || sp.id,
          value: String(sp.value ?? sp.description ?? "—").slice(0, 40),
        })),
        action: null,
      },
      { label: "specifications", state: "present", reason: null }
    )
  } else if (expectsSpecification(design.status, specifications.length)) {
    push(
      {
        key: "specifications",
        type: "specification",
        label: "Specifications",
        sublabel: "none recorded",
        state: "absent",
        count: 0,
        status: null,
        href: `/designs/${designId}`,
        props: [{ key: "design status", value: String(design.status) }],
        action: { label: "Add construction detail", href: null },
      },
      {
        label: "specifications",
        state: "absent",
        reason:
          "The design is committed and carries no construction detail, so a tech-pack cannot be generated from it.",
      }
    )
  }

  // ---- consumption --------------------------------------------------------

  if (consumptionIds.length) {
    push(
      {
        key: "consumption",
        type: "consumption_log",
        label: "Consumption",
        sublabel: `${consumptionIds.length} log${consumptionIds.length === 1 ? "" : "s"}`,
        state: "present",
        count: consumptionIds.length,
        status: null,
        href: `/designs/${designId}`,
        props: [{ key: "logs", value: String(consumptionIds.length) }],
        action: null,
      },
      { label: "consumption_log", state: "present", reason: null }
    )
  } else if (expectsConsumptionLog(runList, consumptionIds.length)) {
    push(
      {
        key: "consumption",
        type: "consumption_log",
        label: "Consumption",
        sublabel: "never recorded",
        state: "absent",
        count: 0,
        status: null,
        href: `/designs/${designId}`,
        props: [
          {
            key: "finished runs",
            value: String(runList.filter((r) => String(r.status) === "completed").length),
          },
          { key: "produced", value: String(producedTotal) },
        ],
        action: null,
      },
      {
        label: "consumption_log",
        state: "absent",
        reason:
          "A run finished and no material consumption was ever logged against this design, so what it actually cost cannot be known — only estimated.",
      }
    )
  }

  // ---- raw material groups ------------------------------------------------

  if (materialGroups.length) {
    const resolved = materialGroups.filter((g) => g.resolved_raw_material_id).length
    push(
      {
        key: "materials",
        type: "raw_material_group",
        label: "Material groups",
        sublabel: `${materialGroups.length} pinned`,
        state: "present",
        count: materialGroups.length,
        status: null,
        href: `/designs/${designId}`,
        props: [
          { key: "groups", value: String(materialGroups.length) },
          // The colour stays unresolved until production picks one (#817 S4).
          { key: "resolved at production", value: `${resolved} of ${materialGroups.length}` },
        ],
        action: null,
      },
      { label: "raw_material_group", state: "present", reason: null }
    )
  }

  // ---- people -------------------------------------------------------------

  if (people.length) {
    push(
      {
        key: "people",
        type: "person",
        label: "People",
        sublabel: `${people.length} linked`,
        state: "present",
        count: people.length,
        status: null,
        href: `/designs/${designId}`,
        props: people.slice(0, 4).map((pl) => ({
          key: String(pl.person_id).slice(0, 18),
          value: String(pl.role ?? "—"),
        })),
        action: null,
      },
      { label: "person", state: "present", reason: null }
    )
  }

  // ---- colours and sizes --------------------------------------------------

  if (colors.length || sizeSets.length) {
    push(
      {
        key: "palette",
        type: "palette",
        label: "Colours & sizes",
        sublabel: `${colors.length} colour${colors.length === 1 ? "" : "s"}, ${sizeSets.length} size set${sizeSets.length === 1 ? "" : "s"}`,
        state: "present",
        count: colors.length + sizeSets.length,
        status: null,
        href: `/designs/${designId}`,
        props: [
          { key: "colours", value: String(colors.length) },
          { key: "size sets", value: String(sizeSets.length) },
        ],
        action: null,
      },
      { label: "colors / size_sets", state: "present", reason: null }
    )
  }

  // ---- bundles ------------------------------------------------------------

  if (components.length || usedIn.length) {
    push(
      {
        key: "components",
        type: "design_component",
        label: "Bundled designs",
        sublabel: `${components.length} in, ${usedIn.length} out`,
        state: "present",
        count: components.length + usedIn.length,
        status: null,
        href: `/designs/${designId}`,
        props: [
          { key: "components", value: String(components.length) },
          { key: "used in", value: String(usedIn.length) },
        ],
        action: null,
      },
      { label: "components / used_in", state: "present", reason: null }
    )
  }

  // ---- revision lineage ---------------------------------------------------

  if (design.revised_from_id) {
    push(
      {
        key: "revision",
        type: "design",
        label: "Revised from",
        sublabel: `revision ${design.revision_number ?? 1}`,
        state: "present",
        count: 1,
        status: null,
        href: `/designs/${design.revised_from_id}`,
        props: [
          { key: "revision", value: String(design.revision_number ?? 1) },
          { key: "parent", value: String(design.revised_from_id).slice(0, 18) },
        ],
        action: null,
      },
      { label: "revised_from_id", state: "present", reason: null }
    )
  }

  // ---- the spine ----------------------------------------------------------

  const spine: GraphNode = {
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

  return builder.build(spine)
}

export const designSpine: SpineDescriptor = {
  key: "design",
  label: "Design",
  resolve: resolveDesignGraph,
}
