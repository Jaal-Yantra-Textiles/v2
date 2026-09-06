import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { IconButton, Text } from "@medusajs/ui"
import { Minus, Plus } from "@medusajs/icons"

import {
  MAX_SCALE,
  MIN_SCALE,
  centreOffset,
  fitScale,
  isPan,
  stepScale,
  zoomAbout,
} from "./viewport-math"

/**
 * Pan and zoom around whatever canvas is handed to it (#1847 step 5).
 *
 * The canvas lays nodes out in absolute pixels and draws its edges in an SVG
 * behind them. Scaling the WRAPPER rather than the layout is what keeps those
 * two in step: one `transform` moves the boxes and the lines by the same
 * amount, so an edge cannot end up pointing at where a node used to be. It also
 * means the canvas itself stays a pure function of its nodes — it knows nothing
 * about zoom, and the in-page card can keep rendering it unwrapped.
 *
 * 🔴 This is not decoration. It is what lets the graph carry more nodes than
 * fit on a screen, which is the precondition for the partner spine (19 links)
 * and for the design page giving up its remaining sections. A canvas that can
 * only show what fits has a hard ceiling on how much of the page it can
 * replace.
 */

type Props = {
  /** Natural, unscaled size of the canvas being wrapped. */
  content: { width: number; height: number }
  /** Changing this refits — pass something that varies with the graph shown. */
  fitKey?: string
  children: React.ReactNode
}

export const GraphViewport = ({ content, fitKey, children }: Props) => {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [panning, setPanning] = useState(false)

  /*
   * The pointer gesture in a ref, not state. A pan updates on every
   * pointermove; through state that is a re-render per frame, and the
   * `pointerdown` origin would be a render behind by the time it is read.
   */
  const gesture = useRef<{
    origin: { x: number; y: number }
    start: { x: number; y: number }
    moved: boolean
  } | null>(null)

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const fit = useCallback(() => {
    const scale = fitScale(content, size)
    setView({ scale, ...centreOffset(content, size, scale) })
  }, [content.width, content.height, size.width, size.height])

  /*
   * Refit when the graph or the viewport changes shape.
   *
   * 🔴 Keyed on PRIMITIVES — the width, the height, the fit key — never on the
   * `content` object. A `useEffect` keyed on an object or array PROP re-runs on
   * every parent render, because the identity is new each time; here that would
   * yank the reader's pan and zoom back to fit on any unrelated re-render, and
   * react-query's refetch-on-focus makes the parent re-render whenever the
   * window regains focus. That exact shape wiped a five-step wizard in #1803.
   */
  useEffect(() => {
    if (size.width > 0 && size.height > 0) {
      fit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content.width, content.height, size.width, size.height, fitKey])

  const onWheel = (e: React.WheelEvent) => {
    /*
     * Only with a modifier, and `ctrlKey` is how a trackpad PINCH arrives in
     * the browser. A bare wheel is left alone so the drawer and the page behind
     * this can still scroll — hijacking it is the thing that makes an embedded
     * canvas impossible to scroll past.
     */
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const point = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    setView((v) => zoomAbout(point, v, v.scale * (e.deltaY < 0 ? 1.08 : 1 / 1.08)))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    // Left button only: a right-click is the context menu, a middle-click is
    // the browser's own scroll gesture.
    if (e.button !== 0) return
    gesture.current = {
      origin: { x: e.clientX, y: e.clientY },
      start: { x: view.x, y: view.y },
      moved: false,
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g) return
    const to = { x: e.clientX, y: e.clientY }
    if (!g.moved && !isPan(g.origin, to)) return
    if (!g.moved) {
      g.moved = true
      setPanning(true)
      // Capture only once the gesture has become a pan, so a plain click on a
      // node still reaches the node's own handler.
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    }
    setView((v) => ({
      ...v,
      x: g.start.x + (to.x - g.origin.x),
      y: g.start.y + (to.y - g.origin.y),
    }))
  }

  const endGesture = (e: React.PointerEvent) => {
    const g = gesture.current
    gesture.current = null
    if (g?.moved) {
      setPanning(false)
      try {
        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {
        // The capture may already have been lost — releasing twice throws.
      }
    }
  }

  /*
   * 🔴 A pan that ends over a node must not select it. The pointer events above
   * never reach the node's `onClick`; this is the click that fires afterwards,
   * on the way up through the same element. Caught in the CAPTURE phase so it
   * is stopped before the button below sees it.
   */
  const onClickCapture = (e: React.MouseEvent) => {
    if (panning) {
      e.stopPropagation()
      e.preventDefault()
    }
  }

  const zoom = (direction: 1 | -1) => {
    const centre = { x: size.width / 2, y: size.height / 2 }
    setView((v) => zoomAbout(centre, v, stepScale(v.scale, direction)))
  }

  return (
    <div
      ref={viewportRef}
      className={`relative flex-1 overflow-hidden ${panning ? "cursor-grabbing" : "cursor-grab"}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onClickCapture={onClickCapture}
    >
      <div
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          transformOrigin: "0 0",
          width: content.width,
          height: content.height,
        }}
      >
        {children}
      </div>

      {/*
        Controls pinned to the viewport, outside the transformed layer — inside
        it they would zoom along with the graph and shrink out of reach at the
        precise moment the reader needs the "fit" button most.
      */}
      <div className="absolute bottom-4 right-4 flex items-center gap-x-1 rounded-lg border bg-ui-bg-base p-1 shadow-elevation-card-rest">
        <IconButton
          size="small"
            variant="transparent"
            aria-label="Zoom out"
            disabled={view.scale <= MIN_SCALE}
            onClick={() => zoom(-1)}
          >
          <Minus />
        </IconButton>
        <Text size="xsmall" className="text-ui-fg-muted w-10 text-center tabular-nums">
          {Math.round(view.scale * 100)}%
        </Text>
        <IconButton
          size="small"
            variant="transparent"
            aria-label="Zoom in"
            disabled={view.scale >= MAX_SCALE}
            onClick={() => zoom(1)}
          >
          <Plus />
        </IconButton>
        <div className="mx-1 h-4 w-px bg-ui-border-base" />
        <button
          type="button"
          onClick={fit}
          className="rounded px-2 py-1 text-ui-fg-subtle hover:bg-ui-bg-base-hover"
        >
          <Text size="xsmall">Fit</Text>
        </button>
      </div>

      <div className="absolute bottom-4 left-4">
        <Text size="xsmall" className="text-ui-fg-muted">
          Drag to pan · ⌘/ctrl + scroll to zoom
        </Text>
      </div>
    </div>
  )
}
