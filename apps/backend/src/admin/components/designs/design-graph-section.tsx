import { useMemo, useState } from "react"
import { Badge, Button, Container, Heading, Skeleton, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"

import type { AdminDesign } from "../../hooks/api/designs"
import {
  useDesignGraph,
  type DesignGraphEdge,
  type DesignGraphNode,
} from "../../hooks/api/designs"

interface Props {
  design: AdminDesign
}

/**
 * The design spine as a graph (#1847).
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
 * An absent edge is the thing the twelve stacked sections could never show:
 * a section renders what IS there, and this is about what is not.
 */

const NODE_W = 176
const NODE_H = 62
const COL_GAP = 40
const ROW_GAP = 16
const SPINE_W = 168
const CANVAS_PAD = 20

type Placed = DesignGraphNode & { x: number; y: number }

/** Two columns to the right of the spine, filled top-down. */
const place = (nodes: DesignGraphNode[]) => {
  const cols = nodes.length > 4 ? 2 : 1
  const rows = Math.ceil(nodes.length / cols)
  const placed: Placed[] = nodes.map((n, i) => {
    const col = Math.floor(i / rows)
    const row = i % rows
    return {
      ...n,
      x: CANVAS_PAD + SPINE_W + COL_GAP + col * (NODE_W + COL_GAP),
      y: CANVAS_PAD + row * (NODE_H + ROW_GAP),
    }
  })
  const height = CANVAS_PAD * 2 + rows * NODE_H + (rows - 1) * ROW_GAP
  const width =
    CANVAS_PAD * 2 + SPINE_W + COL_GAP + cols * NODE_W + (cols - 1) * COL_GAP
  return { placed, height: Math.max(height, 220), width }
}

const stateStyles = (state: string, selected: boolean) => {
  const base =
    "absolute box-border rounded-lg px-3 py-2 text-left transition-shadow cursor-pointer"
  const ring = selected ? "shadow-borders-focus" : ""
  if (state === "absent") {
    return `${base} ${ring} border border-dashed border-ui-tag-red-border bg-ui-bg-base`
  }
  if (state === "derived") {
    return `${base} ${ring} border border-dashed border-ui-border-strong bg-ui-bg-base`
  }
  return `${base} ${ring} border border-ui-border-base bg-ui-bg-base shadow-elevation-card-rest`
}

export const DesignGraphSection = ({ design }: Props) => {
  const { graph, isLoading } = useDesignGraph(design.id)
  const [selected, setSelected] = useState<string | null>(null)
  const [showAbsent, setShowAbsent] = useState(true)

  const nodes = graph?.nodes ?? []
  const edges = graph?.edges ?? []

  const visible = useMemo(
    () => (showAbsent ? nodes : nodes.filter((n) => n.state !== "absent")),
    [nodes, showAbsent]
  )

  const { placed, height, width } = useMemo(() => place(visible), [visible])

  const edgeFor = (key: string): DesignGraphEdge | undefined =>
    edges.find((e) => e.to === key)

  /**
   * Default the inspector to the first absent node when there is one — the
   * whole point of the view is the edge that is missing, so it should not take
   * a click to find it. Falls back to the spine.
   */
  const activeKey =
    selected ??
    visible.find((n) => n.state === "absent")?.key ??
    "design"

  const active: DesignGraphNode | undefined =
    activeKey === "design"
      ? graph?.spine
      : visible.find((n) => n.key === activeKey)

  const activeEdge = active && active.key !== "design" ? edgeFor(active.key) : undefined

  if (isLoading) {
    return (
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <Heading level="h2">Graph</Heading>
        </div>
        <div className="px-6 py-6">
          <Skeleton className="h-[220px] w-full" />
        </div>
      </Container>
    )
  }

  if (!graph) {
    return null
  }

  const spineY = Math.max(CANVAS_PAD, height / 2 - NODE_H / 2)

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">Graph</Heading>
          <Badge size="2xsmall" color="grey" rounded="full">
            {graph.summary.links} linked
          </Badge>
          {graph.summary.absent > 0 && (
            <Badge size="2xsmall" color="red" rounded="full">
              {graph.summary.absent} absent
            </Badge>
          )}
        </div>
        <Button
          variant="secondary"
          size="small"
          onClick={() => setShowAbsent((v) => !v)}
        >
          {showAbsent ? "Hide absent edges" : "Show absent edges"}
        </Button>
      </div>

      <div className="flex flex-col lg:flex-row">
        {/* canvas */}
        <div className="flex-1 overflow-x-auto">
          <div className="relative" style={{ height, minWidth: width }}>
            <svg
              width={width}
              height={height}
              className="absolute left-0 top-0"
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="dg-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 9 5 L 0 9 z" className="fill-ui-fg-muted" />
                </marker>
                <marker
                  id="dg-arrow-absent"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 9 5 L 0 9 z" fill="#9F1239" />
                </marker>
              </defs>

              {placed.map((n) => {
                const edge = edgeFor(n.key)
                const absent = n.state === "absent"
                const x1 = CANVAS_PAD + SPINE_W
                const y1 = spineY + NODE_H / 2
                const x2 = n.x - 7
                const y2 = n.y + NODE_H / 2
                const mid = x1 + (x2 - x1) / 2
                return (
                  <g key={n.key}>
                    <path
                      d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                      fill="none"
                      strokeWidth={1.5}
                      stroke={absent ? "#9F1239" : "currentColor"}
                      strokeDasharray={
                        absent || n.state === "derived" ? "4 3.5" : undefined
                      }
                      // `currentColor` needs a TEXT colour class to inherit
                      // from. `text-ui-border-strong` is not a class the preset
                      // emits — it renders nothing and the stroke falls back to
                      // black, silently.
                      className={absent ? undefined : "text-ui-fg-muted"}
                      markerEnd={`url(#${absent ? "dg-arrow-absent" : "dg-arrow"})`}
                    />
                    {edge?.label && (
                      <text
                        x={mid}
                        y={y2 - 6}
                        textAnchor="middle"
                        fontSize={10}
                        fill={absent ? "#9F1239" : "currentColor"}
                        className={absent ? undefined : "text-ui-fg-muted"}
                      >
                        {edge.label}
                      </text>
                    )}
                  </g>
                )
              })}
            </svg>

            {/* spine */}
            <button
              type="button"
              onClick={() => setSelected("design")}
              className={`${stateStyles("present", activeKey === "design")} bg-ui-bg-subtle`}
              style={{ left: CANVAS_PAD, top: spineY, width: SPINE_W, height: NODE_H }}
            >
              <Text size="small" weight="plus" className="truncate">
                {graph.spine.label}
              </Text>
              <Text size="xsmall" className="text-ui-fg-muted truncate">
                {graph.spine.sublabel}
              </Text>
            </button>

            {placed.map((n) => (
              <button
                type="button"
                key={n.key}
                onClick={() => setSelected(n.key)}
                className={stateStyles(n.state, activeKey === n.key)}
                style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
              >
                <Text
                  size="small"
                  weight="plus"
                  className={`truncate ${n.state === "absent" ? "text-ui-tag-red-text" : ""}`}
                >
                  {n.label}
                </Text>
                <Text
                  size="xsmall"
                  className={`truncate ${
                    n.state === "absent" ? "text-ui-tag-red-text" : "text-ui-fg-muted"
                  }`}
                >
                  {n.sublabel ?? `${n.count}`}
                </Text>
              </button>
            ))}
          </div>
        </div>

        {/* inspector */}
        <div className="w-full border-t lg:w-[280px] lg:border-l lg:border-t-0">
          {active && (
            <>
              <div className="flex items-start justify-between gap-x-2 px-6 py-4">
                <div className="flex flex-col">
                  <Text size="xsmall" className="text-ui-fg-muted uppercase">
                    Selected
                  </Text>
                  <Heading level="h3" className="truncate">
                    {active.label}
                  </Heading>
                </div>
                <Badge
                  size="2xsmall"
                  rounded="full"
                  color={active.state === "absent" ? "red" : "grey"}
                >
                  {active.state === "absent" ? "absent" : active.sublabel ?? "linked"}
                </Badge>
              </div>

              <div className="divide-y border-t">
                {active.props.map((p) => (
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

              {activeEdge?.reason && (
                <div className="border-t px-6 py-3">
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {activeEdge.reason}
                  </Text>
                </div>
              )}

              {(active.action || active.href) && (
                <div className="border-t px-6 py-3">
                  {active.action ? (
                    active.action.href ? (
                      <Link to={active.action.href}>
                        <Button variant="secondary" size="small">
                          {active.action.label}
                        </Button>
                      </Link>
                    ) : (
                      <Button variant="secondary" size="small" disabled>
                        {active.action.label}
                      </Button>
                    )
                  ) : (
                    <Link to={active.href!}>
                      <Button variant="secondary" size="small">
                        Open
                      </Button>
                    </Link>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Container>
  )
}
