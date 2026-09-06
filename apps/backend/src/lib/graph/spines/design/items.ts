import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import designConsumptionLogLink from "../../../../links/design-consumption-log"
import designOrderLink from "../../../../links/design-order-link"
import designPersonLink from "../../../../links/designs-person-link"
import designRawMaterialGroupLink from "../../../../links/design-raw-material-group"
import { asArray } from "../../builder"
import type { NodeItem, SpineContext } from "../../types"

/**
 * The MEMBERS behind each aggregate node on the design spine (#1847 step 4).
 *
 * The canvas answers "is there an edge here?". Once the reader has clicked the
 * node they are asking the next question — "which ones?" — and, right after
 * that, "take that one off". Neither is answerable from a count, which is why
 * every removal in this admin still lives on a summary card the graph was
 * meant to replace.
 *
 * 🔴 Every `remove` here names an EXISTING admin endpoint. Not one line of
 * detachment logic lives in this file. `DELETE /admin/designs/:id/tasks/:taskId`
 * already cancels the task's dependents; `POST /admin/designs/:id/inventory/delink`
 * already runs a compensating workflow; `POST .../cancel-partner-assignment`
 * already cancels the partner's runs and their open tasks. Rebuilding any of
 * that here would give it a second home — the one failure this codebase has
 * repeated most.
 *
 * 🔴 A node with no entry in the switch returns an EMPTY LIST, never an error.
 * `product` and `revision` are single records, `palette` is a count; a drawer
 * that reddened on those would be wrong about all three.
 */

const s = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)

/**
 * 🔴 `sublabel` must never repeat `status`.
 *
 * The row renders the sublabel under the title AND the status as a badge on
 * the right. Set to the same string — the obvious thing to write, and what the
 * first version of these resolvers did — every row said "pending" twice, side
 * by side, and the sublabel's real job (the one fact that tells this row from
 * the one under it) went unused. Only RENDERING it showed this: both fields
 * were populated, correct, and tested.
 */

