import { DesignLayer } from "../types"

type ExcalidrawFiles = Record<string, {
    mimeType: string
    id: string
    dataURL: string
    created: number
}>

type ExcalidrawElement = {
    id: string
    type: string
    x: number
    y: number
    width: number
    height: number
    angle: number
    strokeColor?: string
    backgroundColor?: string
    opacity?: number
    isDeleted?: boolean
    // Text
    text?: string
    fontSize?: number
    fontFamily?: number
    // Image
    fileId?: string
}

// IDs that convertToExcalidraw stamps on its auto-generated utility elements.
// When the moodboard was produced by that function (from a customer's Konva canvas),
// these elements are chrome — not design content. We skip them so they don't
// pollute the canvas when converting back. Actual layer elements have IDs like
// "layer-<layerId>-<timestamp>" and pass through untouched.
const UTILITY_ID_PREFIXES = [
    "title-",
    "material-info-",
    "partner-info-",
    "canvas-frame-",
    "notes-header-",
    "notes-area-",
    "notes-placeholder-",
]

const isUtilityElement = (id: string) =>
    UTILITY_ID_PREFIXES.some((prefix) => id.startsWith(prefix))

/**
 * Converts Excalidraw JSON (moodboard) → Konva DesignLayer[].
 *
 * Primary use-case: admin draws inspiration in Excalidraw; customer opens the
 * design and gets those elements on the canvas to edit further.
 *
 * Secondary use-case: moodboard was produced by convertToExcalidraw() from a
 * prior canvas save. In that case metadata.layers takes priority and this
 * function is NOT called. When it is called the utility chrome elements
 * (title, canvas frame, notes area) are filtered out and only the actual
 * design layers (prefixed "layer-") are restored — at their stored coordinates
 * which include the 20px/canvasStartY offset baked in by the encoder.
 *
 * Mappings:
 * - image      → image layer  (src from files[fileId].dataURL or element.link)
 * - text       → text layer
 * - rectangle  → rect layer
 * - ellipse    → circle layer
 * - others     → skipped (freehand, arrows, frames, etc.)
 */
export function excalidrawToKonvaLayers(
    moodboard: Record<string, any>
): DesignLayer[] {
    if (!moodboard) return []

    const elements: ExcalidrawElement[] = moodboard.elements || []
    const files: ExcalidrawFiles = moodboard.files || {}
    const layers: DesignLayer[] = []

    for (const el of elements) {
        // Skip deleted and auto-generated chrome elements
        if (el.isDeleted) continue
        if (isUtilityElement(el.id)) continue

        const opacity = typeof el.opacity === "number" ? el.opacity / 100 : 1
        // Excalidraw stores angle in radians; Konva uses degrees
        const rotation = (el.angle * 180) / Math.PI

        if (el.type === "image" && el.fileId) {
            // Prefer the dataURL stored in the files map; fall back to element.link
            const file = files[el.fileId]
            const src = file?.dataURL || (el as any).link || ""
            if (!src) continue

            layers.push({
                id: `ex-${el.id}`,
                type: "image",
                x: el.x,
                y: el.y,
                width: el.width,
                height: el.height,
                rotation,
                scaleX: 1,
                scaleY: 1,
                src,
                opacity,
                draggable: true,
            })
        } else if (el.type === "text" && el.text) {
            const fontFamilyMap: Record<number, string> = {
                1: "Virgil",
                2: "Helvetica",
                3: "Cascadia",
            }
            layers.push({
                id: `ex-${el.id}`,
                type: "text",
                x: el.x,
                y: el.y,
                width: el.width,
                height: el.height,
                rotation,
                scaleX: 1,
                scaleY: 1,
                text: el.text,
                fontSize: el.fontSize || 16,
                fontFamily: fontFamilyMap[el.fontFamily || 1] || "sans-serif",
                fill: el.strokeColor || "#1e1e1e",
                opacity,
                draggable: true,
            })
        } else if (el.type === "rectangle") {
            layers.push({
                id: `ex-${el.id}`,
                type: "rect",
                x: el.x,
                y: el.y,
                width: el.width,
                height: el.height,
                rotation,
                scaleX: 1,
                scaleY: 1,
                fill: el.backgroundColor || "transparent",
                strokeColor: el.strokeColor || "#000000",
                strokeWidth: 1,
                opacity,
                draggable: true,
            })
        } else if (el.type === "ellipse") {
            layers.push({
                id: `ex-${el.id}`,
                type: "circle",
                x: el.x,
                y: el.y,
                width: el.width,
                height: el.height,
                rotation,
                scaleX: 1,
                scaleY: 1,
                fill: el.backgroundColor || "transparent",
                strokeColor: el.strokeColor || "#000000",
                strokeWidth: 1,
                opacity,
                draggable: true,
            })
        }
        // Freehand, arrows, frames, etc. are skipped
    }

    return layers
}
