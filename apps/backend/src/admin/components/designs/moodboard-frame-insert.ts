/**
 * Pure layout planner for auto-inserting a /redesign render into a dedicated
 * moodboard frame (#892). Kept React-free and side-effect-free so it unit-tests
 * without Excalidraw: it computes *where* a new image goes (which frame, grown to
 * fit, and the image's box); the caller applies the result to the live scene.
 *
 * Renders accumulate in a single "Redesign explorations" frame laid out as a 2-col
 * grid to the right of existing canvas content — so exploration output stays visually
 * separate from the deterministic vector tech-pack frames.
 */

export const REDESIGN_FRAME_NAME = "Redesign explorations"

export const REDESIGN_FRAME_LAYOUT = {
  cols: 2,
  cell: 400, // square cell each render is fit into
  pad: 48, // inner padding
  gap: 32, // gap between cells
  frameGap: 120, // gap from existing content when creating the frame
}

/** The subset of an Excalidraw element the planner reads. */
export interface SceneElementLike {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  frameId?: string | null
  name?: string
  isDeleted?: boolean
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface InsertionPlan {
  frameId: string
  isNewFrame: boolean
  /** Frame box, already grown to fit the incoming render. */
  frame: Box & { id: string; name: string }
  /** Image box, centred inside its grid cell. */
  image: Box
}

/** Scale (never up) a natural size to fit inside a square cell. */
export function fitInCell(
  naturalW: number,
  naturalH: number,
  cell: number = REDESIGN_FRAME_LAYOUT.cell
): { width: number; height: number } {
  const w = naturalW > 0 ? naturalW : cell
  const h = naturalH > 0 ? naturalH : cell
  const scale = Math.min(cell / w, cell / h, 1)
  return { width: w * scale, height: h * scale }
}

/** Frame outer size needed to hold `childCount` renders in the grid. */
export function frameDimensions(childCount: number): { width: number; height: number } {
  const { cols, cell, pad, gap } = REDESIGN_FRAME_LAYOUT
  const rows = Math.max(1, Math.ceil(Math.max(childCount, 1) / cols))
  return {
    width: pad * 2 + cols * cell + (cols - 1) * gap,
    height: pad * 2 + rows * cell + (rows - 1) * gap,
  }
}

/**
 * Plan where the next render lands. Reuses the existing "Redesign explorations"
 * frame (appending to its grid and growing it) or, if absent, positions a new frame
 * to the right of all live content.
 *
 * @param makeId - id generator for a freshly-created frame (client passes a unique fn).
 */
export function planRedesignInsertion(
  elements: SceneElementLike[],
  imageSize: { width: number; height: number },
  makeId: (prefix: string) => string
): InsertionPlan {
  const { cols, cell, pad, gap, frameGap } = REDESIGN_FRAME_LAYOUT
  const live = (elements || []).filter((e) => !e.isDeleted)
  const existing = live.find(
    (e) => e.type === "frame" && e.name === REDESIGN_FRAME_NAME
  )

  let frameId: string
  let isNewFrame: boolean
  let frameX: number
  let frameY: number
  let childCount: number

  if (existing) {
    frameId = existing.id
    isNewFrame = false
    frameX = existing.x
    frameY = existing.y
    childCount = live.filter((e) => e.frameId === frameId && e.type === "image").length
  } else {
    frameId = makeId("frame")
    isNewFrame = true
    const maxRight = live.length ? Math.max(...live.map((e) => e.x + e.width)) : 0
    frameX = live.length ? maxRight + frameGap : 0
    frameY = 0
    childCount = 0
  }

  const index = childCount
  const col = index % cols
  const row = Math.floor(index / cols)
  const fit = fitInCell(imageSize.width, imageSize.height, cell)
  const cellX = frameX + pad + col * (cell + gap)
  const cellY = frameY + pad + row * (cell + gap)

  const image: Box = {
    x: cellX + (cell - fit.width) / 2,
    y: cellY + (cell - fit.height) / 2,
    width: fit.width,
    height: fit.height,
  }

  const dims = frameDimensions(childCount + 1)
  return {
    frameId,
    isNewFrame,
    frame: { id: frameId, name: REDESIGN_FRAME_NAME, x: frameX, y: frameY, ...dims },
    image,
  }
}
