import { Button, DropdownMenu, Heading, Text, toast } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import "@excalidraw/excalidraw/index.css"
// Scoped overrides that map Excalidraw's theme variables onto Medusa tokens —
// must import after Excalidraw's own CSS so equal-specificity ties resolve to us.
import "./moodboard.css"
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Excalidraw } from "@excalidraw/excalidraw"
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import type { BinaryFileData, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types"
import { normalizeMoodboardScene } from "../../../lib/moodboard-scene"
import {
  BoardSwitcher,
  type BoardOption,
} from "../../../components/moodboard/board-switcher"


import { RouteFocusModal } from "../../../components/modals"
import {
  usePartnerDesign,
  usePartnerDesignMoodboards,
  useGenerateMoodboard,
  useMoodboardBlocks,
  useInsertMoodboardBlock,
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

// Resolve the effective admin theme so the canvas matches its surroundings
// instead of Excalidraw's hard-coded light default. Medusa's admin (and this
// embedded dashboard) toggles a `.dark` class on the document root, which itself
// tracks the user's system/admin preference.
const getAdminTheme = (): "light" | "dark" =>
  typeof document !== "undefined" &&
  document.documentElement.classList.contains("dark")
    ? "dark"
    : "light"

export const DesignMoodboard = () => {
  const { t } = useTranslation()
  const id = useResolvedDesignId()

  // Follow the admin theme live — observe the root `.dark` class (and system
  // preference as a fallback) so toggling dark mode reflows the canvas.
  const [theme, setTheme] = useState<"light" | "dark">(getAdminTheme)
  useEffect(() => {
    const update = () => setTheme(getAdminTheme())
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })
    const media = window.matchMedia?.("(prefers-color-scheme: dark)")
    media?.addEventListener?.("change", update)
    return () => {
      observer.disconnect()
      media?.removeEventListener?.("change", update)
    }
  }, [])

  /**
   * 🔴 Keep the RouteFocusModal open while Excalidraw's own dialogs are used.
   *
   * Excalidraw portals its dialogs to `document.body`, OUTSIDE our modal's
   * content. Radix treats a pointerdown out there as "clicked outside" and
   * closes us — so once `moodboard.css` restores pointer-events to that portal,
   * the first click on PNG would export nothing and shut the editor instead.
   *
   * Stopped at the CONTAINER on the way up, not at `document` on the way down:
   * a capture-phase listener would swallow the event before the button ever
   * saw it, which is the same dead click by another route. Here the button
   * handles it first, then the bubble stops before Radix's document listener.
   */
  useEffect(() => {
    const swallow = (e: Event) => e.stopPropagation()
    const wired = new WeakSet<Element>()

    const wire = () => {
      document
        .querySelectorAll<HTMLElement>("body > .excalidraw-modal-container")
        .forEach((el) => {
          if (wired.has(el)) {
            return
          }
          wired.add(el)
          // Both, because Radix listens for pointerdown and focus escapes.
          el.addEventListener("pointerdown", swallow)
          el.addEventListener("mousedown", swallow)
          el.addEventListener("touchstart", swallow)
        })
    }

    wire()
    const observer = new MutationObserver(wire)
    observer.observe(document.body, { childList: true })
    return () => observer.disconnect()
  }, [])

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const didInitRef = useRef(false)
  const [isDirty, setIsDirty] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
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

  /**
   * #2017 — a design has one board per OWNER now. `own` is this partner's and
   * editable; `others` are the admin's and any other partner's, read-only.
   */
  const {
    own: ownBoard,
    others: otherBoards,
    usedLegacyFallback,
    isPending: boardsPending,
  } = usePartnerDesignMoodboards(id || "", { enabled: !!id })
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null)

  const { mutateAsync: generateMoodboard, isPending: isGenerating } =
    useGenerateMoodboard(id || "")
  const { data: blocksData } = useMoodboardBlocks(id || "")
  const { mutateAsync: insertBlock, isPending: isInserting } =
    useInsertMoodboardBlock(id || "")
  const { mutateAsync: saveMoodboard, isPending: isSavingScene } = useSaveMoodboard(
    id || ""
  )
  const { mutateAsync: updateBrief } = useUpdatePartnerBrief(id || "")

  if (isError) {
    throw error
  }

  const allBoards = useMemo<BoardOption[]>(
    () => [...(ownBoard ? [ownBoard] : []), ...(otherBoards ?? [])],
    [ownBoard, otherBoards]
  )
  /** Default to your own board; fall back to the first available one. */
  const activeBoard = useMemo(
    () =>
      allBoards.find((b) => b.id === selectedBoardId) ?? ownBoard ?? allBoards[0] ?? null,
    [allBoards, selectedBoardId, ownBoard]
  )
  /**
   * 🔴 READ-ONLY when the board is not yours. Editing someone else's board is
   * exactly what #2017 removed at the database — letting the canvas stay
   * editable would put the same mistake back one layer up, with the save
   * silently landing on YOUR board instead and the partner believing they had
   * corrected ours.
   *
   * `is_own` comes from the server, not from comparing ids here: the surface
   * that decides who may write is the one that must answer this.
   */
  const isReadOnly = !!activeBoard && !activeBoard.is_own

  /**
   * The scene to render. Prefer the selected board's; fall back to the legacy
   * `design.moodboard` column so a design whose rows have not been created yet
   * still opens on its content rather than a blank canvas.
   */
  const moodboard = useMemo(
    () =>
      normalizeMoodboardScene<ExcalidrawElement, BinaryFileData>(
        activeBoard?.scene ?? (design as any)?.moodboard
      ),
    [activeBoard, design]
  )

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

  /**
   * 🔴 `initialData` IS READ ONCE, AT MOUNT.
   *
   * Two things arrive after that and neither reached the canvas:
   *
   *  1. The board itself. The editor was gated on the DESIGN query while the
   *     scene comes from the BOARDS query, so on a fresh load Excalidraw
   *     mounted with an empty `initialData` and never saw the board. The tell
   *     was precise and easy to misread as a rendering bug: the canvas sat at
   *     30% zoom — `scrollToContent` had fitted to the elements' real extent —
   *     with nothing drawn, and Excalidraw's own export answered "Cannot
   *     export empty canvas". The board was on the wire and in React state the
   *     whole time. The mount gate below fixes that case.
   *  2. A different board, picked in the switcher. Same cause, no gate can fix
   *     it: the component does not remount.
   *
   * So the scene is pushed IMPERATIVELY whenever the active board changes.
   * `loadScene` triggers Excalidraw's `onChange`, which would light up Save on
   * work the partner has not done, so the dirty flag is cleared after.
   */
  const loadedBoardRef = useRef<string | null>(null)
  useEffect(() => {
    const api = apiRef.current
    const boardId = activeBoard?.id ?? null
    if (!api || boardId === loadedBoardRef.current) {
      return
    }
    loadedBoardRef.current = boardId
    loadScene((moodboard ?? { elements: [], files: {}, appState: {} }) as MoodboardData)
    setIsDirty(false)
  }, [activeBoard, moodboard, loadScene])


  /**
   * #2019 — STARTING A BOARD IS A DECISION, NOT A SIDE EFFECT OF ARRIVING.
   *
   * Opening an empty board used to POST `/moodboard/seed` on mount. Two things
   * were wrong with that, and the toast added later only softened one of them:
   *
   *  1. Work you did not do, presented as work already there, is
   *     indistinguishable from work someone else did — and the moment they
   *     save, it becomes theirs.
   *  2. It decided FOR them. A partner looking at our board to see what we
   *     wanted, with no intention of authoring anything yet, came away owning a
   *     board built out of a brief they had not read.
   *
   * So the seed now runs from a button. The partner chooses whether to start at
   * all, and from what.
   */
  const startBoard = useCallback(
    async (from: "brief" | "blank") => {
      if (!id) {
        return
      }
      setIsStarting(true)
      try {
        /**
         * The save route is get-or-create per owner, so an empty scene IS the
         * creation. Sent explicitly rather than waiting for their first stroke,
         * so the board exists — and reads as theirs in the switcher — from the
         * moment they ask for it.
         */
        const blank: MoodboardData = {
          type: "excalidraw",
          version: 2,
          source: "https://excalidraw.com",
          elements: [],
          appState: {},
          files: {},
        }
        await saveMoodboard(blank as any)

        if (from === "blank") {
          loadScene(blank)
          setIsDirty(false)
          toast.success(t("partner.designs.moodboard.startedBlank"))
          return
        }

        /**
         * "From the brief" is deliberately CREATE-THEN-GENERATE, not the seed
         * route.
         *
         * Generate is the path that is proven end to end — it persists to the
         * partner's own board and an integration test reads that board back.
         * `POST /moodboard/seed` returns `{ moodboard: null }` for a partner who
         * demonstrably has no board, while calling `seedDesignMoodboardIfEmpty`
         * directly with the same design and a fresh partner id builds a
         * 52-element scene; I could not account for the difference, and a
         * button that silently does nothing is the exact defect this whole
         * change set has been removing. Unexplained is not the same as safe, so
         * this uses the route whose behaviour is established.
         *
         * Generate also fails LOUDLY when there is nothing to build from — a
         * 400 naming what the design is missing — which the catch below
         * surfaces. The seed route answers that case with a silent null.
         */
        const { moodboard: scene } = await generateMoodboard()
        loadScene(
          normalizeMoodboardScene<ExcalidrawElement, BinaryFileData>(scene) ||
            (scene as MoodboardData)
        )
        setIsDirty(false)
        toast.success(t("partner.designs.moodboard.startedFromBrief"))
      } catch (err: any) {
        toast.error(err?.message || t("partner.designs.moodboard.startFailed"))
      } finally {
        setIsStarting(false)
      }
    },
    [id, saveMoodboard, generateMoodboard, loadScene, t]
  )

  const handleGenerate = useCallback(async () => {
    if (!id) {
      return
    }
    const proceed = window.confirm(
      t("partner.designs.moodboard.generateConfirm")
    )
    if (!proceed) {
      return
    }
    toast.loading(t("partner.designs.moodboard.generating"))
    try {
      const { moodboard: scene } = await generateMoodboard()
      loadScene(normalizeMoodboardScene<ExcalidrawElement, BinaryFileData>(scene) ||
            (scene as MoodboardData))
      setIsDirty(false)
      toast.dismiss()
      toast.success(t("partner.designs.moodboard.generated"))
    } catch (err: any) {
      toast.dismiss()
      toast.error(err?.message || t("partner.designs.moodboard.generateFailed"))
    }
  }, [id, generateMoodboard, loadScene, t])

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
          toast.info(t("partner.designs.moodboard.nothingToInsert", { label }))
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
          toast.success(t("partner.designs.moodboard.inserted", { label }))
        }
      } catch (err: any) {
        toast.error(err?.message || t("partner.designs.moodboard.insertFailed"))
      }
    },
    [id, insertBlock, t]
  )

  // After a construction detail is added, re-render the construction frame from
  // the design's fresh data (replacing the existing one in place).
  const handleConstructionAdded = useCallback(() => {
    handleInsert("construction", t("partner.designs.construction.details"), CONSTRUCTION_FRAME_NAME)
  }, [handleInsert, t])

  const handleSave = useCallback(async () => {
    const api = apiRef.current
    if (!api || !id) {
      return
    }
    toast.loading(t("partner.designs.moodboard.saving"))
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
            toast.warning(t("partner.designs.moodboard.briefSyncFailed"))
          }
        }
      }

      setIsDirty(false)
      toast.dismiss()
      toast.success(t("partner.designs.moodboard.saved"))
    } catch (err: any) {
      toast.dismiss()
      toast.error(err?.message || t("partner.designs.moodboard.saveFailed"))
    }
  }, [id, saveMoodboard, updateBrief, design, t])

  const isSaving = isSavingScene

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header>
        <RouteFocusModal.Title asChild>
          <Heading>{t("partner.designs.moodboard.heading")}</Heading>
        </RouteFocusModal.Title>
        <RouteFocusModal.Description className="sr-only">
          {t("partner.designs.moodboard.heading")}
        </RouteFocusModal.Description>
        <div className="ml-4">
          <BoardSwitcher
            own={ownBoard}
            others={otherBoards ?? []}
            selectedId={activeBoard?.id}
            onSelect={(b) => setSelectedBoardId(b.id)}
            usedLegacyFallback={usedLegacyFallback}
          />
        </div>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body>
        {!id ? (
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle">
              {t("partner.designs.missingId")}
            </Text>
          </div>
        ) : isPending || boardsPending ? (
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle">
              {t("labels.loading")}
            </Text>
          </div>
        ) : (
          <div className="flex h-[calc(100dvh-160px)] w-full flex-col">
            {/*
              #2019 — the partner has no board of their own on this design.
              Shown ABOVE the canvas rather than instead of it: the board they
              are looking at is ours, read-only, and being able to read it is
              exactly how they decide what to put on theirs.
            */}
            {!ownBoard ? (
              <div className="border-ui-border-base bg-ui-bg-subtle flex flex-col gap-y-3 border-b px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-col">
                  <Text size="small" weight="plus">
                    {t("partner.designs.moodboard.noOwnBoard")}
                  </Text>
                  <Text size="small" className="text-ui-fg-subtle">
                    {otherBoards?.length
                      ? t("partner.designs.moodboard.noOwnBoardHintOurs")
                      : t("partner.designs.moodboard.noOwnBoardHintEmpty")}
                  </Text>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => startBoard("brief")}
                    disabled={isStarting}
                    isLoading={isStarting}
                  >
                    {t("partner.designs.moodboard.startFromBrief")}
                  </Button>
                  <Button
                    size="small"
                    variant="primary"
                    onClick={() => startBoard("blank")}
                    disabled={isStarting}
                  >
                    {t("partner.designs.moodboard.startBlank")}
                  </Button>
                </div>
              </div>
            ) : null}

          <div className="jyt-moodboard relative w-full flex-1">
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
              theme={theme}
              excalidrawAPI={(api) => {
                apiRef.current = api
              }}
              initialData={(() => {
                const base = (moodboard as any) || {
                  type: "excalidraw",
                  version: 2,
                  source: "https://excalidraw.com",
                  elements: [],
                  appState: {},
                  files: {},
                }
                // Force the live admin theme at mount so a stale saved
                // appState.theme can't leave the canvas on the wrong theme.
                return {
                  ...base,
                  appState: { ...(base.appState || {}), theme },
                }
              })()}
              viewModeEnabled={isReadOnly}
              onChange={handleChange}
              UIOptions={{
                canvasActions: {
                  changeViewBackgroundColor: true,
                  saveToActiveFile: false,
                  saveAsImage: true,
                  export: { saveFileToDisk: true },
                  loadScene: false,
                  clearCanvas: false,
                  // Theme is controlled to follow the admin — no manual toggle.
                  toggleTheme: false,
                },
              }}
              detectScroll={true}
            />

            {/* Floating action dock — pinned bottom-center over the canvas. */}
            <div className="absolute bottom-4 left-1/2 z-[60] -translate-x-1/2 flex items-center gap-1 flex-nowrap rounded-full border border-ui-border-base bg-ui-bg-base shadow-elevation-flyout px-1.5 py-1">
              <DropdownMenu>
                <DropdownMenu.Trigger asChild>
                  <Button
                    size="small"
                    variant="secondary"
                    disabled={!id || isReadOnly || isSaving || isInserting}
                    isLoading={isInserting}
                  >
                    {t("partner.designs.moodboard.insertBlock")}
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content side="top" sideOffset={8}>
                  {groupedBlocks.length === 0 ? (
                    <DropdownMenu.Item disabled>
                      {t("partner.designs.moodboard.noBlocks")}
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
                              <span className="text-ui-fg-muted ml-1">
                                {t("partner.designs.moodboard.emptySuffix")}
                              </span>
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
                disabled={!id || isReadOnly || isSaving}
              >
                {t("partner.designs.moodboard.addConstruction")}
              </Button>
              <Button
                size="small"
                variant="secondary"
                onClick={handleGenerate}
                disabled={!id || isReadOnly || isGenerating || isSaving}
                isLoading={isGenerating}
              >
                {t("partner.designs.moodboard.generate")}
              </Button>
              <Button
                size="small"
                variant={layersOpen ? "primary" : "secondary"}
                onClick={() => setLayersOpen((v) => !v)}
                disabled={!id}
              >
                {t("partner.designs.moodboard.layers")}
              </Button>
              <Button
                size="small"
                variant="primary"
                onClick={handleSave}
                disabled={!id || isReadOnly || isSaving || !isDirty}
                isLoading={isSaving}
              >
                {isDirty
                  ? t("partner.designs.moodboard.save")
                  : t("partner.designs.moodboard.savedLabel")}
              </Button>
            </div>
          </div>
          </div>
        )}
      </RouteFocusModal.Body>

      <RouteFocusModal.Footer>
        <div className="flex items-center justify-between w-full gap-x-2">
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("partner.designs.moodboard.footerHint")}
          </Text>
          <RouteFocusModal.Close asChild>
            <Button size="small" variant="secondary">
              {t("actions.close")}
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
