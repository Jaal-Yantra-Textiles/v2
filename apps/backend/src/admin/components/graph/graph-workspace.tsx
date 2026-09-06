import { useMemo } from "react"
import { useSearchParams } from "react-router-dom"
import { Badge, Button, Heading, Skeleton, Text } from "@medusajs/ui"

import { useEntityGraph, type GraphNode } from "../../hooks/api/graph"
import { RouteDrawer } from "../modal/route-drawer/route-drawer"
import { GraphCanvas } from "./graph-canvas"
import {
  NodeInspectorActions,
  NodeInspectorBody,
  NodeInspectorHeader,
} from "./node-inspector"
import { GraphCreateModal } from "./graph-create-modal"

/**
 * The graph as the WORKSPACE rather than a card in a column (#1847 step 2).
 *
 * The card version has to share a `TwoColumnPage.Main` slot, which clips the
 * right-hand column of nodes behind the inspector — visible the moment it is
 * rendered against a design with ten neighbours. Here the canvas gets the
 * whole screen and the inspector moves into a drawer.
 *
 * 🔴 SELECTION LIVES IN THE URL (`?node=`), not in component state. Two
 * reasons, both learned the hard way in this codebase:
 *
 *   - `RouteDrawer` closes by NAVIGATING (`navigate(prev)`), so a drawer whose
 *     open/closed state is React state and whose close is a navigation will
 *     disagree with itself the moment the user hits Back.
 *   - A node's detail is worth linking to. "The product edge on this design is
 *     absent" is a thing one person sends another.
 *
 * `prev` is pinned to this workspace's own URL. Left at its `".."` default the
 * drawer would close by walking up a segment and take the whole workspace with
 * it.
 */

interface Props {
  spine: string
  id: string
  title?: string
  /** The workspace's own URL — where closing the node drawer returns to. */
  selfHref: string
}

export const GraphWorkspace = ({ spine, id, title = "Graph", selfHref }: Props) => {
  const { graph, isLoading, isError, error } = useEntityGraph(spine, id)
  const [params, setParams] = useSearchParams()

  const selectedKey = params.get("node")
  const showAbsent = params.get("absent") !== "0"

  const nodes = graph?.nodes ?? []
  const edges = graph?.edges ?? []
  const spineKey = graph?.spine.key ?? spine

  const visible = useMemo(
    () => (showAbsent ? nodes : nodes.filter((n) => n.state !== "absent")),
    [nodes, showAbsent]
  )

  const select = (key: string) => {
    const next = new URLSearchParams(params)
    next.set("node", key)
    setParams(next, { replace: false })
  }

  const toggleAbsent = () => {
    const next = new URLSearchParams(params)
    if (showAbsent) {
      next.set("absent", "0")
    } else {
      next.delete("absent")
    }
    setParams(next, { replace: true })
  }

  const active: GraphNode | undefined = !selectedKey
    ? undefined
    : selectedKey === spineKey
      ? graph?.spine
      : nodes.find((n) => n.key === selectedKey)

  const activeEdge =
    active && active.key !== spineKey
      ? edges.find((e) => e.to === active.key)
      : undefined

  if (isLoading) {
    return (
      <div className="flex h-full w-full flex-col gap-y-4 p-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-full w-full" />
      </div>
    )
  }

  // Never render a failure as emptiness — see EntityGraph for why.
  if (isError || !graph) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-y-2 p-8">
        <Badge size="2xsmall" color="red" rounded="full">
          unavailable
        </Badge>
        <Text size="small" className="text-ui-fg-subtle">
          The graph could not be loaded.
        </Text>
        <Text size="xsmall" className="text-ui-fg-muted break-words">
          {(error as Error | undefined)?.message ?? "The request returned no graph."}
        </Text>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between gap-x-2 border-b px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">{title}</Heading>
          <Text size="small" className="text-ui-fg-muted">
            {graph.spine.label}
          </Text>
          <Badge size="2xsmall" color="grey" rounded="full">
            {graph.summary.links} linked
          </Badge>
          {graph.summary.derived > 0 && (
            <Badge size="2xsmall" color="orange" rounded="full">
              {graph.summary.derived} derived
            </Badge>
          )}
          {graph.summary.absent > 0 && (
            <Badge size="2xsmall" color="red" rounded="full">
              {graph.summary.absent} absent
            </Badge>
          )}
        </div>
        <Button variant="secondary" size="small" onClick={toggleAbsent}>
          {showAbsent ? "Hide absent edges" : "Show absent edges"}
        </Button>
      </div>

      {/*
        🔴 Fewer rows here, not more. `maxRows` is the point at which a SECOND
        COLUMN starts, so raising it stacks everything into one tall column and
        wastes the width the modal exists to provide — which is exactly what
        the first render of this screen did. Four keeps the neighbours spread
        across columns; the room the workspace buys is horizontal.
      */}
      <div className="flex flex-1 items-center justify-center overflow-auto p-6">
        <GraphCanvas
          spine={graph.spine}
          spineKey={spineKey}
          nodes={visible}
          edges={edges}
          selectedKey={selectedKey ?? ""}
          onSelect={select}
          layout="balanced"
        />
      </div>

      {/*
        READ and EDIT live in the drawer; CREATE is a StackedFocusModal opened
        from inside it. The stacked modal's Trigger MUST sit inside its own
        Root — a `StackedFocusModal.Trigger` placed outside closes the modal
        underneath it instead of opening anything.
      */}
      {active && (
        <RouteDrawer prev={selfHref}>
          {/*
            🔴 `RouteDrawer.Title` is REQUIRED, not decorative. Radix logs
            "`DialogContent` requires a `DialogTitle`" and screen-reader users
            get an unnamed dialog without it — a plain <Heading> inside the
            header does not satisfy it. Caught by reading the console, not by
            any test.
          */}
          <RouteDrawer.Header>
            <RouteDrawer.Title asChild>
              <span className="sr-only">{active.label}</span>
            </RouteDrawer.Title>
            <RouteDrawer.Description asChild>
              <span className="sr-only">
                {activeEdge?.reason ??
                  `${active.label} on ${graph.spine.label}, ${active.state}.`}
              </span>
            </RouteDrawer.Description>
            <NodeInspectorHeader node={active} />
          </RouteDrawer.Header>
          <RouteDrawer.Body className="p-0">
            <NodeInspectorBody node={active} edge={activeEdge} />
            <GraphCreateModal node={active} />
            <NodeInspectorActions node={active} />
          </RouteDrawer.Body>
        </RouteDrawer>
      )}
    </div>
  )
}
