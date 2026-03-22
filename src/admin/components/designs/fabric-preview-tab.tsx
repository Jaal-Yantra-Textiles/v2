import { useState, useRef, useCallback, useEffect } from "react"
import { useParams } from "react-router-dom"
import { sdk } from "../../lib/config"

interface FabricPreviewTabProps {
  excalidrawAPI: any | null
  getCanvasCenter: () => { x: number; y: number }
}

type ProcessingState = "idle" | "uploading" | "segmenting" | "done" | "error"

interface SegmentResult {
  cutout_url: string
  mask_url: string | null
}

export function FabricPreviewTab({
  excalidrawAPI,
  getCanvasCenter,
}: FabricPreviewTabProps) {
  const { id: designId } = useParams<{ id: string }>()

  // Source image state
  const [sourcePreview, setSourcePreview] = useState<string | null>(null)
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const sourceInputRef = useRef<HTMLInputElement>(null)

  // Segmentation result
  const [segmentResult, setSegmentResult] = useState<SegmentResult | null>(null)
  const [processingState, setProcessingState] =
    useState<ProcessingState>("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Fabric pattern state
  const [fabricPreview, setFabricPreview] = useState<string | null>(null)
  const fabricInputRef = useRef<HTMLInputElement>(null)

  // Composite result
  const compositeCanvasRef = useRef<HTMLCanvasElement>(null)
  const [compositeDataUrl, setCompositeDataUrl] = useState<string | null>(null)

  // ---------------------------------------------------------------------------
  // Source image upload
  // ---------------------------------------------------------------------------
  const handleSourceSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      setSourceFile(file)
      setSourcePreview(URL.createObjectURL(file))
      setSegmentResult(null)
      setCompositeDataUrl(null)
      setErrorMsg(null)
      setProcessingState("idle")
    },
    []
  )

  // ---------------------------------------------------------------------------
  // Run segmentation via backend
  // ---------------------------------------------------------------------------
  const handleSegment = useCallback(async () => {
    if (!sourceFile || !designId) return

    setProcessingState("uploading")
    setErrorMsg(null)

    try {
      // Convert file to base64
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.readAsDataURL(sourceFile)
      })

      setProcessingState("segmenting")

      const result = await sdk.client.fetch<{ segment: SegmentResult }>(
        `/admin/designs/${designId}/segment`,
        {
          method: "POST",
          body: {
            image_base64: base64,
            model: "General Use (Light)",
          },
        }
      )

      setSegmentResult(result.segment)
      setProcessingState("done")
    } catch (err: any) {
      setErrorMsg(err?.message || "Segmentation failed")
      setProcessingState("error")
    }
  }, [sourceFile, designId])

  // ---------------------------------------------------------------------------
  // Fabric pattern upload
  // ---------------------------------------------------------------------------
  const handleFabricSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      setFabricPreview(URL.createObjectURL(file))
      setCompositeDataUrl(null)
    },
    []
  )

  // ---------------------------------------------------------------------------
  // Composite: apply fabric within silhouette mask
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!segmentResult || !fabricPreview) return

    const maskSrc = segmentResult.mask_url || segmentResult.cutout_url
    const canvas = compositeCanvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const maskImg = new Image()
    maskImg.crossOrigin = "anonymous"
    const fabricImg = new Image()
    fabricImg.crossOrigin = "anonymous"

    let maskLoaded = false
    let fabricLoaded = false

    const tryComposite = () => {
      if (!maskLoaded || !fabricLoaded) return

      const w = maskImg.width
      const h = maskImg.height
      canvas.width = w
      canvas.height = h

      // Step 1: Draw fabric pattern tiled to fill the canvas
      ctx.clearRect(0, 0, w, h)

      // Tile the fabric pattern
      const patW = fabricImg.width
      const patH = fabricImg.height
      const scaleF = Math.max(w / patW, h / patH, 1)
      const drawW = patW * scaleF
      const drawH = patH * scaleF

      for (let x = 0; x < w; x += drawW) {
        for (let y = 0; y < h; y += drawH) {
          ctx.drawImage(fabricImg, x, y, drawW, drawH)
        }
      }

      // Step 2: Use the mask as a clip via destination-in compositing
      ctx.globalCompositeOperation = "destination-in"
      ctx.drawImage(maskImg, 0, 0, w, h)

      // Reset compositing
      ctx.globalCompositeOperation = "source-over"

      setCompositeDataUrl(canvas.toDataURL("image/png"))
    }

    maskImg.onload = () => {
      maskLoaded = true
      tryComposite()
    }
    fabricImg.onload = () => {
      fabricLoaded = true
      tryComposite()
    }

    maskImg.src = maskSrc
    fabricImg.src = fabricPreview
  }, [segmentResult, fabricPreview])

  // ---------------------------------------------------------------------------
  // Add composite to Excalidraw canvas
  // ---------------------------------------------------------------------------
  const handleAddToCanvas = useCallback(() => {
    if (!excalidrawAPI || !compositeDataUrl) return

    const center = getCanvasCenter()
    const fileId = `fabric_composite_${Date.now()}`

    const img = new Image()
    img.onload = () => {
      const maxSize = 400
      const scale = Math.min(maxSize / img.width, maxSize / img.height, 1)
      const width = img.width * scale
      const height = img.height * scale

      excalidrawAPI.addFiles([
        {
          id: fileId,
          dataURL: compositeDataUrl,
          mimeType: "image/png",
          created: Date.now(),
          lastRetrieved: Date.now(),
        },
      ])

      excalidrawAPI.updateScene({
        elements: [
          ...excalidrawAPI.getSceneElements(),
          {
            type: "image",
            id: fileId,
            fileId,
            x: center.x - width / 2,
            y: center.y - height / 2,
            width,
            height,
            strokeColor: "transparent",
            backgroundColor: "transparent",
            fillStyle: "solid",
            strokeWidth: 0,
            roughness: 0,
            opacity: 100,
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
          },
        ],
      })
    }
    img.src = compositeDataUrl
  }, [excalidrawAPI, compositeDataUrl, getCanvasCenter])

  // Also allow adding just the cutout (no fabric)
  const handleAddCutoutToCanvas = useCallback(() => {
    if (!excalidrawAPI || !segmentResult?.cutout_url) return

    const center = getCanvasCenter()
    const fileId = `cutout_${Date.now()}`

    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      const maxSize = 400
      const scale = Math.min(maxSize / img.width, maxSize / img.height, 1)
      const width = img.width * scale
      const height = img.height * scale

      // Fetch as data URL for Excalidraw
      const tmpCanvas = document.createElement("canvas")
      tmpCanvas.width = img.width
      tmpCanvas.height = img.height
      const tmpCtx = tmpCanvas.getContext("2d")!
      tmpCtx.drawImage(img, 0, 0)
      const dataUrl = tmpCanvas.toDataURL("image/png")

      excalidrawAPI.addFiles([
        {
          id: fileId,
          dataURL: dataUrl,
          mimeType: "image/png",
          created: Date.now(),
          lastRetrieved: Date.now(),
        },
      ])

      excalidrawAPI.updateScene({
        elements: [
          ...excalidrawAPI.getSceneElements(),
          {
            type: "image",
            id: fileId,
            fileId,
            x: center.x - width / 2,
            y: center.y - height / 2,
            width,
            height,
            strokeColor: "transparent",
            backgroundColor: "transparent",
            fillStyle: "solid",
            strokeWidth: 0,
            roughness: 0,
            opacity: 100,
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
          },
        ],
      })
    }
    img.src = segmentResult.cutout_url
  }, [excalidrawAPI, segmentResult, getCanvasCenter])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const isProcessing =
    processingState === "uploading" || processingState === "segmenting"

  return (
    <>
      <p className="text-xs text-ui-fg-subtle leading-snug">
        Upload a model or garment photo to extract its silhouette, then apply a
        fabric pattern over it.
      </p>

      {/* Step 1: Source image */}
      <div>
        <label className="text-xs font-medium text-ui-fg-base mb-1.5 block">
          1. Model / Garment Photo
        </label>
        <input
          ref={sourceInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handleSourceSelect}
        />
        {sourcePreview ? (
          <div className="relative">
            <img
              src={sourcePreview}
              alt="Source"
              className="w-full rounded-md border border-ui-border-base object-contain max-h-[140px] bg-ui-bg-subtle"
            />
            <button
              onClick={() => {
                setSourcePreview(null)
                setSourceFile(null)
                setSegmentResult(null)
                setCompositeDataUrl(null)
                setProcessingState("idle")
              }}
              className="absolute top-1 right-1 bg-ui-bg-base border border-ui-border-base rounded-full size-5 flex items-center justify-center text-xs hover:bg-ui-bg-base-hover"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={() => sourceInputRef.current?.click()}
            className="w-full py-4 rounded-md border-2 border-dashed border-ui-border-base hover:border-ui-border-strong bg-ui-bg-subtle text-xs text-ui-fg-subtle transition-colors"
          >
            Click to upload image
          </button>
        )}
      </div>

      {/* Extract button */}
      {sourcePreview && !segmentResult && (
        <button
          onClick={handleSegment}
          disabled={isProcessing}
          className={`w-full py-2 text-sm font-medium rounded transition-colors ${
            isProcessing
              ? "bg-ui-bg-disabled text-ui-fg-disabled cursor-wait"
              : "bg-ui-bg-interactive text-ui-fg-on-inverted hover:opacity-90"
          }`}
        >
          {processingState === "uploading"
            ? "Uploading..."
            : processingState === "segmenting"
            ? "Extracting silhouette..."
            : "Extract Silhouette"}
        </button>
      )}

      {errorMsg && (
        <p className="text-xs text-ui-fg-error">{errorMsg}</p>
      )}

      {/* Step 2: Segmentation result */}
      {segmentResult && (
        <div>
          <label className="text-xs font-medium text-ui-fg-base mb-1.5 block">
            Extracted Silhouette
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-ui-border-base overflow-hidden bg-[repeating-conic-gradient(#f0f0f0_0%_25%,#fff_0%_50%)_0_0/16px_16px]">
              <img
                src={segmentResult.cutout_url}
                alt="Cutout"
                className="w-full object-contain max-h-[120px]"
              />
              <div className="bg-ui-bg-base px-2 py-1 text-center">
                <span className="text-[10px] text-ui-fg-muted">Cutout</span>
              </div>
            </div>
            {segmentResult.mask_url && (
              <div className="rounded-md border border-ui-border-base overflow-hidden bg-ui-bg-subtle">
                <img
                  src={segmentResult.mask_url}
                  alt="Mask"
                  className="w-full object-contain max-h-[120px]"
                />
                <div className="bg-ui-bg-base px-2 py-1 text-center">
                  <span className="text-[10px] text-ui-fg-muted">Mask</span>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={handleAddCutoutToCanvas}
            className="w-full mt-2 py-1.5 text-xs font-medium rounded border border-ui-border-base text-ui-fg-subtle hover:bg-ui-bg-subtle transition-colors"
          >
            + Add cutout to canvas
          </button>
        </div>
      )}

      {/* Step 3: Fabric pattern */}
      {segmentResult && (
        <div>
          <label className="text-xs font-medium text-ui-fg-base mb-1.5 block">
            2. Fabric Pattern
          </label>
          <input
            ref={fabricInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleFabricSelect}
          />
          {fabricPreview ? (
            <div className="relative">
              <img
                src={fabricPreview}
                alt="Fabric"
                className="w-full rounded-md border border-ui-border-base object-cover max-h-[80px]"
              />
              <button
                onClick={() => {
                  setFabricPreview(null)
                  setCompositeDataUrl(null)
                }}
                className="absolute top-1 right-1 bg-ui-bg-base border border-ui-border-base rounded-full size-5 flex items-center justify-center text-xs hover:bg-ui-bg-base-hover"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              onClick={() => fabricInputRef.current?.click()}
              className="w-full py-3 rounded-md border-2 border-dashed border-ui-border-base hover:border-ui-border-strong bg-ui-bg-subtle text-xs text-ui-fg-subtle transition-colors"
            >
              Upload fabric pattern
            </button>
          )}
        </div>
      )}

      {/* Hidden composite canvas */}
      <canvas ref={compositeCanvasRef} className="hidden" />

      {/* Step 4: Composite result */}
      {compositeDataUrl && (
        <div>
          <label className="text-xs font-medium text-ui-fg-base mb-1.5 block">
            Preview
          </label>
          <div className="rounded-md border border-ui-border-base overflow-hidden bg-[repeating-conic-gradient(#f0f0f0_0%_25%,#fff_0%_50%)_0_0/16px_16px]">
            <img
              src={compositeDataUrl}
              alt="Fabric preview"
              className="w-full object-contain max-h-[160px]"
            />
          </div>
          <button
            onClick={handleAddToCanvas}
            className="w-full mt-2 py-2 text-sm font-medium rounded bg-ui-bg-interactive text-ui-fg-on-inverted hover:opacity-90 transition-colors"
          >
            Add to Moodboard
          </button>
        </div>
      )}
    </>
  )
}
