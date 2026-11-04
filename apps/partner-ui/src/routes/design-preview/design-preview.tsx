import "@excalidraw/excalidraw/index.css"
import { Excalidraw } from "@excalidraw/excalidraw"
import { Badge, Button, Heading, IconButton, Text, clx } from "@medusajs/ui"
import { ArrowsPointingOut, ChevronLeft, ChevronRight, XMark } from "@medusajs/icons"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"

import AvatarBox from "../../components/common/logo-box/avatar-box"
import { Skeleton } from "../../components/common/skeleton"
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

/** Board height: most of a phone screen, capped on a desktop. */
const BOARD_SIZE = "h-[62dvh] min-h-[300px] sm:h-[560px]"

/** The stock skeleton shade nearly vanishes on the subtle page background. */
const SHADE = "bg-ui-bg-subtle-pressed"

/** The page while the link loads — same frame as the loaded page, so nothing jumps. */
const PreviewSkeleton = () => (
  <>
    <div className="-mx-3 flex gap-x-2 overflow-hidden px-3 sm:mx-0 sm:px-0">
      {[96, 124, 140, 112].map((w) => (
        <Skeleton key={w} className={clx(SHADE, "h-9 shrink-0 rounded-full")} style={{ width: w }} />
      ))}
    </div>
    <div className="bg-ui-bg-base shadow-elevation-card-rest flex flex-col gap-y-3 rounded-xl border p-3 sm:p-6">
      <div className="flex items-center gap-x-2">
        <Skeleton className={clx(SHADE, "h-6 w-40")} />
        <Skeleton className={clx(SHADE, "h-5 w-12 rounded-full")} />
      </div>
      <Skeleton className={clx(SHADE, "h-4 w-3/4")} />
      <Skeleton className={clx(SHADE, "w-full rounded-lg", BOARD_SIZE)} />
    </div>
  </>
)

