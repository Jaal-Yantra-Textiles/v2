import "@excalidraw/excalidraw/index.css"
import { Excalidraw } from "@excalidraw/excalidraw"
import { Badge, Heading, IconButton, Text } from "@medusajs/ui"
import { ArrowsPointingOut, XMark } from "@medusajs/icons"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"

import AvatarBox from "../../components/common/logo-box/avatar-box"
import { sdk } from "../../lib/client"

type PreviewHeader = {
  scope: "order" | "design"
  label: string | null
  usable: boolean
  expires_at: string | null
}

type PreviewDesign = {
  id: string
  name: string | null
  description: string | null
  design_type: string | null
  thumbnail_url: string | null
  quantity: number | null
  moodboard: unknown
}

type PreviewResponse = {
  preview: PreviewHeader
  designs: PreviewDesign[]
}

/** Loose normalize so a stored scene renders read-only (same as designer-invite). */
const toScene = (raw: unknown) => {
  let parsed: any = raw
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.elements)) {
    return null
  }
  if (parsed.elements.length === 0) {
    return null
  }
  return {
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements: parsed.elements,
    appState: { ...(parsed.appState || {}), collaborators: new Map() },
    files: parsed.files && typeof parsed.files === "object" ? parsed.files : {},
  }
}

const MoodboardView = ({ design }: { design: PreviewDesign }) => {
  const scene = useMemo(() => toScene(design.moodboard), [design.moodboard])
  const [expanded, setExpanded] = useState(false)

  // Escape exits fullscreen; lock body scroll while the overlay is open.
  useEffect(() => {
    if (!expanded) {
      return
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setExpanded(false)
      }
    }
    window.addEventListener("keydown", onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [expanded])

  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex items-start justify-between gap-x-2">
        <div className="flex flex-col gap-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Heading level="h2">{design.name || "Design"}</Heading>
            {design.design_type ? <Badge size="2xsmall">{design.design_type}</Badge> : null}
            {design.quantity != null ? (
              <Badge size="2xsmall" color="blue">
                {design.quantity} pcs
              </Badge>
            ) : null}
          </div>
        </div>
        {scene ? (
          <IconButton
            size="small"
            variant="transparent"
            onClick={() => setExpanded(true)}
            aria-label="View moodboard fullscreen"
          >
            <ArrowsPointingOut />
          </IconButton>
        ) : null}
      </div>

      {design.description ? (
        <Text size="small" className="text-ui-fg-base whitespace-pre-wrap">
          {design.description}
        </Text>
      ) : null}

      {scene ? (
        <div
          className={
            expanded
              ? "bg-ui-bg-base fixed inset-0 z-50"
              : "relative h-[60dvh] min-h-[320px] w-full overflow-hidden rounded-md border"
          }
        >
          {expanded ? (
            <IconButton
              size="small"
              variant="primary"
              onClick={() => setExpanded(false)}
              aria-label="Exit fullscreen"
              className="absolute right-4 top-4 z-[60] shadow-elevation-card-rest"
            >
              <XMark />
            </IconButton>
          ) : null}
          <Excalidraw
            key={`${design.id}-${expanded ? "fs" : "inline"}`}
            initialData={scene as any}
            viewModeEnabled={true}
            excalidrawAPI={(api) => {
              setTimeout(() => {
                try {
                  api.scrollToContent(api.getSceneElements(), { fitToContent: true })
                } catch {}
              }, 60)
            }}
            UIOptions={{
              canvasActions: {
                changeViewBackgroundColor: false,
                saveToActiveFile: false,
                saveAsImage: false,
                export: false,
                loadScene: false,
                clearCanvas: false,
                toggleTheme: false,
              },
            }}
          />
        </div>
      ) : design.thumbnail_url ? (
        <img
          src={design.thumbnail_url}
          alt={design.name || "Design"}
          className="w-full rounded-md border object-contain"
        />
      ) : (
        <div className="border-ui-border-base text-ui-fg-muted flex h-[120px] items-center justify-center rounded-md border border-dashed">
          <Text size="small">No moodboard for this design yet.</Text>
        </div>
      )}
    </div>
  )
}

/**
 * #2500 — a read-only page of a bundle's (or one design's) moodboards, opened
 * from a link with no login. The token is the capability; nothing here writes.
 */
export const DesignPreview = () => {
  const { token } = useParams<{ token: string }>()

  const { data, isPending, isError } = useQuery<PreviewResponse>({
    queryKey: ["design-preview", token],
    queryFn: async () =>
      sdk.client.fetch<PreviewResponse>(`/partners/design-previews/${token}`, {
        method: "GET",
      }),
    enabled: !!token,
    retry: false,
  })

  const designs = data?.designs ?? []
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = designs.find((d) => d.id === selectedId) ?? designs[0] ?? null
  const notUsable = !isPending && (isError || !data?.preview?.usable)

  return (
    <div className="bg-ui-bg-subtle min-h-dvh w-full px-4 py-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-y-4">
        <div className="flex items-center gap-x-3">
          <AvatarBox />
          <div className="flex flex-col">
            <Heading>{data?.preview?.label || "Design preview"}</Heading>
            {designs.length > 1 ? (
              <Text size="small" className="text-ui-fg-subtle">
                {designs.length} designs · view only
              </Text>
            ) : null}
          </div>
        </div>

        {isPending ? (
          <Text size="small" className="text-ui-fg-subtle">
            Loading the designs…
          </Text>
        ) : notUsable ? (
          <div className="bg-ui-bg-base shadow-elevation-card-rest flex flex-col gap-y-2 rounded-lg border p-6">
            <Heading level="h2">Link unavailable</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              This preview link has expired or was withdrawn. Ask us for a new one.
            </Text>
          </div>
        ) : designs.length === 0 ? (
          <div className="bg-ui-bg-base shadow-elevation-card-rest rounded-lg border p-6">
            <Text size="small" className="text-ui-fg-subtle">
              There are no designs on this link.
            </Text>
          </div>
        ) : (
          <>
            {designs.length > 1 ? (
              <div className="-mx-4 flex gap-x-2 overflow-x-auto px-4 pb-1">
                {designs.map((d) => {
                  const active = d.id === selected?.id
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setSelectedId(d.id)}
                      className={
                        "flex shrink-0 items-center gap-x-2 rounded-full border px-3 py-1.5 text-left " +
                        (active
                          ? "bg-ui-bg-interactive text-ui-fg-on-color border-transparent"
                          : "bg-ui-bg-base text-ui-fg-base")
                      }
                    >
                      {d.thumbnail_url ? (
                        <img
                          src={d.thumbnail_url}
                          alt=""
                          className="h-6 w-6 rounded-full object-cover"
                        />
                      ) : null}
                      <span className="txt-compact-small whitespace-nowrap">
                        {d.name || "Design"}
                        {d.quantity != null ? ` · ${d.quantity}` : ""}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : null}

            {selected ? (
              <div className="bg-ui-bg-base shadow-elevation-card-rest rounded-lg border p-4 sm:p-6">
                <MoodboardView key={selected.id} design={selected} />
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
