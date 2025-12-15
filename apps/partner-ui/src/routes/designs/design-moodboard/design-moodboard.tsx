import { Button, Heading, Text } from "@medusajs/ui"
import "@excalidraw/excalidraw/index.css"
import { useEffect, useMemo, useRef } from "react"
import { useParams } from "react-router-dom"

import { Excalidraw } from "@excalidraw/excalidraw"
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import type { BinaryFileData, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types"

import { RouteFocusModal } from "../../../components/modals"
import { usePartnerDesign } from "../../../hooks/api/partner-designs"

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

export const DesignMoodboard = () => {
  const { id } = useParams()

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)

  const { design, isPending, isError, error } = usePartnerDesign(id || "")

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
        ) : !moodboard ? (
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle">
              No moodboard yet.
            </Text>
          </div>
        ) : (
          <div className="relative w-full h-[calc(100dvh-160px)]">
            <Excalidraw
              excalidrawAPI={(api) => {
                apiRef.current = api
              }}
              initialData={moodboard as any}
              viewModeEnabled={true}
              UIOptions={{
                canvasActions: {
                  changeViewBackgroundColor: false,
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
        </div>
      </RouteFocusModal.Footer>
    </RouteFocusModal>
  )
}
