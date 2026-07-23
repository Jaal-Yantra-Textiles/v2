import { Button, DropdownMenu, Heading, Text, toast } from "@medusajs/ui"
import "@excalidraw/excalidraw/index.css"
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Excalidraw } from "@excalidraw/excalidraw"
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import type { BinaryFileData, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types"

import { RouteFocusModal } from "../../../components/modals"
import {
  usePartnerDesign,
  useGenerateMoodboard,
  useMoodboardBlocks,
  useInsertMoodboardBlock,
  useSeedMoodboard,
  useSaveMoodboard,
  useUpdatePartnerBrief,
  type MoodboardBlockListing,
  type PartnerBriefUpdate,
} from "../../../hooks/api/partner-designs"
import { useResolvedDesignId } from "../../../hooks/use-resolved-design-id"
import { ConstructionPicker } from "./construction-picker"
import { MoodboardLayersPanel } from "./moodboard-layers-panel"

// Must match the frame name emitted by buildConstructionDetailsFrame on the
// backend, so re-inserting replaces the existing construction frame in place.
const CONSTRUCTION_FRAME_NAME = "4 · Construction details"

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

// Must match KEYWORDS_LINE_LABEL in build-moodboard-scene.ts — the stable prefix
// on the editable aesthetic-keywords line in the Concept & Identity frame.
const KEYWORDS_LINE_LABEL = "Aesthetic keywords:"

// Read the free-text concept_theme card body out of the canvas (positioned text
// element inside the `brief-field` rectangle).
const readConceptTheme = (elements: readonly any[]): string | null => {
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
  const rx = rect.x
  const ry = rect.y
  const rw = rect.width ?? 0
  const rh = rect.height ?? 0
  const body = elements
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
    .sort((a, b) => b.y - a.y)[0]
  if (!body) {
    return null
  }
  const value = String(body.text).trim()
  if (!value || value === CONCEPT_PLACEHOLDER) {
    return null
  }
  return value
}

// Read the comma-separated aesthetic-keywords line (a text element tagged with
// customData.field === "aesthetic_keywords") back into a string[] (max 8, per
// the brief schema). Returns null when the line is absent or empty.
const readAestheticKeywords = (elements: readonly any[]): string[] | null => {
  const line = elements.find(
    (el) =>
      !el.isDeleted &&
      el.type === "text" &&
      el.customData?.kind === "brief-field" &&
      el.customData?.field === "aesthetic_keywords"
  )
  if (!line || typeof line.text !== "string") {
    return null
  }
  let raw = String(line.text)
  if (raw.startsWith(KEYWORDS_LINE_LABEL)) {
    raw = raw.slice(KEYWORDS_LINE_LABEL.length)
  }
  const kws = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8)
  return kws.length ? kws : null
}

/**
 * #1113 — read the designer's edits to the Concept & Identity frame back out of
 * the canvas so they round-trip to the brief columns. Handles the free-text
 * `concept_theme` card and the editable `aesthetic_keywords` line. Other
 * structured fields (persona/competitors/milestones) remain visual-only.
 * Returns null when nothing round-trippable is present.
 */
const extractBriefEdits = (
  elements: readonly any[]
): PartnerBriefUpdate | null => {
  const edits: PartnerBriefUpdate = {}
  const concept = readConceptTheme(elements)
  if (concept != null) {
    edits.concept_theme = concept
  }
  const keywords = readAestheticKeywords(elements)
  if (keywords != null) {
    edits.aesthetic_keywords = keywords
  }
  return Object.keys(edits).length ? edits : null
}

// Fresh element id — insert-block elements come from the server built at origin
// with deterministic ids, so re-id on every insert to avoid collisions and to
// allow inserting the same block twice.
const genId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `el-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`

/**
 * Re-id a block's elements (remapping internal frameId/containerId/boundElements
 * references) and translate them by (dx, dy) so the block drops into open space
 * on the live canvas without clobbering existing element ids.
 */
const reidAndTranslate = (
  elements: readonly any[],
  dx: number,
  dy: number
): any[] => {
  const idMap = new Map<string, string>()
  elements.forEach((el) => idMap.set(el.id, genId()))
  return elements.map((el) => {
    const next: any = {
      ...el,
      id: idMap.get(el.id),
      x: (el.x ?? 0) + dx,
      y: (el.y ?? 0) + dy,
    }
    if (el.frameId && idMap.has(el.frameId)) {
      next.frameId = idMap.get(el.frameId)
    }
    if (el.containerId && idMap.has(el.containerId)) {
      next.containerId = idMap.get(el.containerId)
    }
    if (Array.isArray(el.boundElements)) {
      next.boundElements = el.boundElements.map((b: any) =>
        b?.id && idMap.has(b.id) ? { ...b, id: idMap.get(b.id) } : b
      )
    }
    return next
  })
}

