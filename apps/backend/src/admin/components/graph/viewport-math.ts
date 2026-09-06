/**
 * The arithmetic behind pan and zoom, as pure functions (#1847 step 5).
 *
 * Separated from the component for the usual reason in this feature: every
 * mistake these can make is INVISIBLE. A fit that computes 1.4 silently
 * enlarges a graph that already fitted; a cursor-anchored zoom that drops the
 * offset term slides the whole canvas out from under the pointer; a drag
 * threshold of zero turns every pan into a click on whatever node the pointer
 * happened to start over. None of those throw, and all of them look like "the
 * canvas feels wrong" rather than a bug with a location.
 */

export const MIN_SCALE = 0.35
export const MAX_SCALE = 2.5

export const clampScale = (scale: number): number =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))

/**
 * The scale at which the whole graph is visible inside the viewport.
 *
 * 🔴 Capped at 1. Fit means "show me all of it", not "fill the space" — a
 * six-node design graph in a wide modal would otherwise be blown up to 2×,
 * rendering 176px node boxes at 350px with the same 10px edge labels. Fit is
 * allowed to shrink; enlarging is the reader's decision, via the buttons.
 */
export const fitScale = (
  content: { width: number; height: number },
  viewport: { width: number; height: number },
  pad = 32
): number => {
  if (
    content.width <= 0 ||
    content.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    // A viewport not yet measured must not produce a scale of 0 or Infinity —
    // both render an empty canvas that looks exactly like "the graph is empty".
    return 1
  }
  const usableW = Math.max(1, viewport.width - pad * 2)
  const usableH = Math.max(1, viewport.height - pad * 2)
  return clampScale(Math.min(1, usableW / content.width, usableH / content.height))
}

/** Offset that centres content of this size in this viewport at this scale. */
export const centreOffset = (
  content: { width: number; height: number },
  viewport: { width: number; height: number },
  scale: number
): { x: number; y: number } => ({
  x: (viewport.width - content.width * scale) / 2,
  y: (viewport.height - content.height * scale) / 2,
})

/**
 * Zoom about a fixed point — the pointer, or the viewport's centre.
 *
 * 🔴 The offset MUST move with the scale. The point under the cursor is at
 * content coordinate `(px - offset) / scale`; for it to stay under the cursor
 * at the new scale, the offset has to absorb the difference. Drop this and the
 * canvas drifts away from the pointer on every wheel tick — which reads as
 * "the zoom is broken" long before anyone works out that it is the pan.
 */
export const zoomAbout = (
  point: { x: number; y: number },
  current: { scale: number; x: number; y: number },
  nextScaleRaw: number
): { scale: number; x: number; y: number } => {
  const next = clampScale(nextScaleRaw)
  // Clamped to the same value: nothing moves. Returning early keeps a wheel
  // spun at the limit from nudging the offset a pixel at a time.
  if (next === current.scale) {
    return current
  }
  const cx = (point.x - current.x) / current.scale
  const cy = (point.y - current.y) / current.scale
  return {
    scale: next,
    x: point.x - cx * next,
    y: point.y - cy * next,
  }
}

/**
 * Did this pointer gesture move far enough to be a PAN rather than a CLICK?
 *
 * 🔴 Without a threshold every pan that starts on a node box selects that node
 * on release — the drawer flies open mid-drag. With too large a threshold a
 * deliberate click on a node registers as a pan and nothing happens at all.
 * Four pixels is the distance a hand holding a trackpad button moves without
 * meaning to.
 */
export const PAN_THRESHOLD_PX = 4

export const isPan = (
  from: { x: number; y: number },
  to: { x: number; y: number }
): boolean => Math.hypot(to.x - from.x, to.y - from.y) > PAN_THRESHOLD_PX

/** One notch of the zoom buttons. Multiplicative, so in and out are symmetric. */
export const ZOOM_STEP = 1.25

export const stepScale = (scale: number, direction: 1 | -1): number =>
  clampScale(direction === 1 ? scale * ZOOM_STEP : scale / ZOOM_STEP)
