import { Button, Heading, Text, toast } from "@medusajs/ui"
import "@excalidraw/excalidraw/index.css"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Excalidraw } from "@excalidraw/excalidraw"
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import type { BinaryFileData, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types"

import { RouteFocusModal } from "../../../components/modals"
import {
  usePartnerDesign,
  useGenerateMoodboard,
  useSaveMoodboard,
  useUpdatePartnerBrief,
  type PartnerBriefUpdate,
} from "../../../hooks/api/partner-designs"
import { useResolvedDesignId } from "../../../hooks/use-resolved-design-id"

type MoodboardData = {
  type?: string
  version?: number
  source?: string
  elements?: ExcalidrawElement[]
  files?: Record<string, BinaryFileData>
  appState?: Record<string, any>
}

const normalizeMoodboard = (raw: unknown): MoodboardData | null => {
  if (!raw) {
    return null
  }

  let parsed: any = raw
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return null
  }

  const elements: ExcalidrawElement[] = Array.isArray(parsed.elements)
    ? (parsed.elements as ExcalidrawElement[])
    : []

  const files: Record<string, BinaryFileData> =
    parsed.files && typeof parsed.files === "object" ? (parsed.files as any) : {}

  // Excalidraw sometimes expects `files[fileId]` even if the element has a `url`.
  // Old UI had logic to reconstruct missing file entries from element urls.
  const nextFiles: Record<string, BinaryFileData> = { ...files }
  for (const el of elements as any[]) {
    if (el?.type !== "image") {
      continue
    }
    const fileId = el?.fileId
    if (!fileId || nextFiles[fileId]) {
      continue
    }

    const url: string | undefined =
      typeof el?.url === "string"
        ? el.url
        : typeof el?.src === "string"
        ? el.src
        : undefined

    if (url && url.startsWith("http")) {
      nextFiles[fileId] = {
        id: fileId,
        dataURL: url,
        mimeType: el?.mimeType || "image/png",
        created: Date.now(),
        lastRetrieved: Date.now(),
      } as any
    }
  }

  return {
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements,
    appState: (parsed.appState || {}) as Record<string, any>,
    files: nextFiles,
  }
}

// Placeholder copy the generator writes when the concept card is empty — never
// persist it back as a real value.
const CONCEPT_PLACEHOLDER = "Set the overarching story or inspiration."

/**
 * #1113 S3 — read the designer's edits to `brief-field` cards back out of the
 * canvas so they round-trip to the brief columns.
 *
 * Only the free-text `concept_theme` card is round-tripped: its value lives in a
 * standalone text element sitting inside the card rectangle (the rectangle
 * carries `customData.field`; the text is positioned, not bound). Structured
 * fields (persona/competitors/aesthetic_keywords/milestones) are visual-only
 * edits here — they're JSON, not naive text, so we never guess them back.
 */
const extractBriefEdits = (
  elements: readonly any[]
): PartnerBriefUpdate | null => {
  const rect = elements.find(
    (el) =>
      !el.isDeleted &&
      el.type === "rectangle" &&
      el.customData?.kind === "brief-field" &&
      el.customData?.field === "concept_theme"
  )
  if (!rect) {
    return null
  }

  // Find the body text element geometrically inside the card, below the heading.
  const rx = rect.x
  const ry = rect.y
  const rw = rect.width ?? 0
  const rh = rect.height ?? 0
  const bodies = elements
    .filter(
      (el) =>
        !el.isDeleted &&
        el.type === "text" &&
        typeof el.text === "string" &&
        el.x >= rx - 4 &&
        el.x <= rx + rw &&
        el.y > ry + 30 &&
        el.y < ry + rh
    )
    // The body text is the lower one (y ~+46); heading sits at y ~+16.
    .sort((a, b) => b.y - a.y)

  const body = bodies[0]
  if (!body) {
    return null
  }

  const value = String(body.text).trim()
  if (!value || value === CONCEPT_PLACEHOLDER) {
    return null
  }

  return { concept_theme: value }
}