export const DesignMoodboard = () => {
  const id = useResolvedDesignId()

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const didInitRef = useRef(false)
  const didSeedRef = useRef(false)
  const [isDirty, setIsDirty] = useState(false)
  const [constructionOpen, setConstructionOpen] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)
  // Bumped on canvas change (only while the layers panel is open) so the panel
  // re-reads frames without re-rendering the whole editor on every pointer move.
  const [layersTick, setLayersTick] = useState(0)
  const layersOpenRef = useRef(false)
  useEffect(() => {
    layersOpenRef.current = layersOpen
  }, [layersOpen])

  const { design, isPending, isError, error } = usePartnerDesign(id || "")

  const { mutateAsync: generateMoodboard, isPending: isGenerating } =
    useGenerateMoodboard(id || "")
  const { data: blocksData } = useMoodboardBlocks(id || "")
  const { mutateAsync: insertBlock, isPending: isInserting } =
    useInsertMoodboardBlock(id || "")
  const { mutateAsync: seedMoodboard } = useSeedMoodboard(id || "")
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
    if (layersOpenRef.current) {
      setLayersTick((t) => t + 1)
    }
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

  // Auto-seed an empty board from the brief on open, so the designer lands on an
  // editable snapshot (Figma-style) rather than a blank canvas — no manual
  // "Generate from brief" click. Runs once; the server only fills an empty board
  // (merge-not-clobber) and is no-throw, so there's nothing to undo or toast.
  useEffect(() => {
    if (didSeedRef.current || !id || isPending) {
      return
    }
    const els = moodboard?.elements
    if (Array.isArray(els) && els.length > 0) {
      didSeedRef.current = true // already populated
      return
    }
    didSeedRef.current = true
    ;(async () => {
      try {
        const { moodboard: scene } = await seedMoodboard()
        if (!scene) {
          return
        }
        setTimeout(
          () => loadScene(normalizeMoodboard(scene) || (scene as MoodboardData)),
          60
        )
      } catch {
        // best-effort — auto-seed never blocks editing
      }
    })()
  }, [id, isPending, moodboard, seedMoodboard, loadScene])

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

  // The insert-block palette, grouped for the dropdown menu.
  const groupedBlocks = useMemo(() => {
    const blocks: MoodboardBlockListing[] = blocksData?.blocks ?? []
    const order = ["Brief", "Tech-pack", "Workspace"]
    const byGroup: Record<string, MoodboardBlockListing[]> = {}
    for (const b of blocks) {
      ;(byGroup[b.group] ??= []).push(b)
    }
    return order
      .filter((g) => byGroup[g]?.length)
      .map((g) => ({ group: g, items: byGroup[g] }))
  }, [blocksData])

  // Drop one pre-filled block onto the canvas, placed to the right of existing
  // content, re-id'd so it never collides. Non-destructive: the designer arranges
  // it and saves via the normal Save button. `replaceFrameNamed` strips any
  // existing frame with that name first — a "refresh this frame" (used to
  // re-render the construction glyph after a detail is added) rather than an
  // additive drop-in.
  const handleInsert = useCallback(
    async (key: string, label: string, replaceFrameNamed?: string) => {
      const api = apiRef.current
      if (!api || !id) {
        return
      }
      try {
        const { block } = await insertBlock(key)
        const els = (block?.elements ?? []) as any[]
        if (!els.length) {
          toast.info(`Nothing to insert for "${label}" yet.`)
          return
        }

        let existing = api.getSceneElements().filter((e: any) => !e.isDeleted)
        if (replaceFrameNamed) {
          const removeIds = new Set(
            existing
              .filter(
                (e: any) => e.type === "frame" && e.name === replaceFrameNamed
              )
              .map((e: any) => e.id)
          )
          if (removeIds.size) {
            existing = existing.filter(
              (e: any) => !removeIds.has(e.id) && !removeIds.has(e.frameId)
            )
          }
        }

        let dx = 0
        let dy = 0
        if (existing.length) {
          const maxX = Math.max(
            ...existing.map((e: any) => (e.x ?? 0) + (e.width ?? 0))
          )
          const minY = Math.min(...existing.map((e: any) => e.y ?? 0))
          dx = maxX + 120 // one frame gap to the right
          dy = minY
        }
        const placed = reidAndTranslate(els, dx, dy)

        const files = block?.files ?? {}
        const fileList = Object.entries(files).map(
          ([fid, f]: [string, any]) => ({
            id: fid,
            dataURL: f.dataURL,
            mimeType: f.mimeType || "image/png",
            created: f.created || Date.now(),
            lastRetrieved: Date.now(),
          })
        )
        if (fileList.length) {
          api.addFiles(fileList as any)
        }

        api.updateScene({ elements: [...existing, ...placed] as any })
        api.scrollToContent(placed as any, { fitToContent: true })
        setIsDirty(true)
        if (!replaceFrameNamed) {
          toast.success(`Inserted "${label}"`)
        }
      } catch (err: any) {
        toast.error(err?.message || "Failed to insert block")
      }
    },
    [id, insertBlock]
  )

  // After a construction detail is added, re-render the construction frame from
  // the design's fresh data (replacing the existing one in place).
  const handleConstructionAdded = useCallback(() => {
    handleInsert("construction", "Construction details", CONSTRUCTION_FRAME_NAME)
  }, [handleInsert])

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

      // Round-trip Concept & Identity edits (concept_theme + aesthetic_keywords)
      // back to the brief columns.
      const briefEdits = extractBriefEdits(elements)
      if (briefEdits) {
        const cur = (design as any) || {}
        const conceptChanged =
          "concept_theme" in briefEdits &&
          briefEdits.concept_theme !== cur.concept_theme
        const keywordsChanged =
          "aesthetic_keywords" in briefEdits &&
          JSON.stringify(briefEdits.aesthetic_keywords ?? []) !==
            JSON.stringify(cur.aesthetic_keywords ?? [])
        if (conceptChanged || keywordsChanged) {
          try {
            await updateBrief(briefEdits)
          } catch {
            // A brief write-back failure shouldn't lose the saved scene; surface
            // softly and keep the moodboard save.
            toast.warning("Moodboard saved, but the brief edit couldn't be synced.")
          }
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
            {layersOpen ? (
              <div className="absolute top-14 left-2 z-50 w-64">
                <MoodboardLayersPanel
                  excalidrawAPI={apiRef.current}
                  tick={layersTick}
                  onClose={() => setLayersOpen(false)}
                />
              </div>
            ) : null}
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
              renderTopRightUI={() => (
                <div className="flex items-center gap-1.5 flex-wrap justify-end max-w-[62vw]">
                  <DropdownMenu>
                    <DropdownMenu.Trigger asChild>
                      <Button
                        size="small"
                        variant="secondary"
                        disabled={!id || isSaving || isInserting}
                        isLoading={isInserting}
                      >
                        Insert block
                      </Button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content>
                      {groupedBlocks.length === 0 ? (
                        <DropdownMenu.Item disabled>
                          No blocks available
                        </DropdownMenu.Item>
                      ) : (
                        groupedBlocks.map((grp, gi) => (
                          <Fragment key={grp.group}>
                            {gi > 0 ? <DropdownMenu.Separator /> : null}
                            <DropdownMenu.Label>{grp.group}</DropdownMenu.Label>
                            {grp.items.map((b) => (
                              <DropdownMenu.Item
                                key={b.key}
                                // Brief blocks stay insertable even when empty —
                                // they drop an editable template you fill in place.
                                disabled={b.group !== "Brief" && !b.available}
                                onClick={() => handleInsert(b.key, b.label)}
                              >
                                {b.label}
                                {!b.available ? (
                                  <span className="text-ui-fg-muted ml-1">· empty</span>
                                ) : null}
                              </DropdownMenu.Item>
                            ))}
                          </Fragment>
                        ))
                      )}
                    </DropdownMenu.Content>
                  </DropdownMenu>
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => setConstructionOpen(true)}
                    disabled={!id || isSaving}
                  >
                    Add construction
                  </Button>
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={handleGenerate}
                    disabled={!id || isGenerating || isSaving}
                    isLoading={isGenerating}
                  >
                    Generate
                  </Button>
                  <Button
                    size="small"
                    variant={layersOpen ? "primary" : "secondary"}
                    onClick={() => setLayersOpen((v) => !v)}
                    disabled={!id}
                  >
                    Layers
                  </Button>
                  <Button
                    size="small"
                    variant="primary"
                    onClick={handleSave}
                    disabled={!id || isSaving || !isDirty}
                    isLoading={isSaving}
                  >
                    {isDirty ? "Save" : "Saved"}
                  </Button>
                </div>
              )}
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
        <div className="flex items-center justify-between w-full gap-x-2">
          <Text size="xsmall" className="text-ui-fg-muted">
            Insert, construction, generate, layers &amp; save are in the canvas
            toolbar (top-right).
          </Text>
          <RouteFocusModal.Close asChild>
            <Button size="small" variant="secondary">
              Close
            </Button>
          </RouteFocusModal.Close>
        </div>
      </RouteFocusModal.Footer>

      {id ? (
        <ConstructionPicker
          designId={id}
          open={constructionOpen}
          onOpenChange={setConstructionOpen}
          onAdded={handleConstructionAdded}
        />
      ) : null}
    </RouteFocusModal>
  )
}
