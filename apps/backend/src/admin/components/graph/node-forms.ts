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
 * What the node's action rail should render underneath the form buttons.
 *
 *   - `action` — the link out to the flow that creates this neighbour.
 *   - `open`   — a drill-in to the neighbour's own page.
 *   - `none`   — nothing worth a button.
 *
 * 🔴 The rail must not repeat a form. Both do the same job, but the rail's
 * button NAVIGATES: pressed from inside the workspace it tears the graph down
 * to reach a route that opens the very form sitting next to it. Rendered live,
 * the absent inventory node showed "Create the missing inventory" directly
 * above "Link inventory".
 *
 * 🔴 And "Open" must not point back at the page the graph is about. Several
 * nodes carry the spine's own href as a fallback — from in here that button
 * closes the workspace to arrive where you already were. But where the href is
 * a REAL drill-in (`/designs/:id/tasks`, the partner list, the design a
 * revision came from) it is kept even when a form is offered: the form creates
 * a neighbour, the drill-in reads the ones that exist, and after the summary
 * sections came off the page this is the only route left to them.
 */
export type ActionRail = "action" | "open" | "none"

export const actionRail = (
  affordance: NodeAffordance,
  node: {
    href: string | null
    action: { label: string; href: string | null } | null
    /** #1857. A node that RUNS something already answers its own question. */
    act?: { previewBody: unknown | null; applyBody: unknown | null } | null
  },
  spineHref: string | null
): ActionRail => {
  const hasForm = affordance.create || affordance.edit

  /*
   * 🔴 The rail must not repeat the ACT, for the same reason it must not
   * repeat a form — and this one was worse, because the two are word for word
   * identical. Rendered, the partner's WhatsApp node showed "Verify the
   * number" twice: the act, which sends the template, directly above the old
   * `action`, which has a null href and is therefore a DEAD DISABLED BUTTON.
   *
   * That is #1854 exactly — a new affordance that did not replace the old one
   * and kept rendering beside it. `open` survives, because a drill-in to the
   * neighbour's own page is a different question from running a job.
   */
  if (!hasForm && node.action && !node.act) {
    return "action"
  }

  if (node.href && node.href !== spineHref) {
    return "open"
  }

  return "none"
}

/**
 * What the ACT rail renders (#1857).
 *
 *   - `preview-then-apply` — a dry run exists; the first press previews and
 *     Apply is unreachable until one comes back.
 *   - `confirm-once`       — there IS no dry run. One button, behind the
 *     confirm, and pressing it does the thing.
 *   - `none`               — this node runs nothing.
 *
 * 🔴 The distinction is the whole safety property, and getting it backwards is
 * invisible on screen. The first version pressed preview unconditionally, so
 * an act with `previewBody: null` would have POSTed to the real endpoint with
 * no body while the button still said preview. The two acts that arrived next
 * were "verify the WhatsApp number", which SENDS A MESSAGE to a real partner,
 * and "verify the domain", which pushes live DNS. Neither has a dry run, and
 * for both the safe-looking press was the entire action.
 */
export type ActRail = "preview-then-apply" | "confirm-once" | "none"

export const actRail = (
  act: { previewBody: unknown | null; applyBody: unknown | null } | null | undefined
): ActRail => {
  if (!act) {
    return "none"
  }
  return act.previewBody !== null ? "preview-then-apply" : "confirm-once"
}

/**
 * Whether the Apply button may be drawn yet.
 *
 * 🔴 `previewed` is required and is not the same as "a preview exists". An
 * Apply drawn before the operator has read what would change is the guard
 * removed — and on this board the reason for the guard is that three sweeps
 * running were topped by a pair that turned out to be correct state.
 */
export const canApply = (
  act: { previewBody: unknown | null; applyBody: unknown | null } | null | undefined,
  previewed: boolean
): boolean => {
  if (!act || act.applyBody === null) {
    return false
  }
  // With no dry run there is no separate Apply — the single button IS the act.
  return actRail(act) === "preview-then-apply" && previewed
}