/** The design, with only the relations the requested node actually needs. */
const loadDesign = async (query: any, designId: string, fields: string[]) => {
  const { data } = await query.graph({
    entity: "designs",
    filters: { id: designId },
    fields: ["id", ...fields],
  })
  const design = (data || [])[0]
  if (!design) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Design ${designId} was not found`
    )
  }
  return design
}

const inventoryItems = async (
  query: any,
  designId: string
): Promise<NodeItem[]> => {
  const design = await loadDesign(query, designId, ["inventory_items.*"])
  return asArray<any>(design.inventory_items).map((i) => ({
    id: String(i.id),
    label: String(i.title || i.sku || i.id),
    sublabel: i.sku ? String(i.sku) : null,
    status: null,
    /*
     * 🔴 The DESIGN-scoped drawer, not `/inventory/:id`.
     *
     * What is worth editing from here is the LINK — planned quantity, stock
     * location, consumed-at — which is a fact about this design's use of the
     * item, not about the item. Sending the reader to the global inventory
     * page would open the right record and show none of the fields the design
     * page's own inventory card exists to edit, which is the card this row is
     * meant to replace.
     */
    href: `/designs/${designId}/inventory/${i.id}`,
    props: [
      ...(i.sku ? [{ key: "sku", value: String(i.sku) }] : []),
      ...(i.hs_code ? [{ key: "hs code", value: String(i.hs_code) }] : []),
    ],
    /*
     * 🔴 `inventoryIds` is a LIST on the endpoint, and it is sent with exactly
     * one id. Detaching a row the reader did not point at — because a future
     * caller found it convenient to batch — is the kind of change that reads
     * as correct in the diff and loses stock in production.
     */
    remove: {
      method: "POST" as const,
      path: `/admin/designs/${designId}/inventory/delink`,
      body: { inventoryIds: [String(i.id)] },
      label: "Unlink",
      confirm: `Unlink ${i.title || i.sku || "this item"} from the design? Consumption already logged against it stays.`,
    },
  }))
}

const componentItems = async (
  query: any,
  designId: string
): Promise<NodeItem[]> => {
  /*
   * BOTH directions. `components` is what this design is built FROM;
   * `used_in` is what it is a part OF. They are the same table read through
   * two foreign keys, and a drawer that showed only one would say "1 in, 3
   * out" on the node and then list one row.
   *
   * 🔴 Only the `components` side is removable here. A `used_in` row belongs
   * to the PARENT design, and the endpoint scopes its lookup by
   * `parent_design_id` — deleting it from this side would 404, and offering a
   * button that always fails is worse than offering none.
   */
  const design = await loadDesign(query, designId, [
    "components.*",
    "components.component_design.*",
    "used_in.*",
    "used_in.parent_design.*",
  ])

  const inbound = asArray<any>(design.components).map((c) => ({
    id: String(c.id),
    label: String(c.component_design?.name ?? c.component_design?.id ?? c.id),
    sublabel: `part of this design${c.role ? ` — ${c.role}` : ""}`,
    status: null,
    href: c.component_design?.id ? `/designs/${c.component_design.id}` : null,
    props: [
      { key: "quantity", value: String(c.quantity ?? 1) },
      ...(c.role ? [{ key: "role", value: String(c.role) }] : []),
      { key: "direction", value: "component of this design" },
    ],
    remove: {
      method: "DELETE" as const,
      path: `/admin/designs/${designId}/components/${c.id}`,
      body: null,
      label: "Remove",
      confirm: `Remove ${c.component_design?.name ?? "this component"} from the bundle? The design itself is not deleted.`,
    },
  }))

  const outbound = asArray<any>(design.used_in).map((c) => ({
    id: String(c.id),
    label: String(c.parent_design?.name ?? c.parent_design?.id ?? c.id),
    sublabel: "this design is a part of it",
    status: null,
    href: c.parent_design?.id ? `/designs/${c.parent_design.id}` : null,
    props: [
      { key: "quantity", value: String(c.quantity ?? 1) },
      ...(c.role ? [{ key: "role", value: String(c.role) }] : []),
      { key: "direction", value: "this design is used in it" },
    ],
    // Owned by the parent — removable from there, not here. See above.
    remove: null,
  }))

  return [...inbound, ...outbound]
}

const taskItems = async (query: any, designId: string): Promise<NodeItem[]> => {
  const design = await loadDesign(query, designId, ["tasks.*"])
  return asArray<any>(design.tasks).map((t) => ({
    id: String(t.id),
    label: String(t.title || t.id),
    sublabel:
      [
        t.priority ? `${t.priority} priority` : null,
        t.due_date ? `due ${new Date(t.due_date).toLocaleDateString()}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
    status: t.status ? String(t.status) : null,
    href: `/designs/${designId}/tasks`,
    props: [
      ...(t.status ? [{ key: "status", value: String(t.status) }] : []),
      ...(t.priority ? [{ key: "priority", value: String(t.priority) }] : []),
      ...(t.due_date
        ? [{ key: "due", value: new Date(t.due_date).toLocaleDateString() }]
        : []),
    ],
    remove: {
      method: "DELETE" as const,
      path: `/admin/designs/${designId}/tasks/${t.id}`,
      body: null,
      label: "Delete",
      confirm: `Delete "${t.title || "this task"}"? Its subtasks and dependencies go with it.`,
    },
  }))
}

const partnerItems = async (
  query: any,
  designId: string
): Promise<NodeItem[]> => {
  const design = await loadDesign(query, designId, ["partners.*"])
  const { data: runs } = await query.graph({
    entity: "production_runs",
    filters: { design_id: designId },
    fields: ["id", "partner_id", "status", "execution_mode"],
  })
  const runList = asArray<any>(runs)

  return asArray<any>(design.partners).map((p) => {
    const theirRuns = runList.filter((r) => r.partner_id === p.id)
    const live = theirRuns.filter(
      (r) => !["cancelled", "completed"].includes(String(r.status))
    )
    return {
      id: String(p.id),
      label: String(p.name || p.handle || p.id),
      sublabel: theirRuns.length
        ? `${theirRuns.length} ${s(theirRuns.length, "run")}`
        : "no runs",
      status: p.status ? String(p.status) : null,
      href: `/partners/${p.id}`,
      props: [
        ...(p.handle ? [{ key: "handle", value: String(p.handle) }] : []),
        { key: "runs", value: String(theirRuns.length) },
        { key: "live runs", value: String(live.length) },
      ],
      /*
       * 🔴 `unlink: true` and the confirm text says what that costs. This is
       * NOT a symmetric undo of "link partner": the workflow cancels the
       * partner's active runs and their open tasks first. A button labelled
       * "Unlink" that silently cancels production would be the worst thing on
       * this screen, so the count is in the sentence.
       */
      remove: {
        method: "POST" as const,
        path: `/admin/designs/${designId}/cancel-partner-assignment`,
        body: { partner_id: String(p.id), unlink: true },
        label: "Cancel assignment",
        confirm: live.length
          ? `Cancel ${p.name || "this partner"}'s assignment? ${live.length} live ${s(live.length, "run")} and their open tasks are cancelled too.`
          : `Unlink ${p.name || "this partner"} from the design?`,
      },
    }
  })
}