export const DesignMoodboard = () => {
  const id = useResolvedDesignId()

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const didInitRef = useRef(false)
  const [isDirty, setIsDirty] = useState(false)

  const { design, isPending, isError, error } = usePartnerDesign(id || "")

  const { mutateAsync: generateMoodboard, isPending: isGenerating } =
    useGenerateMoodboard(id || "")
  const { mutateAsync: saveMoodboard, isPending: isSavingScene } = useSaveMoodboard(
    id || ""
  )
  const { mutateAsync: updateBrief } = useUpdatePartnerBrief(id || "")

  if (isError) {
    throw error
  }

  const moodboard = useMemo(() => normalizeMoodboard((design as any)?.moodboard), [design])

  useEffect(() => {
    if (!apiRef.current) {
      return
    }

    const elements = (moodboard?.elements || []) as ExcalidrawElement[]
    const t = setTimeout(() => {
      try {
        apiRef.current?.scrollToContent(elements.length ? elements : apiRef.current.getSceneElements(), {
          fitToContent: true,
        })
      } catch {}
    }, 50)

    return () => clearTimeout(t)
  }, [moodboard])

  // Excalidraw fires onChange on mount; ignore that first tick so the Save
  // button only lights up on a real edit.
  const handleChange = useCallback(() => {
    if (!didInitRef.current) {
      didInitRef.current = true
      return
    }
    setIsDirty(true)
  }, [])

  // Load a freshly-generated scene straight into the canvas so it's editable.
  const loadScene = useCallback((scene: MoodboardData) => {
    const api = apiRef.current
    if (!api) {
      return
    }
    const files = scene.files ?? {}
    const fileList = Object.entries(files).map(([fid, f]: [string, any]) => ({
      id: fid,
      dataURL: f.dataURL,
      mimeType: f.mimeType || "image/png",
      created: f.created || Date.now(),
      lastRetrieved: Date.now(),
    }))
    if (fileList.length) {
      api.addFiles(fileList as any)
    }
    api.updateScene({
      elements: (scene.elements ?? []) as any,
      appState: { ...(scene.appState ?? {}), collaborators: new Map() },
    })
    api.scrollToContent((scene.elements ?? []) as any, { fitToContent: true })
  }, [])

  const handleGenerate = useCallback(async () => {
    if (!id) {
      return
    }
    const proceed = window.confirm(
      "Generate the moodboard from this design's brief? Your existing cards are merged, not replaced."
    )
    if (!proceed) {
      return
    }
    toast.loading("Generating moodboard…")
    try {
      const { moodboard: scene } = await generateMoodboard()
      loadScene(normalizeMoodboard(scene) || (scene as MoodboardData))
      setIsDirty(false)
      toast.dismiss()
      toast.success("Moodboard generated")
    } catch (err: any) {
      toast.dismiss()
      toast.error(err?.message || "Failed to generate moodboard")
    }
  }, [id, generateMoodboard, loadScene])

  const handleSave = useCallback(async () => {
    const api = apiRef.current
    if (!api || !id) {
      return
    }
    toast.loading("Saving moodboard…")
    try {
      const elements = api.getSceneElements()
      const appState = api.getAppState() as any
      const files = api.getFiles()

      const scene: MoodboardData = {
        type: "excalidraw",
        version: 2,
        source: "https://excalidraw.com",
        elements: elements as any,
        appState: {
          viewBackgroundColor: appState.viewBackgroundColor,
          gridSize: appState.gridSize,
          theme: appState.theme,
        },
        files: files as any,
      }

      await saveMoodboard(scene)

      // Round-trip concept-card text edits back to the brief column.
      const briefEdits = extractBriefEdits(elements)
      if (briefEdits && briefEdits.concept_theme !== (design as any)?.concept_theme) {
        try {
          await updateBrief(briefEdits)
        } catch {
          // A brief write-back failure shouldn't lose the saved scene; surface
          // softly and keep the moodboard save.
          toast.warning("Moodboard saved, but the brief edit couldn't be synced.")
        }
      }

      setIsDirty(false)
      toast.dismiss()
      toast.success("Moodboard saved")
    } catch (err: any) {
      toast.dismiss()
      toast.error(err?.message || "Failed to save moodboard")
    }
  }, [id, saveMoodboard, updateBrief, design])

  const isSaving = isSavingScene

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header>
        <RouteFocusModal.Title asChild>
          <Heading>Moodboard</Heading>
        </RouteFocusModal.Title>
        <RouteFocusModal.Description className="sr-only">
          Moodboard
        </RouteFocusModal.Description>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body>
        {!id ? (
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle">
              Missing design id.
            </Text>
          </div>
        ) : isPending ? (
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle">
              Loading...
            </Text>
          </div>
        ) : (
          <div className="relative w-full h-[calc(100dvh-160px)]">
            <Excalidraw
              excalidrawAPI={(api) => {
                apiRef.current = api
              }}
              initialData={
                (moodboard as any) || {
                  type: "excalidraw",
                  version: 2,
                  source: "https://excalidraw.com",
                  elements: [],
                  appState: {},
                  files: {},
                }
              }
              viewModeEnabled={false}
              onChange={handleChange}
              UIOptions={{
                canvasActions: {
                  changeViewBackgroundColor: true,
                  saveToActiveFile: false,
                  saveAsImage: true,
                  export: { saveFileToDisk: true },
                  loadScene: false,
                  clearCanvas: false,
                  toggleTheme: true,
                },
              }}
              detectScroll={true}
            />
          </div>
        )}
      </RouteFocusModal.Body>

      <RouteFocusModal.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button size="small" variant="secondary">
              Close
            </Button>
          </RouteFocusModal.Close>
          <Button
            size="small"
            variant="secondary"
            onClick={handleGenerate}
            disabled={!id || isGenerating || isSaving}
            isLoading={isGenerating}
          >
            Generate from brief
          </Button>
          <Button
            size="small"
            variant="primary"
            onClick={handleSave}
            disabled={!id || isSaving || !isDirty}
            isLoading={isSaving}
          >
            {isDirty ? "Save changes" : "Saved"}
          </Button>
        </div>
      </RouteFocusModal.Footer>
    </RouteFocusModal>
  )
}
