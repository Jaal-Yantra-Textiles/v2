import { useMemo } from "react"
import { useSearchParams } from "react-router-dom"
import { Badge, Button, Heading, Skeleton, Text } from "@medusajs/ui"

import { useEntityGraph, type GraphNode } from "../../hooks/api/graph"
import { RouteDrawer } from "../modal/route-drawer/route-drawer"
import { GraphCanvas, canvasSize } from "./graph-canvas"
import { GraphViewport } from "./graph-viewport"
import {
  NodeInspectorActions,
  NodeInspectorBody,
  NodeInspectorHeader,
} from "./node-inspector"
import { GraphCreateModal, GraphEditModal } from "./graph-create-modal"
import { addAnotherFor, registryFor } from "./graph-forms"
import { NodeAddAnother, NodeItemList } from "./node-items"
import { actionRail, nodeAffordance } from "./node-forms"

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

  // What this node offers: a create form, an edit form, or the action rail that
  // names the step. The rules are in `node-forms` and tested there.
  const affordance = active ? nodeAffordance(active, registryFor(spine)) : undefined

  // What the rail underneath the form buttons should say, if anything.
  const rail =
    active && affordance
      ? actionRail(affordance, active, graph?.spine.href ?? null)
      : "none"

  /*
   * 🔴 Ask for members only where the SERVER says there are members to list.
   * `graph.itemNodes` is the spine's own declaration. Inferring it from
   * `count > 0` would fetch on `product` and `revision` — single records with
   * no rows — and render "Nothing linked yet" beneath a node that is a real,
   * present neighbour.
   */
  const listsItems = !!active && (graph?.itemNodes ?? []).includes(active.key)

  const another = active ? addAnotherFor(spine, active.key) : undefined

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
        Pan and zoom, so the canvas is no longer limited to what fits.

        🔴 `fitKey` varies with the SHAPE of what is drawn — the visible node
        count and whether absent edges are shown — not with the graph object.
        Keyed on the object it would refit on every parent render and snatch
        the reader's pan back; keyed on nothing, toggling absent edges would
        leave half the graph off-screen.
      */}
      <GraphViewport
        content={canvasSize(visible, "balanced")}
        fitKey={`${visible.length}:${showAbsent}`}
      >
        <GraphCanvas
          spine={graph.spine}
          spineKey={spineKey}
          nodes={visible}
          edges={edges}
          selectedKey={selectedKey ?? ""}
          onSelect={select}
          layout="balanced"
        />
      </GraphViewport>

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
            {/*
              The members, and the only place in the graph that can take one
              off. Above the create form on purpose: the reader clicked a node
              that already has neighbours, so "which ones" comes before "add
              one more".
            */}
            {listsItems && (
              <NodeItemList spine={spine} id={id} node={active} />
            )}
            {/*
              Create first, then edit: on an absent node only the first of the
              two renders, and it is the one the dashed edge is asking for.
            */}
            <GraphCreateModal node={active} spine={spine} />
            <GraphEditModal node={active} spine={spine} />
            {/*
              The rail never repeats a form, and never offers an "Open" that
              lands on the page this graph is about — but a real drill-in stays,
              because with the summary sections gone it is the only route to the
              full list.
            */}
            {/*
              Present-node-only, and never on an absent one where the create
              form or the rail below is already asking for the same thing.
            */}
            {another && (
              <NodeAddAnother
                node={active}
                label={another.label}
                href={another.href(id)}
              />
            )}
            <NodeInspectorActions node={active} mode={rail} />
          </RouteDrawer.Body>
        </RouteDrawer>
      )}
    </div>
  )
}
