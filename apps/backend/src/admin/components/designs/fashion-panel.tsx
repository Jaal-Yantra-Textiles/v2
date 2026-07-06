import { useState, useCallback } from "react"
import { sdk } from "../../lib/config"
import { FabricPreviewTab } from "./fabric-preview-tab"
import { RedesignTab } from "./redesign-tab"
import { OutlineTab } from "./outline-tab"

interface FashionPanelProps {
  excalidrawAPI: any | null
  getCanvasCenter: () => { x: number; y: number }
  onClose: () => void
  initialTab?: string
}

type Tab = "pinterest" | "fabric" | "redesign" | "outline"

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
// Main panel
// ---------------------------------------------------------------------------
export function FashionPanel({ excalidrawAPI, getCanvasCenter, onClose, initialTab }: FashionPanelProps) {
  const [tab, setTab] = useState<Tab>((initialTab as Tab) || "pinterest")

  // Pinterest tab state
  const [pinterestQuery, setPinterestQuery] = useState("")
  const [pinterestPins, setPinterestPins] = useState<PinterestPin[]>([])
  const [pinterestBookmark, setPinterestBookmark] = useState<string | null>(null)
  const [pinterestLoading, setPinterestLoading] = useState(false)
  const [pinterestError, setPinterestError] = useState<string | null>(null)

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
    { key: "pinterest", label: "Pinterest" },
    { key: "fabric",   label: "Fabric" },
    { key: "redesign", label: "Redesign" },
    { key: "outline",  label: "Outline" },
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

        {/* ── REDESIGN TAB ──────────────────────────────────────────── */}
        {tab === "redesign" && (
          <RedesignTab
            excalidrawAPI={excalidrawAPI}
            getCanvasCenter={getCanvasCenter}
          />
        )}

        {/* ── OUTLINE TAB ───────────────────────────────────────────── */}
        {tab === "outline" && (
          <OutlineTab
            excalidrawAPI={excalidrawAPI}
            getCanvasCenter={getCanvasCenter}
          />
        )}
      </div>
    </div>
  )
}
