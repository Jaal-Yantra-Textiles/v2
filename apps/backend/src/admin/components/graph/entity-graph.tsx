import { useMemo, useState } from "react"
import { Badge, Button, Container, Heading, Skeleton, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"

import { useEntityGraph, type GraphNode } from "../../hooks/api/graph"
import { GraphCanvas, canvasSize } from "./graph-canvas"
import { GraphViewport } from "./graph-viewport"
import {
  NodeInspectorActions,
  NodeInspectorBody,
  NodeInspectorHeader,
} from "./node-inspector"

/**
 * An entity and its neighbours, as a card on a page (#1847).
 *
 * Three edge states, and the third is why this exists:
 *
 *   present  — a declared link with something on the other end.
 *   derived  — true only through a shared record, never a link file.
 *   absent   — a "future edge": the model expects a neighbour and there is
 *              none. `production_run.approved_product_id` is the motivating
 *              case — written on every approval, read by nothing, so a run
 *              that was never listed for sale looks exactly like one that was.
 *
 * Spine-agnostic: the centre node and every neighbour come from the server's
 * spine resolver, so pointing it at a new spine is a prop change.
 *
 * For the full-screen version — the graph as the workspace rather than a card
 * in a column — see `GraphWorkspace`.
 */

interface Props {
  /** Registry key of the spine to centre on — "design", "partner", … */
  spine: string
  id: string
  title?: string
  /** Where the full-screen workspace lives, if this card should offer it. */
  expandHref?: string
}

export const EntityGraph = ({ spine, id, title = "Graph", expandHref }: Props) => {
  const { graph, isLoading, isError, error } = useEntityGraph(spine, id)
  const [selected, setSelected] = useState<string | null>(null)
  const [showAbsent, setShowAbsent] = useState(true)

  const nodes = graph?.nodes ?? []
  const edges = graph?.edges ?? []
  const spineKey = graph?.spine.key ?? spine

  const visible = useMemo(
    () => (showAbsent ? nodes : nodes.filter((n) => n.state !== "absent")),
    [nodes, showAbsent]
  )

  /**
   * Default the inspector to the first absent node when there is one — the
   * whole point of the view is the edge that is missing, so it should not take
   * a click to find it. Falls back to the spine.
   */
  const activeKey =
    selected ?? visible.find((n) => n.state === "absent")?.key ?? spineKey

  const active: GraphNode | undefined =
    activeKey === spineKey ? graph?.spine : visible.find((n) => n.key === activeKey)

  const activeEdge =
    active && active.key !== spineKey ? edges.find((e) => e.to === active.key) : undefined

  if (isLoading) {
    return (
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <Heading level="h2">{title}</Heading>
        </div>
        <div className="px-6 py-6">
          <Skeleton className="h-[220px] w-full" />
        </div>
      </Container>
    )
  }

  /**
   * 🔴 This returned `null` on failure, so a broken graph made the whole
   * section VANISH after its skeleton — indistinguishable from "not built yet",
   * and undiagnosable without opening devtools. A section that cannot load must
   * say so on screen: silence is the one state that teaches the reader nothing.
   */
  if (isError || !graph) {
    return (
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <Heading level="h2">{title}</Heading>
          <Badge size="2xsmall" color="red" rounded="full">
            unavailable
          </Badge>
        </div>
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            The graph could not be loaded.
          </Text>
          <Text size="xsmall" className="text-ui-fg-muted mt-1 break-words">
            {(error as Error | undefined)?.message ?? "The request returned no graph."}
          </Text>
        </div>
      </Container>
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">{title}</Heading>
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
        <div className="flex items-center gap-x-2">
          <Button
            variant="secondary"
            size="small"
            onClick={() => setShowAbsent((v) => !v)}
          >
            {showAbsent ? "Hide absent edges" : "Show absent edges"}
          </Button>
          {expandHref && (
            <Link to={expandHref}>
              <Button variant="secondary" size="small">
                Open workspace
              </Button>
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row">
        {/*
          🔴 The card gets the viewport too, now that it is the PRIMARY view of
          a design rather than a preview above the sections.
          `overflow-x-auto` was survivable while the summary cards below still
          said everything — the reader could ignore a cramped canvas. With
          those cards gone it is the only thing on the page that says it, and a
          graph you cannot pan is a graph that hides its own far column behind
          the inspector.

          A fixed height, because a `TwoColumnPage` slot has no height of its
          own to fill: without one the viewport measures zero, `fitScale`
          returns its unmeasured fallback, and nothing is drawn.
        */}
        {/*
          🔴 `min-w-0` is load-bearing. A flex child's default `min-width:auto`
          refuses to shrink below its content, and the balanced layout is ~760px
          wide — so the canvas pushed the inspector down to about 110px. The
          badge clipped to "ab", and the sentence explaining WHY an edge is
          dashed wrapped to two words a line. That sentence is the single most
          valuable thing in the card, and it was the first casualty.
        */}
        <div className="flex h-[420px] min-w-0 flex-1 flex-col">
          <GraphViewport
            content={canvasSize(visible, "balanced")}
            fitKey={`${visible.length}:${showAbsent}`}
          >
            <GraphCanvas
              spine={graph.spine}
              spineKey={spineKey}
              nodes={visible}
              edges={edges}
              selectedKey={activeKey}
              onSelect={setSelected}
              layout="balanced"
            />
          </GraphViewport>
        </div>

        {/* `shrink-0`, for the same reason: 280px is a floor, not a wish. */}
        <div className="w-full shrink-0 border-t lg:w-[280px] lg:border-l lg:border-t-0">
          {active && (
            <>
              <NodeInspectorHeader node={active} />
              <NodeInspectorBody node={active} edge={activeEdge} />
              <NodeInspectorActions node={active} />
            </>
          )}
        </div>
      </div>
    </Container>
  )
}
