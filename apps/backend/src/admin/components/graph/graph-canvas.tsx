import { Text } from "@medusajs/ui"
import { useId } from "react"

import type { GraphEdge, GraphNode } from "../../hooks/api/graph"

/**
 * The canvas itself: spine on the left, neighbours in columns to its right,
 * one curved edge each. Pure presentation — it fetches nothing and decides
 * nothing about which nodes to show.
 *
 * Shared by the in-page section and the full-screen workspace so the two can
 * never drift into looking like different products.
 */

export const NODE_W = 176
export const NODE_H = 62
const COL_GAP = 40
const ROW_GAP = 16
const SPINE_W = 168
const CANVAS_PAD = 20
/**
 * The gutter in the balanced layout. Wider than COL_GAP on purpose: the edge
 * LABEL is centred in this gap, and at 40px real field names ("inventory_item",
 * "consumption_log") overflowed onto the node boxes and read as truncated
 * nonsense. The workspace has width to spare — spend it here.
 */
const BALANCED_GAP = 120

type Placed = GraphNode & { x: number; y: number; side: "left" | "right" }

/** Columns to the right of the spine, filled top-down. */
export const place = (nodes: GraphNode[], maxRows: number) => {
  const cols = Math.max(1, Math.ceil(nodes.length / maxRows))
  const rows = Math.ceil(nodes.length / cols) || 1
  const placed: Placed[] = nodes.map((n, i) => {
    const col = Math.floor(i / rows)
    const row = i % rows
    return {
      ...n,
      side: "right" as const,
      x: CANVAS_PAD + SPINE_W + COL_GAP + col * (NODE_W + COL_GAP),
      y: CANVAS_PAD + row * (NODE_H + ROW_GAP),
    }
  })
  const height = CANVAS_PAD * 2 + rows * NODE_H + (rows - 1) * ROW_GAP
  const width =
    CANVAS_PAD * 2 + SPINE_W + COL_GAP + cols * NODE_W + (cols - 1) * COL_GAP
  return { placed, height: Math.max(height, 220), width, spineX: CANVAS_PAD }
}

/**
 * Spine in the middle, neighbours to both sides.
 *
 * 🔴 This exists because of what the stacked-column layout DRAWS, not because
 * it looks nicer. With two columns every edge to the far column passes behind
 * the near column's boxes, which are opaque — so the line appears to emerge
 * from a neighbour's right edge and land on the next one, reading as
 * "Production runs → Inventory". On a view whose entire subject is which edges
 * exist, inventing edges between neighbours is the worst thing it could do.
 *
 * One column per side means an edge never crosses a node: left-hand edges
 * leave the spine going left, right-hand ones going right.
 */
export const placeBalanced = (nodes: GraphNode[]) => {
  const rightCount = Math.ceil(nodes.length / 2)
  const rows = Math.max(rightCount, nodes.length - rightCount, 1)
  const spineX = CANVAS_PAD + NODE_W + BALANCED_GAP

  const placed: Placed[] = nodes.map((n, i) => {
    const side: "left" | "right" = i < rightCount ? "right" : "left"
    const row = side === "right" ? i : i - rightCount
    return {
      ...n,
      side,
      x: side === "right" ? spineX + SPINE_W + BALANCED_GAP : CANVAS_PAD,
      y: CANVAS_PAD + row * (NODE_H + ROW_GAP),
    }
  })

  const height = CANVAS_PAD * 2 + rows * NODE_H + (rows - 1) * ROW_GAP
  const width = CANVAS_PAD * 2 + NODE_W * 2 + BALANCED_GAP * 2 + SPINE_W
  return { placed, height: Math.max(height, 220), width, spineX }
}

export const stateStyles = (state: string, selected: boolean) => {
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

type Props = {
  spine: GraphNode
  spineKey: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedKey: string
  onSelect: (key: string) => void
  /** Rows before a second column starts. Ignored when layout is "balanced". */
  maxRows?: number
  /**
   * "columns"  — spine on the left, neighbours stacked to its right (the card).
   * "balanced" — spine centred, neighbours to both sides (the workspace).
   */
  layout?: "columns" | "balanced"
}

export const GraphCanvas = ({
  spine,
  spineKey,
  nodes,
  edges,
  selectedKey,
  onSelect,
  maxRows = 4,
  layout = "columns",
}: Props) => {
  /**
   * 🔴 Unique per instance: these marker ids land in the DOM, and the
   * workspace can render over a page that already holds a graph. Duplicate ids
   * make the second canvas silently borrow the first's arrowheads.
   */
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "")
  const arrow = `arrow-${uid}`
  const arrowAbsent = `arrow-absent-${uid}`

  const { placed, height, width, spineX } =
    layout === "balanced" ? placeBalanced(nodes) : place(nodes, maxRows)
  const spineY = Math.max(CANVAS_PAD, height / 2 - NODE_H / 2)
  const edgeFor = (key: string) => edges.find((e) => e.to === key)

  return (
    <div className="relative" style={{ height, minWidth: width }}>
      <svg
        width={width}
        height={height}
        className="absolute left-0 top-0"
        aria-hidden="true"
      >
        <defs>
          <marker
            id={arrow}
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
            id={arrowAbsent}
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
          // Leave the spine on the side the node actually sits, and land on
          // the edge of the box that faces it.
          const goingLeft = n.side === "left"
          const x1 = goingLeft ? spineX : spineX + SPINE_W
          const y1 = spineY + NODE_H / 2
          const x2 = goingLeft ? n.x + NODE_W + 7 : n.x - 7
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
                // `currentColor` needs a TEXT colour class to inherit from.
                // `text-ui-border-strong` is not a class the preset emits — it
                // renders nothing and the stroke falls back to black, silently.
                className={absent ? undefined : "text-ui-fg-muted"}
                markerEnd={`url(#${absent ? arrowAbsent : arrow})`}
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

      <button
        type="button"
        onClick={() => onSelect(spineKey)}
        className={`${stateStyles("present", selectedKey === spineKey)} bg-ui-bg-subtle`}
        style={{ left: spineX, top: spineY, width: SPINE_W, height: NODE_H }}
      >
        <Text size="small" weight="plus" className="truncate">
          {spine.label}
        </Text>
        <Text size="xsmall" className="text-ui-fg-muted truncate">
          {spine.sublabel}
        </Text>
      </button>

      {placed.map((n) => (
        <button
          type="button"
          key={n.key}
          onClick={() => onSelect(n.key)}
          className={stateStyles(n.state, selectedKey === n.key)}
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
  )
}
