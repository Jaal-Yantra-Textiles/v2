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
}: {
  node: GraphNode
  mode?: ActionRail
}) => {
  const resolved: ActionRail = mode ?? (node.action ? "action" : node.href ? "open" : "none")

  if (resolved === "none") {
    return null
  }

  return (
    <div className="border-t px-6 py-3">
      {resolved === "action" && node.action ? (
        node.action.href ? (
          <Link to={node.action.href}>
            <Button variant="secondary" size="small">
              {node.action.label}
            </Button>
          </Link>
        ) : (
          <Button variant="secondary" size="small" disabled>
            {node.action.label}
          </Button>
        )
      ) : node.href ? (
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
