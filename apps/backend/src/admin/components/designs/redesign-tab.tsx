import { useCallback, useState } from "react"
import { useParams } from "react-router-dom"
import { Button, Textarea, Text, toast } from "@medusajs/ui"
import { useRedesignDesign } from "../../hooks/api/designs"

interface RedesignTabProps {
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
 * Redesign tab (#892) — structure-preserving AI restyle via Nano-Banana. Pick a source
 * image from the canvas, describe the change, generate an exploration render, then drop
 * it onto the moodboard. Generation is exploration; the vector tech-pack is the spec.
 */
export function RedesignTab({ excalidrawAPI, getCanvasCenter }: RedesignTabProps) {
  const { id: designId } = useParams<{ id: string }>()
  const [canvasImages, setCanvasImages] = useState<CanvasImage[]>([])
  const [source, setSource] = useState<string | null>(null)
  const [prompt, setPrompt] = useState("")
  const [result, setResult] = useState<string | null>(null)

  const { mutateAsync: redesign, isPending } = useRedesignDesign(designId || "")

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
    if (!prompt.trim()) {
      toast.error("Describe the redesign")
      return
    }
    const payload = source.startsWith("http")
      ? { image_url: source, prompt: prompt.trim() }
      : { image_base64: source, prompt: prompt.trim() }
    try {
      const { redesign: r } = await redesign(payload)
      setResult(r.image_url)
      toast.success("Redesign generated")
    } catch (e: any) {
      toast.error(e?.message || "Redesign failed")
    }
  }, [source, prompt, redesign])

  const handleAddToCanvas = useCallback(() => {
    if (!excalidrawAPI || !result) return
    const center = getCanvasCenter()
    const fileId = `redesign_${Date.now()}`
    const img = new Image()
    img.onload = () => {
      const maxSize = 400
      const scale = Math.min(maxSize / img.width, maxSize / img.height, 1)
      const element = makeImageElement(
        fileId,
        center,
        img.width * scale,
        img.height * scale
      )
      excalidrawAPI.addFiles([
        {
          id: fileId,
          dataURL: result,
          mimeType: "image/png",
          created: Date.now(),
          lastRetrieved: Date.now(),
        },
      ])
      excalidrawAPI.updateScene({
        elements: [...excalidrawAPI.getSceneElements(), element],
      })
      toast.success("Added to canvas")
    }
    img.src = result
  }, [excalidrawAPI, result, getCanvasCenter])

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-ui-fg-subtle leading-snug">
        Restyle a garment on its existing structure. Exploration only — the vector
        tech-pack stays the sewable spec.
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

      {/* Prompt */}
      <Textarea
        rows={3}
        placeholder="e.g. add contrast piping on the collar and cuffs, keep the silhouette"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      <Button
        size="small"
        variant="primary"
        onClick={handleGenerate}
        isLoading={isPending}
        disabled={!source || !prompt.trim()}
      >
        Generate redesign
      </Button>

      {/* Result */}
      {result && (
        <div className="flex flex-col gap-2 border-t border-ui-border-base pt-3">
          <Text size="xsmall" className="text-ui-fg-subtle">Result</Text>
          <img
            src={result}
            alt="redesign"
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