const MoodboardView = ({ design }: { design: PreviewDesign }) => {
  const scene = useMemo(() => toScene(design.moodboard), [design.moodboard])
  const [expanded, setExpanded] = useState(false)
  const [showAll, setShowAll] = useState(false)
  // Roughly more than three lines on a phone: long, or several paragraphs.
  const longText =
    (design.description?.trim().length ?? 0) > 160 ||
    (design.description?.trim().split("\n").length ?? 0) > 3

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
      <div className="flex items-start justify-between gap-x-3">
        <div className="flex min-w-0 flex-col gap-y-1.5">
          <Heading level="h2" className="break-words">
            {design.name || "Design"}
          </Heading>
          <div className="flex flex-wrap items-center gap-1.5">
            {design.quantity != null ? (
              <Badge size="2xsmall" color="blue">
                {design.quantity} pcs
              </Badge>
            ) : null}
            {design.design_type ? <Badge size="2xsmall">{design.design_type}</Badge> : null}
          </div>
        </div>
        {scene ? (
          <IconButton
            size="base"
            variant="transparent"
            className="bg-ui-bg-base shadow-buttons-neutral shrink-0"
            onClick={() => setExpanded(true)}
            aria-label="View moodboard fullscreen"
          >
            <ArrowsPointingOut />
          </IconButton>
        ) : null}
      </div>

      {design.description ? (
        <div className="flex flex-col items-start gap-y-1">
          <Text
            size="small"
            className={clx("text-ui-fg-subtle whitespace-pre-wrap", !showAll && "line-clamp-3")}
          >
            {design.description.trim()}
          </Text>
          {longText ? (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="txt-compact-small-plus text-ui-fg-interactive"
            >
              {showAll ? "Show less" : "Show more"}
            </button>
          ) : null}
        </div>
      ) : null}

      {scene ? (
        <div
          className={
            expanded
              ? "bg-ui-bg-base fixed inset-0 z-50"
              : clx("relative w-full overflow-hidden rounded-lg border", BOARD_SIZE)
          }
        >
          {expanded ? (
            <IconButton
              size="large"
              variant="primary"
              onClick={() => setExpanded(false)}
              aria-label="Exit fullscreen"
              className="shadow-elevation-card-rest absolute right-3 top-3 z-[60]"
              style={{ top: "max(0.75rem, env(safe-area-inset-top))" }}
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
          className="w-full rounded-lg border object-contain"
        />
      ) : (
        <div className="border-ui-border-base text-ui-fg-muted flex h-[140px] items-center justify-center rounded-lg border border-dashed px-4 text-center">
          <Text size="small">No moodboard for this design yet.</Text>
        </div>
      )}
    </div>
  )
}

/**
 * #2500 — a read-only page of a bundle's (or one design's) moodboards, opened
 * from a link with no login, mostly on a phone from WhatsApp. The token is the
 * capability; nothing here writes.
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
  const index = Math.max(
    0,
    designs.findIndex((d) => d.id === selectedId)
  )
  const selected = designs[index] ?? null
  const notUsable = !isPending && (isError || !data?.preview?.usable)
  const many = designs.length > 1

  const go = (next: number) => {
    const d = designs[next]
    if (!d) return
    setSelectedId(d.id)
    // Keep the chip for the new design in view, and bring the card to the top.
    document.getElementById(`chip-${d.id}`)?.scrollIntoView({ inline: "center", block: "nearest" })
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  return (
    <div className="bg-ui-bg-subtle min-h-dvh w-full pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-y-3 px-3 pt-4 sm:gap-y-4 sm:px-6 sm:pt-8">
        <div className="flex items-center gap-x-3">
          <div className="shrink-0 [&>*]:!mb-0">
            <AvatarBox />
          </div>
          <div className="flex min-w-0 flex-col gap-y-0.5">
            {isPending ? (
              <>
                <Skeleton className={clx(SHADE, "h-7 w-48")} />
                <Skeleton className={clx(SHADE, "mt-1 h-4 w-28")} />
              </>
            ) : (
              <>
                <Heading className="truncate">{data?.preview?.label || "Design preview"}</Heading>
                {!notUsable && designs.length > 0 ? (
                  <Text size="small" className="text-ui-fg-subtle">
                    {many ? `${designs.length} designs · ` : ""}view only
                  </Text>
                ) : null}
              </>
            )}
          </div>
        </div>

        {isPending ? (
          <PreviewSkeleton />
        ) : notUsable ? (
          <div className="bg-ui-bg-base shadow-elevation-card-rest flex flex-col gap-y-2 rounded-xl border p-4 sm:p-6">
            <Heading level="h2">Link unavailable</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              This preview link has expired or was withdrawn. Ask us for a new one.
            </Text>
          </div>
        ) : designs.length === 0 ? (
          <div className="bg-ui-bg-base shadow-elevation-card-rest rounded-xl border p-4 sm:p-6">
            <Text size="small" className="text-ui-fg-subtle">
              There are no designs on this link.
            </Text>
          </div>
        ) : (
          <>
            {many ? (
              // Sticky so the designs stay one tap away while scrolling a tall board.
              <div className="bg-ui-bg-subtle/95 sticky top-0 z-10 -mx-3 py-2 backdrop-blur sm:-mx-6">
                <div className="flex snap-x scroll-px-3 gap-x-2 overflow-x-auto px-3 [scrollbar-width:none] sm:scroll-px-6 sm:px-6 [&::-webkit-scrollbar]:hidden">
                  {designs.map((d) => {
                    const active = d.id === selected?.id
                    return (
                      <button
                        key={d.id}
                        id={`chip-${d.id}`}
                        type="button"
                        onClick={() => setSelectedId(d.id)}
                        aria-pressed={active}
                        className={clx(
                          "flex h-9 shrink-0 snap-start items-center gap-x-2 rounded-full border px-3.5 transition-colors",
                          active
                            ? "bg-ui-fg-base text-ui-bg-base border-transparent"
                            : "bg-ui-bg-base text-ui-fg-base hover:bg-ui-bg-base-hover"
                        )}
                      >
                        {d.thumbnail_url ? (
                          <img src={d.thumbnail_url} alt="" className="h-6 w-6 rounded-full object-cover" />
                        ) : null}
                        <span className="txt-compact-small-plus whitespace-nowrap">
                          {d.name || "Design"}
                        </span>
                        {d.quantity != null ? (
                          <span
                            className={clx(
                              "txt-compact-xsmall rounded-full px-1.5",
                              active ? "bg-ui-bg-base/20" : "bg-ui-bg-component text-ui-fg-subtle"
                            )}
                          >
                            {d.quantity}
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {selected ? (
              <div className="bg-ui-bg-base shadow-elevation-card-rest rounded-xl border p-3 sm:p-6">
                <MoodboardView key={selected.id} design={selected} />
              </div>
            ) : null}

            {many ? (
              <div className="flex items-center justify-between gap-x-2">
                <Button
                  variant="secondary"
                  size="large"
                  className="flex-1 sm:flex-none"
                  disabled={index === 0}
                  onClick={() => go(index - 1)}
                >
                  <ChevronLeft />
                  Previous
                </Button>
                <Text size="small" className="text-ui-fg-subtle shrink-0 tabular-nums">
                  {index + 1} of {designs.length}
                </Text>
                <Button
                  variant="secondary"
                  size="large"
                  className="flex-1 sm:flex-none"
                  disabled={index === designs.length - 1}
                  onClick={() => go(index + 1)}
                >
                  Next
                  <ChevronRight />
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
