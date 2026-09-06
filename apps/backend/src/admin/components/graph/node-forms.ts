import type { GraphEdgeState } from "../../hooks/api/graph"

/**
 * What a selected node OFFERS: a create form, an edit form, or neither.
 *
 * This is deliberately a pure function rather than a chain of `&&` inside the
 * JSX. Both mistakes it can make are invisible on screen:
 *
 *   - Offering EDIT on an absent node opens a form over a record that does not
 *     exist. There is nothing to render an error against — the drawer just
 *     shows empty fields, and saving would create a second thing or 404.
 *   - Withholding CREATE on an absent node hides the queue the graph exists to
 *     show. A missing button reads as "nothing to do here", which is the exact
 *     opposite of what a dashed edge means.
 *
 * Neither shows up as a crash, so the rules are tested instead of eyeballed.
 */
export type NodeAffordance = {
  /** Render the create/link form registered for this node. */
  create: boolean
  /** Render the edit form registered for this node. */
  edit: boolean
  /**
   * No form for this type, but the node names the step that would create it —
   * render the evidence card with that action instead of nothing.
   */
  action: boolean
}

/**
 * 🔴 Forms are registered against a node's KEY, not its type.
 *
 * Two nodes on the design spine share the type `design`: the spine itself
 * (`design`) and "Revised from" (`revision`), which points at a DIFFERENT
 * record. Keyed by type, the edit form registered for the design would have
 * been offered on the revision node and — because the form reads the design id
 * from the URL — would have silently edited the design you were looking at
 * instead of the one you clicked. A key is the node's position on the spine,
 * which is exactly what a form is written against.
 */
export type AffordanceNode = {
  key: string
  state: GraphEdgeState
  action: { label: string; href: string | null } | null
}

export type FormRegistry = {
  create: ReadonlySet<string>
  edit: ReadonlySet<string>
}

export const nodeAffordance = (
  node: AffordanceNode,
  forms: FormRegistry
): NodeAffordance => {
  const create = forms.create.has(node.key)

  return {
    create,
    /*
     * 🔴 `state !== "absent"`, not `state === "present"`. A `derived` node IS a
     * real record — it is reached through a shared row rather than a link file,
     * which says nothing about whether it can be edited. Narrowing this to
     * "present" would silently drop the edit button on exactly the nodes whose
     * relationship is already the hardest to see.
     */
    edit: node.state !== "absent" && forms.edit.has(node.key),
    // Only ever a FALLBACK. With a real form the action card would be a second,
    // worse route to the same thing.
    action: !create && node.state === "absent" && !!node.action,
  }
}

/** Nothing to offer at all — the caller renders no footer rather than an empty one. */
export const hasAffordance = (a: NodeAffordance) => a.create || a.edit || a.action

/**
 * Whether the node's own action rail — the link out to the flow that would
 * create this neighbour — still earns its place.
 *
 * 🔴 It does not once a form is offered. Both buttons do the same job, but the
 * rail's NAVIGATES: pressed from inside the workspace it tears the graph down
 * to go to a route that opens the very form sitting next to it. Rendered live,
 * the absent inventory node showed "Create the missing inventory" directly
 * above "Link inventory" — two buttons, one of them a trap.
 */
export const showsActionRail = (a: NodeAffordance) => !a.create && !a.edit
