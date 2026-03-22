import { useState, useMemo, useCallback } from "react"
import {
  FASHION_SHAPES,
  FashionShape,
  createShapeElements,
  perspectiveTransformPoints,
} from "./fashion-shapes"
import {
  CrquisType,
  PatternPiece,
  PATTERN_PIECES,
  createCrquisElements,
  createPatternPieceElement,
} from "./fashion-croquis"
import { sdk } from "../../lib/config"
import { FabricPreviewTab } from "./fabric-preview-tab"

interface FashionPanelProps {
  excalidrawAPI: any | null
  getCanvasCenter: () => { x: number; y: number }
  onClose: () => void
}

type Tab = "figures" | "garments" | "patterns" | "pinterest" | "fabric"

type PinterestPin = {
  id: string
  title: string
  description: string
  images: {
    small: string | null
    medium: string | null
    large: string | null
    original: string | null
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function addImageToCanvas(
  api: any,
  fileId: string,
  dataUrl: string,
  element: object
) {
  api.addFiles([{
    id: fileId,
    dataURL: dataUrl,
    mimeType: "image/svg+xml",
    created: Date.now(),
    lastRetrieved: Date.now(),
  }])
  api.updateScene({
    elements: [...api.getSceneElements(), element],
  })
}

// ---------------------------------------------------------------------------
// Shape thumbnail (Garments tab)
// ---------------------------------------------------------------------------
function ShapeThumbnail({
  shape,
  selected,
  perspective,
  onClick,
}: {
  shape: FashionShape
  selected: boolean
  perspective: "flat" | "three-quarter"
  onClick: () => void
}) {
  const vbW = shape.width
  const vbH = shape.height
  const aspect = vbW / vbH
  const thumbW = aspect >= 1 ? 56 : Math.round(56 * aspect)
  const thumbH = aspect >= 1 ? Math.round(56 / aspect) : 56

  return (
    <button
      onClick={onClick}
      title={shape.name}
      className={`flex flex-col items-center gap-1 p-1 rounded border transition-all ${
        selected
          ? "border-ui-fg-interactive bg-ui-bg-highlight"
          : "border-ui-border-base hover:border-ui-border-strong hover:bg-ui-bg-subtle"
      }`}
    >
      <svg width={thumbW} height={thumbH} viewBox={`0 0 ${vbW} ${vbH}`}>
        {shape.regions.map((region, i) => {
          let pts: [number, number][] = region.points.map(
            ([px, py]) => [px * vbW, py * vbH]
          )
          if (perspective === "three-quarter") {
            pts = perspectiveTransformPoints(pts, vbW, vbH)
          }
          return (
            <polygon
              key={i}
              points={pts.map(([x, y]) => `${x},${y}`).join(" ")}
              fill={region.defaultColor}
              stroke="#1a1a1a"
              strokeWidth={vbW * 0.012}
            />
          )
        })}
      </svg>
      <span className="text-xs text-ui-fg-subtle truncate w-full text-center leading-tight">
        {shape.name}
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Croquis thumbnail (Figures tab)
// ---------------------------------------------------------------------------
function CrquisCard({
  type,
  selected,
  onClick,
}: {
  type: CrquisType
  selected: boolean
  onClick: () => void
}) {
  const label = type === "female" ? "Female" : "Male"
  const emoji = type === "female" ? "♀" : "♂"
  const color = type === "female" ? "#f5c5a3" : "#c8a882"

  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex flex-col items-center gap-1.5 p-2 rounded border transition-all ${
        selected
          ? "border-ui-fg-interactive bg-ui-bg-highlight"
          : "border-ui-border-base hover:border-ui-border-strong hover:bg-ui-bg-subtle"
      }`}
    >
      {/* Simple body silhouette preview */}
      <svg width="36" height="80" viewBox="0 0 36 80">
        <ellipse cx="18" cy="6" rx="6" ry="6" fill={color} stroke="#c0b0a8" strokeWidth="0.8"/>
        <rect x={type === "female" ? "10" : "8"} y="12" width={type === "female" ? "16" : "20"} height="30" rx="4" fill={color} stroke="#c0b0a8" strokeWidth="0.8"/>
        <rect x="11" y="42" width="5" height="36" rx="2" fill={color} stroke="#c0b0a8" strokeWidth="0.8"/>
        <rect x="20" y="42" width="5" height="36" rx="2" fill={color} stroke="#c0b0a8" strokeWidth="0.8"/>
      </svg>
      <span className="text-xs font-medium text-ui-fg-base">{emoji} {label}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Pattern piece thumbnail (Cut Patterns tab)
// ---------------------------------------------------------------------------
function PatternCard({
  piece,
  selected,
  onClick,
}: {
  piece: PatternPiece
  selected: boolean
  onClick: () => void
}) {
  const aspect = piece.width / piece.height
  const thumbW = aspect >= 1 ? 56 : Math.round(56 * aspect)
  const thumbH = aspect >= 1 ? Math.round(56 / aspect) : 56

  // Render the piece SVG inline as a small preview via data URL
  const src = useMemo(
    () => `data:image/svg+xml;base64,${btoa(piece.svg)}`,
    [piece.svg]
  )

  return (
    <button
      onClick={onClick}
      title={piece.name}
      className={`flex flex-col items-center gap-1 p-1 rounded border transition-all ${
        selected
          ? "border-ui-fg-interactive bg-ui-bg-highlight"
          : "border-ui-border-base hover:border-ui-border-strong hover:bg-ui-bg-subtle"
      }`}
    >
      <img
        src={src}
        alt={piece.name}
        width={thumbW}
        height={thumbH}
        style={{ objectFit: "contain" }}
      />
      <span className="text-xs text-ui-fg-subtle truncate w-full text-center leading-tight">
        {piece.name}
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------
export function FashionPanel({ excalidrawAPI, getCanvasCenter, onClose }: FashionPanelProps) {
  const [tab, setTab] = useState<Tab>("figures")

  // Figures tab state
  const [selectedFigure, setSelectedFigure] = useState<CrquisType>("female")

  // Garments tab state
  const [garmentCategory, setGarmentCategory] = useState<"body" | "garment">("garment")
  const [selectedShape, setSelectedShape] = useState<FashionShape | null>(null)
  const [perspective, setPerspective] = useState<"flat" | "three-quarter">("flat")

  // Cut Patterns tab state
  const [selectedPattern, setSelectedPattern] = useState<PatternPiece | null>(null)

  // Pinterest tab state
  const [pinterestQuery, setPinterestQuery] = useState("")
  const [pinterestPins, setPinterestPins] = useState<PinterestPin[]>([])
  const [pinterestBookmark, setPinterestBookmark] = useState<string | null>(null)
  const [pinterestLoading, setPinterestLoading] = useState(false)
  const [pinterestError, setPinterestError] = useState<string | null>(null)

  const filteredShapes = FASHION_SHAPES.filter(s => s.category === garmentCategory)

  // ── Insert handlers ──────────────────────────────────────────────────────

  function handleInsertFigure() {
    if (!excalidrawAPI) return
    const center = getCanvasCenter()
    const { fileId, dataUrl, element } = createCrquisElements(
      { type: selectedFigure },
      center.x,
      center.y,
      1
    )
    addImageToCanvas(excalidrawAPI, fileId, dataUrl, element)
  }

  function handleInsertShape() {
    if (!excalidrawAPI || !selectedShape) return
    const center = getCanvasCenter()
    const elements = createShapeElements(selectedShape, center.x, center.y, 1, perspective)
    excalidrawAPI.updateScene({
      elements: [...excalidrawAPI.getSceneElements(), ...elements],
    })
  }

  function handleInsertPattern() {
    if (!excalidrawAPI || !selectedPattern) return
    const center = getCanvasCenter()
    const { fileId, dataUrl, element } = createPatternPieceElement(
      selectedPattern,
      center.x,
      center.y,
      1
    )
    addImageToCanvas(excalidrawAPI, fileId, dataUrl, element)
  }

  // Pinterest handlers
  const handlePinterestSearch = useCallback(async (loadMore = false) => {
    if (!pinterestQuery.trim()) return
    setPinterestLoading(true)
    setPinterestError(null)

    try {
      const params: Record<string, string> = { q: pinterestQuery }
      if (loadMore && pinterestBookmark) {
        params.bookmark = pinterestBookmark
      }

      const result = await sdk.client.fetch<{
        pins: PinterestPin[]
        bookmark: string | null
      }>("/admin/pinterest", { method: "GET", query: params })

      if (loadMore) {
        setPinterestPins((prev) => [...prev, ...result.pins])
      } else {
        setPinterestPins(result.pins)
      }
      setPinterestBookmark(result.bookmark)
    } catch (e: any) {
      setPinterestError(e?.message || "Search failed")
    } finally {
      setPinterestLoading(false)
    }
  }, [pinterestQuery, pinterestBookmark])

  async function handleInsertPin(pin: PinterestPin) {
    if (!excalidrawAPI) return
    const imageUrl = pin.images.original || pin.images.large || pin.images.medium
    if (!imageUrl) return

    const center = getCanvasCenter()

    try {
      // Fetch the image and convert to data URL for Excalidraw
      const response = await fetch(imageUrl)
      const blob = await response.blob()
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.readAsDataURL(blob)
      })

      const fileId = `pinterest_${pin.id}_${Date.now()}`
      const img = new Image()

      img.onload = () => {
        const maxSize = 400
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1)
        const width = img.width * scale
        const height = img.height * scale

        const element = {
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

        addImageToCanvas(excalidrawAPI, fileId, dataUrl, element)
      }

      img.src = dataUrl
    } catch {
      setPinterestError("Failed to load image")
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const tabLabels: { key: Tab; label: string }[] = [
    { key: "figures",  label: "Figures"  },
    { key: "garments", label: "Garments" },
    { key: "patterns", label: "Patterns" },
    { key: "pinterest", label: "Pinterest" },
    { key: "fabric",   label: "Fabric" },
  ]

  return (
    <div className="bg-ui-bg-base border border-ui-border-base rounded-lg shadow-elevation-flyout flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-ui-border-base shrink-0">
        <span className="text-sm font-semibold text-ui-fg-base">Fashion Library</span>
        <button
          onClick={onClose}
          className="text-ui-fg-subtle hover:text-ui-fg-base transition-colors p-0.5 rounded text-xs"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-ui-border-base shrink-0">
        {tabLabels.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
              tab === key
                ? "text-ui-fg-interactive border-b-2 border-ui-fg-interactive"
                : "text-ui-fg-subtle hover:text-ui-fg-base"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="p-3 flex flex-col gap-3 overflow-y-auto" style={{ maxHeight: 440 }}>

        {/* ── FIGURES TAB ──────────────────────────────────────────────── */}
        {tab === "figures" && (
          <>
            <p className="text-xs text-ui-fg-subtle leading-snug">
              Insert a 9-head fashion croquis as a guide layer. Draw garments on top using the Garments tab or Excalidraw tools.
            </p>

            {/* Figure selector */}
            <div className="flex gap-3 justify-center py-1">
              {(["female", "male"] as const).map(type => (
                <CrquisCard
                  key={type}
                  type={type}
                  selected={selectedFigure === type}
                  onClick={() => setSelectedFigure(type)}
                />
              ))}
            </div>

            <button
              onClick={handleInsertFigure}
              className="w-full py-2 text-sm font-medium rounded bg-ui-bg-interactive text-ui-fg-on-inverted hover:opacity-90 transition-colors"
            >
              Insert {selectedFigure === "female" ? "Female" : "Male"} Figure
            </button>
          </>
        )}

        {/* ── GARMENTS TAB ─────────────────────────────────────────────── */}
        {tab === "garments" && (
          <>
            {/* Category toggle */}
            <div className="flex gap-1">
              {(["garment", "body"] as const).map(cat => (
                <button
                  key={cat}
                  onClick={() => { setGarmentCategory(cat); setSelectedShape(null) }}
                  className={`flex-1 py-1 text-xs rounded border transition-colors capitalize ${
                    garmentCategory === cat
                      ? "bg-ui-bg-interactive text-ui-fg-on-inverted border-ui-bg-interactive"
                      : "border-ui-border-base text-ui-fg-subtle hover:bg-ui-bg-subtle"
                  }`}
                >
                  {cat === "garment" ? "Garments" : "Body Shapes"}
                </button>
              ))}
            </div>

            {/* Perspective toggle */}
            <div className="flex gap-1 items-center">
              <span className="text-xs text-ui-fg-subtle mr-1 shrink-0">View</span>
              {(["flat", "three-quarter"] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setPerspective(v)}
                  className={`flex-1 py-1 text-xs rounded border transition-colors ${
                    perspective === v
                      ? "bg-ui-bg-interactive text-ui-fg-on-inverted border-ui-bg-interactive"
                      : "border-ui-border-base text-ui-fg-subtle hover:bg-ui-bg-subtle"
                  }`}
                >
                  {v === "flat" ? "Flat-lay" : "3/4 View"}
                </button>
              ))}
            </div>

            {/* Shape grid */}
            <div className="grid grid-cols-3 gap-2">
              {filteredShapes.map(shape => (
                <ShapeThumbnail
                  key={shape.id}
                  shape={shape}
                  selected={selectedShape?.id === shape.id}
                  perspective={perspective}
                  onClick={() => setSelectedShape(shape)}
                />
              ))}
            </div>

            <button
              onClick={handleInsertShape}
              disabled={!selectedShape}
              className={`w-full py-2 text-sm font-medium rounded transition-colors ${
                selectedShape
                  ? "bg-ui-bg-interactive text-ui-fg-on-inverted hover:opacity-90"
                  : "bg-ui-bg-disabled text-ui-fg-disabled cursor-not-allowed"
              }`}
            >
              {selectedShape ? `Insert ${selectedShape.name}` : "Select a Garment"}
            </button>
          </>
        )}

        {/* ── CUT PATTERNS TAB ─────────────────────────────────────────── */}
        {tab === "patterns" && (
          <>
            <p className="text-xs text-ui-fg-subtle leading-snug">
              Sewing pattern blocks with grain lines and notch marks. Use these as construction references on your moodboard.
            </p>

            {/* Pattern grid */}
            <div className="grid grid-cols-3 gap-2">
              {PATTERN_PIECES.map(piece => (
                <PatternCard
                  key={piece.id}
                  piece={piece}
                  selected={selectedPattern?.id === piece.id}
                  onClick={() => setSelectedPattern(piece)}
                />
              ))}
            </div>

            <button
              onClick={handleInsertPattern}
              disabled={!selectedPattern}
              className={`w-full py-2 text-sm font-medium rounded transition-colors ${
                selectedPattern
                  ? "bg-ui-bg-interactive text-ui-fg-on-inverted hover:opacity-90"
                  : "bg-ui-bg-disabled text-ui-fg-disabled cursor-not-allowed"
              }`}
            >
              {selectedPattern ? `Insert ${selectedPattern.name}` : "Select a Pattern Piece"}
            </button>
          </>
        )}

        {/* ── PINTEREST TAB ──────────────────────────────────────────── */}
        {tab === "pinterest" && (
          <>
            <p className="text-xs text-ui-fg-subtle leading-snug">
              Search Pinterest for inspiration. Click an image to add it to your moodboard.
            </p>

            {/* Search bar */}
            <div className="flex gap-1">
              <input
                type="text"
                placeholder="Search pins..."
                value={pinterestQuery}
                onChange={(e) => setPinterestQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    handlePinterestSearch(false)
                  }
                }}
                className="flex-1 rounded border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-sm outline-none focus:border-ui-fg-interactive"
              />
              <button
                onClick={() => handlePinterestSearch(false)}
                disabled={pinterestLoading || !pinterestQuery.trim()}
                className="px-3 py-1.5 text-xs font-medium rounded bg-ui-bg-interactive text-ui-fg-on-inverted hover:opacity-90 disabled:opacity-50 transition-colors shrink-0"
              >
                {pinterestLoading ? "..." : "Search"}
              </button>
            </div>

            {pinterestError && (
              <p className="text-xs text-ui-fg-error">{pinterestError}</p>
            )}

            {/* Results grid */}
            {pinterestPins.length > 0 && (
              <div className="grid grid-cols-3 gap-1.5">
                {pinterestPins.map((pin) => (
                  <button
                    key={pin.id}
                    onClick={() => handleInsertPin(pin)}
                    title={pin.title || pin.description || "Insert pin"}
                    className="group relative rounded overflow-hidden border border-ui-border-base hover:border-ui-fg-interactive transition-colors"
                  >
                    {pin.images.small || pin.images.medium ? (
                      <img
                        src={pin.images.medium || pin.images.small || ""}
                        alt={pin.title || "Pinterest pin"}
                        className="w-full aspect-square object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full aspect-square bg-ui-bg-subtle flex items-center justify-center">
                        <span className="text-xs text-ui-fg-muted">No image</span>
                      </div>
                    )}
                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                      <span className="text-white text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                        + Add
                      </span>
                    </div>
                    {pin.title && (
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-1 py-0.5">
                        <span className="text-white text-[9px] line-clamp-1">{pin.title}</span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Load more */}
            {pinterestBookmark && pinterestPins.length > 0 && (
              <button
                onClick={() => handlePinterestSearch(true)}
                disabled={pinterestLoading}
                className="w-full py-1.5 text-xs font-medium rounded border border-ui-border-base text-ui-fg-subtle hover:bg-ui-bg-subtle transition-colors"
              >
                {pinterestLoading ? "Loading..." : "Load more"}
              </button>
            )}

            {!pinterestLoading && pinterestPins.length === 0 && pinterestQuery && !pinterestError && (
              <p className="text-xs text-ui-fg-subtle text-center py-4">
                No pins found. Try a different search term.
              </p>
            )}
          </>
        )}

        {/* ── FABRIC PREVIEW TAB ────────────────────────────────────── */}
        {tab === "fabric" && (
          <FabricPreviewTab
            excalidrawAPI={excalidrawAPI}
            getCanvasCenter={getCanvasCenter}
          />
        )}
      </div>
    </div>
  )
}
