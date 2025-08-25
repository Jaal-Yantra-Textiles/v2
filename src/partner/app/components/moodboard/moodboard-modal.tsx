"use client"

import { FocusModal, Heading } from "@medusajs/ui"
import "@excalidraw/excalidraw/index.css"
import { useEffect, useRef } from "react"
import dynamic from "next/dynamic"
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import type { BinaryFileData, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types"

// Dynamically import Excalidraw to avoid SSR window reference
const Excalidraw = dynamic(() => import("@excalidraw/excalidraw").then((m) => m.Excalidraw), {
  ssr: false,
})

export interface MoodboardFileMap {
  [key: string]: BinaryFileData
}
export interface MoodboardData {
  elements?: ExcalidrawElement[]
  files?: MoodboardFileMap
  appState?: Record<string, unknown>
  [key: string]: unknown
}

export function MoodboardModal({
  open,
  onOpenChange,
  title = "Moodboard",
  moodboard,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  moodboard?: MoodboardData | null
}) {
  const parsed: MoodboardData = moodboard || ({} as MoodboardData)
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)

  // When modal opens, center/contain the scene
  useEffect(() => {
    if (!open || !apiRef.current) return
    const api = apiRef.current
    const elements = (parsed?.elements as ExcalidrawElement[] | undefined) || []
    const t = setTimeout(() => {
      try {
        const list = elements.length ? elements : api.getSceneElements()
        api.scrollToContent(list, { fitToContent: true })
      } catch {}
    }, 50)
    return () => clearTimeout(t)
  }, [open, parsed])

  return (
    <FocusModal open={open} onOpenChange={onOpenChange}>
      {/* Fullscreen content above everything */}
      <FocusModal.Title>{title}</FocusModal.Title>
      <FocusModal.Content className="fixed inset-0 !max-w-none w-screen h-[100dvh] m-0 p-0 z-[9999]">
        <FocusModal.Header className="px-4 py-3 border-b">
          <Heading>{title}</Heading>
        </FocusModal.Header>
        <FocusModal.Body className="size-full p-0">
          <div className="relative w-full h-[calc(100dvh-56px)]">
            <Excalidraw
              excalidrawAPI={(api: ExcalidrawImperativeAPI) => {
                apiRef.current = api
              }}
              initialData={{
                type: "excalidraw",
                version: 2,
                source: "https://excalidraw.com",
                elements: parsed?.elements ?? [],
                appState: {
                  ...(parsed?.appState as Record<string, unknown> | undefined),
                  collaborators: new Map(),
                },
                files: (parsed?.files as Record<string, BinaryFileData> | undefined) ?? {},
              }}
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
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}