const runItems = async (query: any, designId: string): Promise<NodeItem[]> => {
  const { data: runs } = await query.graph({
    entity: "production_runs",
    filters: { design_id: designId },
    fields: ["*"],
  })
  return asArray<any>(runs).map((r) => ({
    id: String(r.id),
    label: String(r.name || r.id),
    sublabel:
      [
        r.quantity_produced != null ? `${r.quantity_produced} produced` : null,
        r.quantity_target != null ? `of ${r.quantity_target}` : null,
        r.execution_mode ? String(r.execution_mode) : null,
        // The motivating absence, said in words on the row it belongs to.
        r.approved_product_id ? null : "no product",
      ]
        .filter(Boolean)
        .join(" · ") || null,
    status: r.status ? String(r.status) : null,
    href: `/designs/${designId}/production-runs`,
    props: [
      { key: "status", value: String(r.status ?? "—") },
      { key: "mode", value: String(r.execution_mode ?? "—") },
      ...(r.quantity_target != null
        ? [{ key: "target", value: String(r.quantity_target) }]
        : []),
      ...(r.quantity_produced != null
        ? [{ key: "produced", value: String(r.quantity_produced) }]
        : []),
      /*
       * The motivating absence, per run rather than in aggregate. The node
       * says "2 runs awaiting a product"; this says WHICH two.
       */
      {
        key: "approved_product_id",
        value: String(r.approved_product_id ?? "null"),
      },
    ],
    /*
     * 🔴 No remove. A run is not detached from its design — it is CANCELLED,
     * which is a state change with its own compensation, its own partner
     * notification and its own payout consequences. Offering it as a row
     * action beside "Unlink inventory" would make two very different things
     * look like one.
     */
    remove: null,
  }))
}

const consumptionItems = async (
  query: any,
  designId: string
): Promise<NodeItem[]> => {
  const { data: links } = await query.graph({
    entity: designConsumptionLogLink.entryPoint,
    filters: { design_id: designId },
    fields: ["consumption_log_id"],
  })
  const ids = asArray<any>(links)
    .map((l) => l.consumption_log_id)
    .filter(Boolean)
  if (!ids.length) return []

  const { data: logs } = await query.graph({
    entity: "consumption_log",
    filters: { id: ids },
    fields: ["*"],
  })

  return asArray<any>(logs).map((l) => {
    const applied = l.inventory_applied_at ?? l.metadata?.inventory_applied_at
    return {
      id: String(l.id),
      label: `${l.quantity ?? "—"} ${l.unit_of_measure ?? ""}`.trim(),
      sublabel: String(l.consumption_type ?? l.inventory_item_id ?? ""),
      status: applied ? "applied" : "draft",
      href: `/designs/${designId}`,
      props: [
        { key: "quantity", value: String(l.quantity ?? "—") },
        ...(l.unit_of_measure
          ? [{ key: "unit", value: String(l.unit_of_measure) }]
          : []),
        { key: "stock applied", value: applied ? "yes" : "no" },
      ],
      /*
       * 🔴 An APPLIED log has already moved stock, and the endpoint refuses to
       * delete it — "correct it with a reversing entry, not an edit". Offering
       * the button anyway would put a 400 behind a confirm dialog. The rule is
       * mirrored here so the drawer never renders an action the server will
       * refuse; if the two ever disagree, the server still wins.
       */
      remove: applied
        ? null
        : {
            method: "DELETE" as const,
            path: `/admin/designs/${designId}/consumption-logs/${l.id}`,
            body: null,
            label: "Delete",
            confirm: `Delete this log of ${l.quantity ?? ""} ${l.unit_of_measure ?? ""}? No stock has moved for it yet.`,
          },
    }
  })
}

