import { useCallback, useState } from "react"
import { useParams } from "react-router-dom"
import { Button, Text, toast } from "@medusajs/ui"
import { useOutlineDesign, OutlineResponse } from "../../hooks/api/designs"

interface OutlineTabProps {
  excalidrawAPI: any | null
  getCanvasCenter: () => { x: number; y: number }
}

type CanvasImage = { id: string; fileId: string; src: string }

/** Build a well-formed Excalidraw image element centred on the canvas. */
function makeImageElement(
  fileId: string,
  center: { x: number; y: number },
  width: number,
  height: number
) {
  return {
    type: "image",
    id: fileId,
    fileId,
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
    angle: 0,
    strokeColor: "transparent",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 0,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: Math.floor(Math.random() * 100000),
    version: 1,
    versionNonce: Math.floor(Math.random() * 100000),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    status: "saved",
    scale: [1, 1] as [number, number],
  }
}

/**
 * Outline tab (#892) — vectorize a flat/cutout into an editable SVG outline via potrace.
 * This is the deterministic, sewable-spec companion to the Redesign tab's exploration:
 * pick a source image from the canvas, trace it, then drop the outline onto the moodboard.
 * Toggle "From a mask" when the source is a /segment mask (white on black).
 */
export function OutlineTab({ excalidrawAPI, getCanvasCenter }: OutlineTabProps) {
  const { id: designId } = useParams<{ id: string }>()
  const [canvasImages, setCanvasImages] = useState<CanvasImage[]>([])
  const [source, setSource] = useState<string | null>(null)
  const [mode, setMode] = useState<"outline" | "posterize">("outline")
  const [fromMask, setFromMask] = useState(false)
  const [result, setResult] = useState<OutlineResponse["outline"] | null>(null)

  const { mutateAsync: outline, isPending } = useOutlineDesign(designId || "")

  const refreshCanvasImages = useCallback(() => {
    if (!excalidrawAPI) return
    const elements = excalidrawAPI.getSceneElements() || []
    const files = excalidrawAPI.getFiles() || {}
    const results: CanvasImage[] = []
    for (const el of elements) {
      if (el.type === "image" && el.fileId && !el.isDeleted) {
        const src = files[el.fileId]?.dataURL || el.url || null
        if (src && (src.startsWith("data:") || src.startsWith("http"))) {
          results.push({ id: el.id, fileId: el.fileId, src })
        }
      }
    }
    setCanvasImages(results)
    if (results.length === 0) toast.info("No images on the canvas yet")
  }, [excalidrawAPI])

  const handleGenerate = useCallback(async () => {
    if (!source) {
      toast.error("Pick a source image first")
      return
    }
    // A mask is white-foreground-on-black, so trace the light regions.
    const black_on_white = !fromMask
    const payload = source.startsWith("http")
      ? { image_url: source, mode, black_on_white }
      : { image_base64: source, mode, black_on_white }
    try {
      const { outline: o } = await outline(payload)
      setResult(o)
      toast.success("Outline traced")
    } catch (e: any) {
      toast.error(e?.message || "Vectorization failed")
    }
  }, [source, mode, fromMask, outline])

  const handleAddToCanvas = useCallback(() => {
    if (!excalidrawAPI || !result) return
    const center = getCanvasCenter()
    const fileId = `outline_${Date.now()}`
    const maxSize = 400
    const w = result.width || 300
    const h = result.height || 300
    const scale = Math.min(maxSize / w, maxSize / h, 1)
    const element = makeImageElement(fileId, center, w * scale, h * scale)
    excalidrawAPI.addFiles([
      {
        id: fileId,
        dataURL: result.image_url,
        mimeType: "image/svg+xml",
        created: Date.now(),
        lastRetrieved: Date.now(),
      },
    ])
    excalidrawAPI.updateScene({
      elements: [...excalidrawAPI.getSceneElements(), element],
    })
    toast.success("Added to canvas")
  }, [excalidrawAPI, result, getCanvasCenter])

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-ui-fg-subtle leading-snug">
        Trace a flat or cutout into an editable vector outline — the sewable-spec
        companion to a Redesign render. For the cleanest silhouette, segment first
        and trace the mask.
      </p>

      {/* Source picker */}
      {source ? (
        <div className="relative">
          <img
            src={source}
            alt="source"
            className="w-full max-h-40 object-contain rounded-md border border-ui-border-base bg-ui-bg-subtle"
          />
          <button
            onClick={() => setSource(null)}
            className="absolute top-1 right-1 bg-ui-bg-base border border-ui-border-base rounded-full size-5 flex items-center justify-center text-xs hover:bg-ui-bg-base-hover"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          onClick={refreshCanvasImages}
          className="w-full py-3 rounded-md border-2 border-dashed border-ui-border-base hover:border-ui-border-strong bg-ui-bg-subtle text-xs text-ui-fg-base transition-colors"
        >
          Pick source from canvas
        </button>
      )}

      {!source && canvasImages.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5 max-h-[160px] overflow-y-auto">
          {canvasImages.map((ci) => (
            <button
              key={ci.id}
              onClick={() => {
                setSource(ci.src)
                setCanvasImages([])
              }}
              className="rounded-md border border-ui-border-base overflow-hidden hover:border-ui-fg-interactive transition-colors"
            >
              <img src={ci.src} alt="" className="w-full h-16 object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* Mode toggle */}
      <div className="flex gap-1">
        {(["outline", "posterize"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 py-1 text-xs rounded border transition-colors capitalize ${
              mode === m
                ? "bg-ui-bg-interactive text-ui-fg-on-inverted border-ui-bg-interactive"
                : "border-ui-border-base text-ui-fg-subtle hover:bg-ui-bg-subtle"
            }`}
          >
            {m === "outline" ? "Silhouette" : "Posterize"}
          </button>
        ))}
      </div>

      {/* Mask toggle */}
      <label className="flex items-center gap-2 text-xs text-ui-fg-subtle cursor-pointer">
        <input
          type="checkbox"
          checked={fromMask}
          onChange={(e) => setFromMask(e.target.checked)}
        />
        Source is a segmentation mask (white on black)
      </label>

      <Button
        size="small"
        variant="primary"
        onClick={handleGenerate}
        isLoading={isPending}
        disabled={!source}
      >
        Trace outline
      </Button>

      {/* Result */}
      {result && (
        <div className="flex flex-col gap-2 border-t border-ui-border-base pt-3">
          <Text size="xsmall" className="text-ui-fg-subtle">
            Outline {result.width && result.height ? `(${result.width}×${result.height})` : ""}
          </Text>
          <img
            src={result.image_url}
            alt="outline"
            className="w-full max-h-52 object-contain rounded-md border border-ui-border-base bg-ui-bg-subtle"
          />
          <Button size="small" variant="secondary" onClick={handleAddToCanvas}>
            Add to canvas
          </Button>
        </div>
      )}
    </div>
  )
}
