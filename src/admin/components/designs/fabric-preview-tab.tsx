import { useState, useRef, useCallback, useEffect } from "react"
import { useParams } from "react-router-dom"
import { sdk, API_BASE_URL } from "../../lib/config"
import { Texture3DViewer } from "./texture-3d-viewer"

interface FabricPreviewTabProps {
  excalidrawAPI: any | null
  getCanvasCenter: () => { x: number; y: number }
}

type ProcessingState = "idle" | "uploading" | "segmenting" | "done" | "error"

interface SegmentResult {
  cutout_url: string
  mask_url: string | null
}

interface DepthResult {
  depth_url: string
  normal_url: string | null
}

// ---------------------------------------------------------------------------
// Helper: create a valid Excalidraw image element with all required fields
// ---------------------------------------------------------------------------
function makeImageElement(
  fileId: string,
  x: number,
  y: number,
  width: number,
  height: number
): object {
  return {
    type: "image",
    id: fileId,
    fileId,
    x,
    y,
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

// ---------------------------------------------------------------------------
// Helper: fetch a URL as a data URL
// Remote URLs (fal.ai CDN etc) are proxied through our backend to avoid CORS.
// ---------------------------------------------------------------------------
async function fetchAsDataUrl(
  url: string,
  designId?: string
): Promise<string> {
  if (url.startsWith("data:") || url.startsWith("blob:")) {
    return url
  }

  // For remote http(s) URLs, proxy through our backend
  const fetchUrl =
    designId && url.startsWith("http")
      ? `${API_BASE_URL}/admin/designs/${designId}/segment/proxy-image?url=${encodeURIComponent(url)}`
      : url

  const res = await fetch(fetchUrl, { credentials: "include" })
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`)

  const blob = await res.blob()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// ---------------------------------------------------------------------------
// Helper: load an image and get its dimensions
// ---------------------------------------------------------------------------
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
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

  // 3D texture depth state
  const [depthResult, setDepthResult] = useState<DepthResult | null>(null)
  const [depthProcessing, setDepthProcessing] = useState(false)
  const [depthError, setDepthError] = useState<string | null>(null)

  // Canvas image selection
  const [canvasImages, setCanvasImages] = useState<
    Array<{ id: string; fileId: string; src: string }>
  >([])
  const [showCanvasPicker, setShowCanvasPicker] = useState(false)

  // Adding to canvas state
  const [addingToCanvas, setAddingToCanvas] = useState(false)

  // ---------------------------------------------------------------------------
  // Reset all derived state
  // ---------------------------------------------------------------------------
  const resetDerived = useCallback(() => {
    setSegmentResult(null)
    setCompositeDataUrl(null)
    setErrorMsg(null)
    setProcessingState("idle")
    setDepthResult(null)
    setDepthError(null)
    setFabricPreview(null)
  }, [])

  // ---------------------------------------------------------------------------
  // Collect images currently on the Excalidraw canvas
  // Handles both data URLs and remote URLs stored in files
  // ---------------------------------------------------------------------------
  const refreshCanvasImages = useCallback(() => {
    if (!excalidrawAPI) return
    const elements = excalidrawAPI.getSceneElements() || []
    const files = excalidrawAPI.getFiles() || {}
    const images: Array<{ id: string; fileId: string; src: string }> = []

    for (const el of elements) {
      if (el.type === "image" && el.fileId && !el.isDeleted) {
        const file = files[el.fileId]
        // Check for dataURL (inline) or url property (remote CDN)
        const src = file?.dataURL || (el as any).url || null
        if (src) {
          images.push({ id: el.id, fileId: el.fileId, src })
        }
      }
    }
    setCanvasImages(images)
  }, [excalidrawAPI])

  // ---------------------------------------------------------------------------
  // Select an image from the canvas — handles both data URLs and remote URLs
  // ---------------------------------------------------------------------------
  const handleSelectFromCanvas = useCallback(
    async (src: string) => {
      setShowCanvasPicker(false)
      resetDerived()

      try {
        // Convert to data URL if remote, so we have a local preview + blob
        const dataUrl = await fetchAsDataUrl(src, designId)
        setSourcePreview(dataUrl)

        // Create a File from the data URL for the segment API
        const res = await fetch(dataUrl)
        const blob = await res.blob()
        const file = new File([blob], "canvas-image.png", {
          type: blob.type || "image/png",
        })
        setSourceFile(file)
      } catch {
        // Fallback: use the URL directly as preview, but sourceFile won't work
        setSourcePreview(src)
        setSourceFile(null)
        setErrorMsg("Could not load this image. Try uploading from device.")
      }
    },
    [resetDerived, designId]
  )

  // ---------------------------------------------------------------------------
  // Source image upload from device
  // ---------------------------------------------------------------------------
  const handleSourceSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      setSourceFile(file)
      setSourcePreview(URL.createObjectURL(file))
      resetDerived()
    },
    [resetDerived]
  )

  // ---------------------------------------------------------------------------
  // Run segmentation via backend (fal.ai BiRefNet)
  // ---------------------------------------------------------------------------
  const handleSegment = useCallback(async () => {
    if (!sourceFile || !designId) return
    setProcessingState("uploading")
    setErrorMsg(null)

    try {
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
          body: { image_base64: base64, model: "General Use (Light)" },
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
  // Generate 3D depth + normal maps (fal.ai MiDaS)
  // ---------------------------------------------------------------------------
  const handleGenerateDepth = useCallback(async () => {
    if (!sourceFile || !designId) return
    setDepthProcessing(true)
    setDepthError(null)
    setDepthResult(null)

    try {
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.readAsDataURL(sourceFile)
      })

      const result = await sdk.client.fetch<{ depth: DepthResult }>(
        `/admin/designs/${designId}/segment/depth`,
        { method: "POST", body: { image_base64: base64 } }
      )

      setDepthResult(result.depth)
    } catch (err: any) {
      setDepthError(err?.message || "Depth generation failed")
    } finally {
      setDepthProcessing(false)
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
  // Uses fetch to avoid CORS canvas tainting
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!segmentResult || !fabricPreview) return

    let cancelled = false

    async function composite() {
      const cvs = compositeCanvasRef.current
      if (!cvs) return
      const c = cvs.getContext("2d")
      if (!c) return

      const maskSrc = segmentResult!.mask_url || segmentResult!.cutout_url

      // Fetch both images as data URLs to avoid CORS
      const [maskDataUrl, fabricDataUrl] = await Promise.all([
        fetchAsDataUrl(maskSrc, designId),
        fetchAsDataUrl(fabricPreview!, designId),
      ])

      if (cancelled) return

      const [maskImg, fabricImg] = await Promise.all([
        loadImage(maskDataUrl),
        loadImage(fabricDataUrl),
      ])

      if (cancelled) return

      const w = maskImg.width
      const h = maskImg.height
      cvs.width = w
      cvs.height = h

      // Draw fabric tiled
      c.clearRect(0, 0, w, h)
      const scaleF = Math.max(w / fabricImg.width, h / fabricImg.height, 1)
      const drawW = fabricImg.width * scaleF
      const drawH = fabricImg.height * scaleF
      for (let x = 0; x < w; x += drawW) {
        for (let y = 0; y < h; y += drawH) {
          c.drawImage(fabricImg, x, y, drawW, drawH)
        }
      }

      // Clip with mask
      c.globalCompositeOperation = "destination-in"
      c.drawImage(maskImg, 0, 0, w, h)
      c.globalCompositeOperation = "source-over"

      setCompositeDataUrl(cvs.toDataURL("image/png"))
    }

    composite().catch(() => {
      /* silently fail — user can retry */
    })

    return () => {
      cancelled = true
    }
  }, [segmentResult, fabricPreview])

  // ---------------------------------------------------------------------------
  // Add an image to Excalidraw canvas
  // Fetches remote URLs as data URLs first so Excalidraw can store them
  // ---------------------------------------------------------------------------
  const addToExcalidrawCanvas = useCallback(
    async (src: string, prefix: string) => {
      if (!excalidrawAPI) return
      setAddingToCanvas(true)

      try {
        // Always convert to data URL so Excalidraw can persist it
        const dataUrl = await fetchAsDataUrl(src, designId)
        const img = await loadImage(dataUrl)

        const center = getCanvasCenter()
        const fileId = `${prefix}_${Date.now()}`
        const maxSize = 400
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1)
        const width = img.width * scale
        const height = img.height * scale

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
            makeImageElement(
              fileId,
              center.x - width / 2,
              center.y - height / 2,
              width,
              height
            ),
          ],
        })
      } catch {
        setErrorMsg("Failed to add image to canvas")
      } finally {
        setAddingToCanvas(false)
      }
    },
    [excalidrawAPI, getCanvasCenter, designId]
  )

  const handleAddCutoutToCanvas = useCallback(
    () =>
      segmentResult?.cutout_url &&
      addToExcalidrawCanvas(segmentResult.cutout_url, "cutout"),
    [segmentResult, addToExcalidrawCanvas]
  )

  const handleAddMaskToCanvas = useCallback(
    () =>
      segmentResult?.mask_url &&
      addToExcalidrawCanvas(segmentResult.mask_url, "mask"),
    [segmentResult, addToExcalidrawCanvas]
  )

  const handleAddCompositeToCanvas = useCallback(
    () =>
      compositeDataUrl &&
      addToExcalidrawCanvas(compositeDataUrl, "fabric_composite"),
    [compositeDataUrl, addToExcalidrawCanvas]
  )

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const isProcessing =
    processingState === "uploading" || processingState === "segmenting"
  const isBusy = isProcessing || depthProcessing

  return (
    <>
      <p className="text-xs text-ui-fg-subtle leading-snug">
        Select an image from the canvas or upload one, then extract its
        silhouette or reveal fabric texture in 3D.
      </p>

      {/* ── SOURCE IMAGE ───────────────────────────────────────────── */}
      <div>
        <label className="text-xs font-medium text-ui-fg-base mb-1.5 block">
          1. Source Image
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
                resetDerived()
              }}
              className="absolute top-1 right-1 bg-ui-bg-base border border-ui-border-base rounded-full size-5 flex items-center justify-center text-xs hover:bg-ui-bg-base-hover"
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <button
              onClick={() => {
                refreshCanvasImages()
                setShowCanvasPicker(true)
              }}
              className="w-full py-3 rounded-md border-2 border-dashed border-ui-border-base hover:border-ui-border-strong bg-ui-bg-subtle text-xs text-ui-fg-base transition-colors"
            >
              Pick from moodboard canvas
            </button>
            <button
              onClick={() => sourceInputRef.current?.click()}
              className="w-full py-2 text-xs font-medium rounded border border-ui-border-base text-ui-fg-subtle hover:bg-ui-bg-subtle transition-colors"
            >
              Or upload from device
            </button>
          </div>
        )}
      </div>

      {/* ── CANVAS IMAGE PICKER ────────────────────────────────────── */}
      {showCanvasPicker && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-ui-fg-base">
              Images on Canvas
            </span>
            <button
              onClick={() => setShowCanvasPicker(false)}
              className="text-xs text-ui-fg-subtle hover:text-ui-fg-base"
            >
              Cancel
            </button>
          </div>
          {canvasImages.length === 0 ? (
            <p className="text-xs text-ui-fg-muted text-center py-3">
              No images on the canvas yet. Add an image to the moodboard first.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-1.5 max-h-[180px] overflow-y-auto">
              {canvasImages.map((ci) => (
                <button
                  key={ci.id}
                  onClick={() => handleSelectFromCanvas(ci.src)}
                  className="group relative rounded-md border border-ui-border-base overflow-hidden hover:border-ui-fg-interactive transition-colors"
                >
                  <img
                    src={ci.src}
                    alt="Canvas image"
                    className="w-full aspect-square object-cover"
                    crossOrigin="anonymous"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                    <span className="text-white text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                      Use this
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ACTION BUTTONS (always visible when source is set) ──── */}
      {sourcePreview && sourceFile && (
        <div className="flex flex-col gap-1.5">
          {/* Segmentation */}
          <button
            onClick={handleSegment}
            disabled={isBusy}
            className={`w-full py-2 text-sm font-medium rounded transition-colors ${
              isBusy
                ? "bg-ui-bg-disabled text-ui-fg-disabled cursor-wait"
                : segmentResult
                ? "border border-ui-border-base text-ui-fg-subtle hover:bg-ui-bg-subtle"
                : "bg-ui-bg-interactive text-ui-fg-on-inverted hover:opacity-90"
            }`}
          >
            {processingState === "uploading"
              ? "Uploading..."
              : processingState === "segmenting"
              ? "Extracting silhouette..."
              : segmentResult
              ? "Re-extract Silhouette"
              : "Extract Silhouette"}
          </button>

          {/* 3D Texture */}
          <button
            onClick={handleGenerateDepth}
            disabled={isBusy}
            className={`w-full py-2 text-sm font-medium rounded transition-colors ${
              isBusy
                ? "bg-ui-bg-disabled text-ui-fg-disabled cursor-wait"
                : depthResult
                ? "border border-ui-border-base text-ui-fg-subtle hover:bg-ui-bg-subtle"
                : "border border-ui-border-strong text-ui-fg-base hover:bg-ui-bg-subtle"
            }`}
          >
            {depthProcessing
              ? "Generating 3D texture..."
              : depthResult
              ? "Re-generate 3D Texture"
              : "3D Texture Reveal"}
          </button>
        </div>
      )}

      {errorMsg && <p className="text-xs text-ui-fg-error">{errorMsg}</p>}
      {depthError && <p className="text-xs text-ui-fg-error">{depthError}</p>}

      {/* ── 3D TEXTURE VIEWER ──────────────────────────────────────── */}
      {depthResult && sourcePreview && (
        <div>
          <label className="text-xs font-medium text-ui-fg-base mb-1.5 block">
            3D Texture Preview
          </label>
          <p className="text-[10px] text-ui-fg-muted mb-2">
            Move your mouse over the image to reveal fabric texture depth
          </p>
          <Texture3DViewer
            textureUrl={sourcePreview}
            depthUrl={depthResult.depth_url}
            normalUrl={depthResult.normal_url}
            width={280}
            height={280}
            strength={0.035}
          />
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div className="rounded-md border border-ui-border-base overflow-hidden">
              <img
                src={depthResult.depth_url}
                alt="Depth"
                className="w-full object-contain max-h-[60px]"
                crossOrigin="anonymous"
              />
              <div className="bg-ui-bg-base px-2 py-0.5 text-center">
                <span className="text-[9px] text-ui-fg-muted">Depth Map</span>
              </div>
            </div>
            {depthResult.normal_url && (
              <div className="rounded-md border border-ui-border-base overflow-hidden">
                <img
                  src={depthResult.normal_url}
                  alt="Normal"
                  className="w-full object-contain max-h-[60px]"
                  crossOrigin="anonymous"
                />
                <div className="bg-ui-bg-base px-2 py-0.5 text-center">
                  <span className="text-[9px] text-ui-fg-muted">
                    Normal Map
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SEGMENTATION RESULT ────────────────────────────────────── */}
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
                crossOrigin="anonymous"
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
                  crossOrigin="anonymous"
                />
                <div className="bg-ui-bg-base px-2 py-1 text-center">
                  <span className="text-[10px] text-ui-fg-muted">Mask</span>
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-1.5 mt-2">
            <button
              onClick={handleAddCutoutToCanvas}
              disabled={addingToCanvas}
              className="flex-1 py-1.5 text-xs font-medium rounded border border-ui-border-base text-ui-fg-subtle hover:bg-ui-bg-subtle transition-colors disabled:opacity-50"
            >
              {addingToCanvas ? "Adding..." : "+ Cutout"}
            </button>
            {segmentResult.mask_url && (
              <button
                onClick={handleAddMaskToCanvas}
                disabled={addingToCanvas}
                className="flex-1 py-1.5 text-xs font-medium rounded border border-ui-border-base text-ui-fg-subtle hover:bg-ui-bg-subtle transition-colors disabled:opacity-50"
              >
                {addingToCanvas ? "Adding..." : "+ Mask"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── FABRIC PATTERN ─────────────────────────────────────────── */}
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

      {/* ── COMPOSITE RESULT ───────────────────────────────────────── */}
      {compositeDataUrl && (
        <div>
          <label className="text-xs font-medium text-ui-fg-base mb-1.5 block">
            Fabric Applied
          </label>
          <div className="rounded-md border border-ui-border-base overflow-hidden bg-[repeating-conic-gradient(#f0f0f0_0%_25%,#fff_0%_50%)_0_0/16px_16px]">
            <img
              src={compositeDataUrl}
              alt="Fabric preview"
              className="w-full object-contain max-h-[160px]"
            />
          </div>
          <button
            onClick={handleAddCompositeToCanvas}
            disabled={addingToCanvas}
            className="w-full mt-2 py-2 text-sm font-medium rounded bg-ui-bg-interactive text-ui-fg-on-inverted hover:opacity-90 transition-colors disabled:opacity-50"
          >
            {addingToCanvas ? "Adding..." : "Add to Moodboard"}
          </button>
        </div>
      )}
    </>
  )
}