const materialGroupItems = async (
  query: any,
  designId: string
): Promise<NodeItem[]> => {
  const { data: links } = await query.graph({
    entity: designRawMaterialGroupLink.entryPoint,
    filters: { design_id: designId },
    fields: ["raw_material_group_id"],
  })
  const ids = asArray<any>(links)
    .map((l) => l.raw_material_group_id)
    .filter(Boolean)
  if (!ids.length) return []

  const { data: groups } = await query.graph({
    entity: "raw_material_group",
    filters: { id: ids },
    fields: ["*"],
  })

  return asArray<any>(groups).map((g) => ({
    id: String(g.id),
    label: String(g.name || g.id),
    sublabel: g.description ? String(g.description) : null,
    status: g.status ? String(g.status) : null,
    href: null,
    props: [
      ...(g.status ? [{ key: "status", value: String(g.status) }] : []),
      ...(g.description
        ? [{ key: "description", value: String(g.description) }]
        : []),
    ],
    remove: {
      method: "DELETE" as const,
      path: `/admin/designs/${designId}/material-groups/${g.id}`,
      body: null,
      label: "Unpin",
      confirm: `Unpin ${g.name || "this group"}? The group itself is untouched — only this design stops resolving materials through it.`,
    },
  }))
}

const orderItems = async (query: any, designId: string): Promise<NodeItem[]> => {
  const { data: links } = await query.graph({
    entity: designOrderLink.entryPoint,
    filters: { design_id: designId },
    fields: ["order_id"],
  })
  const ids = asArray<any>(links)
    .map((l) => l.order_id)
    .filter(Boolean)
  if (!ids.length) return []

  const { data: orders } = await query.graph({
    entity: "order",
    filters: { id: ids },
    fields: ["id", "display_id", "status", "email", "created_at"],
  })

  return asArray<any>(orders).map((o) => ({
    id: String(o.id),
    label: o.display_id ? `#${o.display_id}` : String(o.id),
    sublabel: o.email ? String(o.email) : null,
    status: o.status ? String(o.status) : null,
    href: `/orders/${o.id}`,
    props: [
      ...(o.status ? [{ key: "status", value: String(o.status) }] : []),
      ...(o.created_at
        ? [{ key: "placed", value: new Date(o.created_at).toLocaleDateString() }]
        : []),
    ],
    // A design is not detached from an order it was sold on. That is history.
    remove: null,
  }))
}

const peopleItems = async (query: any, designId: string): Promise<NodeItem[]> => {
  const { data: links } = await query.graph({
    entity: designPersonLink.entryPoint,
    filters: { design_id: designId },
    fields: ["person_id"],
  })
  const ids = asArray<any>(links)
    .map((l) => l.person_id)
    .filter(Boolean)
  if (!ids.length) return []

  const { data: people } = await query.graph({
    entity: "person",
    filters: { id: ids },
    fields: ["id", "first_name", "last_name", "email"],
  })

  return asArray<any>(people).map((p) => ({
    id: String(p.id),
    label: [p.first_name, p.last_name].filter(Boolean).join(" ") || String(p.id),
    sublabel: p.email ? String(p.email) : null,
    status: null,
    href: `/persons/${p.id}`,
    props: p.email ? [{ key: "email", value: String(p.email) }] : [],
    remove: null,
  }))
}

const specificationItems = async (
  query: any,
  designId: string
): Promise<NodeItem[]> => {
  const design = await loadDesign(query, designId, ["specifications.*"])
  return asArray<any>(design.specifications).map((sp) => ({
    id: String(sp.id),
    label: String(sp.title || sp.technique || sp.id),
    sublabel: sp.technique ? String(sp.technique) : null,
    status: null,
    href: `/designs/${designId}`,
    props: [
      ...(sp.technique ? [{ key: "technique", value: String(sp.technique) }] : []),
      ...(sp.notes ? [{ key: "notes", value: String(sp.notes) }] : []),
    ],
    remove: null,
  }))
}

/**
 * Node key → its members.
 *
 * 🔴 Keyed by KEY, like every other registry in this feature. Two nodes on
 * this spine are of type `design` and point at different records; a map keyed
 * by type would list the wrong one's members.
 */
const RESOLVERS: Record<
  string,
  (query: any, designId: string) => Promise<NodeItem[]>
> = {
  inventory: inventoryItems,
  components: componentItems,
  tasks: taskItems,
  partners: partnerItems,
  runs: runItems,
  consumption: consumptionItems,
  materials: materialGroupItems,
  orders: orderItems,
  people: peopleItems,
  specifications: specificationItems,
}

/** Which node keys can list their members — the drawer asks before fetching. */
export const DESIGN_ITEM_NODES = Object.keys(RESOLVERS)

export const resolveDesignItems = async (
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
