import { Badge, Button, Heading, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"

import type { GraphEdge, GraphNode } from "../../hooks/api/graph"

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
 * the missing neighbour; a present one just opens it.
 *
 * An action with no href renders DISABLED rather than being hidden — the
 * reader should still learn what the missing step is called even where the
 * admin has no route for it yet.
 */
export const NodeInspectorActions = ({ node }: { node: GraphNode }) => {
  if (!node.action && !node.href) {
    return null
  }
  return (
    <div className="border-t px-6 py-3">
      {node.action ? (
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
      ) : (
        <Link to={node.href!}>
          <Button variant="secondary" size="small">
            Open
          </Button>
        </Link>
      )}
    </div>
  )
}

export const NodeInspectorHeader = ({ node }: { node: GraphNode }) => (
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
      color={node.state === "absent" ? "red" : "grey"}
    >
      {node.state === "absent" ? "absent" : (node.sublabel ?? "linked")}
    </Badge>
  </div>
)
