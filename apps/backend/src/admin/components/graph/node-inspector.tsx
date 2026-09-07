import { Badge, Button, Heading, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"

import type { GraphEdge, GraphNode } from "../../hooks/api/graph"
import type { ActionRail } from "./node-forms"

/**
 * What one node says about itself: its properties, why its edge is dashed, and
 * the action that would make the edge real.
 *
 * Shared by the in-page inspector column and the workspace's RouteDrawer, so
 * the reason text a reader sees is the same in both places.
 */

export const NodeInspectorBody = ({
  node,
  edge,
}: {
  node: GraphNode
  edge?: GraphEdge
}) => (
  <>
    <div className="divide-y border-t">
      {node.props.map((p) => (
        <div
          key={p.key}
          className="flex items-center justify-between gap-x-2 px-6 py-2"
        >
          <Text size="xsmall" className="text-ui-fg-muted truncate">
            {p.key}
          </Text>
          <Text size="small" weight="plus" className="truncate">
            {p.value}
          </Text>
        </div>
      ))}
    </div>

    {edge?.reason && (
      <div className="border-t px-6 py-3">
        <Text size="xsmall" className="text-ui-fg-subtle">
          {edge.reason}
        </Text>
      </div>
    )}
  </>
)

/**
 * The action rail. An absent node's action names the thing that would create
 * the missing neighbour; `open` is a drill-in to the neighbour's own page.
 *
 * `mode` is decided by `actionRail` in `node-forms.ts` — which of the two (if
 * either) earns a button depends on whether a form is already offered beside
 * it and on whether the href goes anywhere new. Defaults to the old behaviour
 * for the in-page inspector, which offers no forms.
 *
 * An action with no href renders DISABLED rather than being hidden — the
 * reader should still learn what the missing step is called even where the
 * admin has no route for it yet.
 */
export const NodeInspectorActions = ({
  node,
  mode,
  selfHref,
  workspaceHref,
}: {
  node: GraphNode
  mode?: ActionRail
  /**
   * The page this graph is embedded IN. Any action whose href equals it is a
   * link back to where the reader already is.
   */
  selfHref?: string
  /** The full-page workspace, where the forms live. */
  workspaceHref?: string
}) => {
  const resolved: ActionRail = mode ?? (node.action ? "action" : node.href ? "open" : "none")

  if (resolved === "none") {
    return null
  }

  /*
   * 🔴 An action that points at the page you are on is a dead button.
   *
   * Every absent node on the PARTNER spine names `/partners/:id` as where to
   * go — which is correct for a reader coming from a list, and useless in the
   * card embedded on that very page: "Add a payment method" rendered as a link
   * to the partner page, from the partner page. Nothing errors; the button
   * simply does nothing, which is the same shape as the superseded link-out
   * that kept rendering beside its replacement (#1854).
   *
   * The words are kept and the destination is corrected: the workspace, opened
   * on this node, which is where its create form actually is. Where there is
   * no workspace to send them to, the button is dropped rather than left dead.
   */
  const actionHref = node.action?.href
  const isSelfLink = !!actionHref && !!selfHref && actionHref === selfHref
  const redirected = isSelfLink
    ? workspaceHref
      ? `${workspaceHref}?node=${encodeURIComponent(node.key)}`
      : null
    : actionHref

  if (resolved === "action" && isSelfLink && !redirected) {
    return null
  }

  /*
   * Nothing left to draw — return null rather than an empty bordered strip.
   * A 12px rule under the card reads as a section that failed to load.
   */
  if (resolved === "open" && (!node.href || node.href === selfHref)) {
    return null
  }

  return (
    <div className="border-t px-6 py-3">
      {resolved === "action" && node.action ? (
        redirected ? (
          <Link to={redirected}>
            <Button variant="secondary" size="small">
              {node.action.label}
            </Button>
          </Link>
        ) : (
          <Button variant="secondary" size="small" disabled>
            {node.action.label}
          </Button>
        )
      ) : node.href && node.href !== selfHref ? (
        /*
         * 🔴 `!== selfHref` for the same reason. Most present nodes on the
         * partner spine carry the partner's own page as their href, so "Open"
         * offered to open the page it is rendered on.
         */
        <Link to={node.href}>
          <Button variant="secondary" size="small">
            Open
          </Button>
        </Link>
      ) : null}
    </div>
  )
}

export const NodeInspectorHeader = ({
  node,
  isPlaceholder = false,
}: {
  node: GraphNode
  /**
   * 🔴 A placeholder is `absent` for the AFFORDANCE rules — the model can hold
   * this neighbour and there is none, which is exactly what unlocks the create
   * form and blocks the edit form. But it must not be `absent` in the WORDS.
   *
   * Rendered, the red "absent" badge sat directly above the sentence saying
   * "Nothing is wrong", which is a contradiction the reader has to resolve.
   * A real absent edge means the model EXPECTED a neighbour and it is not
   * there; a placeholder only means someone opened the Add menu.
   */
  isPlaceholder?: boolean
}) => (
  <div className="flex items-start justify-between gap-x-2 px-6 py-4">
    <div className="flex flex-col">
      <Text size="xsmall" className="text-ui-fg-muted uppercase">
        Selected
      </Text>
      <Heading level="h3" className="truncate">
        {node.label}
      </Heading>
    </div>
    <Badge
      size="2xsmall"
      rounded="full"
      color={!isPlaceholder && node.state === "absent" ? "red" : "grey"}
    >
      {isPlaceholder
        ? "none yet"
        : node.state === "absent"
          ? "absent"
          : (node.sublabel ?? "linked")}
    </Badge>
  </div>
)
