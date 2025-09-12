"use client"

import { Container, Heading, Text } from "@medusajs/ui"
import "@excalidraw/excalidraw/index.css"
import { Button } from "@medusajs/ui"
import { useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { MoodboardModal } from "../../../../components/moodboard/moodboard-modal"
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

export default function MoodboardSection({ moodboard }: { moodboard?: MoodboardData | null }) {
  const [open, setOpen] = useState(false)
  const parsed = moodboard
  const hasData = !!parsed
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)

  // Fit content to the small panel once mounted
  useEffect(() => {
    if (!hasData || !apiRef.current) return
    const api = apiRef.current
    const elements = (parsed?.elements ?? []) as ExcalidrawElement[]
    const t = setTimeout(() => {
      try {
        if (elements.length) {
          api.scrollToContent(elements, { fitToContent: true })
        } else {
          const current = api.getSceneElements()
          api.scrollToContent(current, { fitToContent: true })
        }
      } catch {}
    }, 50)
    return () => clearTimeout(t)
  }, [hasData, parsed])

  return (
    <Container className="p-0 divide-y">
      <div className="px-4 md:px-6 py-4 flex items-center justify-between">
        <Heading level="h3">Moodboard</Heading>
        {hasData && (
          <Button size="small" variant="secondary" onClick={() => setOpen(true)}>
            View fullscreen
          </Button>
        )}
      </div>
      <div className="px-4 md:px-6 py-4 space-y-4">
        {!hasData && (
          <Text size="small" className="text-ui-fg-subtle">No moodboard yet</Text>
        )}
        {hasData && (
          <div className="space-y-3">
            <div className="rounded-md border bg-ui-bg-base">
              <div className="relative h-[360px] sm:h-[420px] md:h-[520px] lg:h-[600px]">
                <Excalidraw
                  excalidrawAPI={(api) => {
                    apiRef.current = api
                  }}
                  initialData={{
                    type: "excalidraw",
                    version: 2,
                    source: "https://excalidraw.com",
                    elements: (parsed?.elements ?? []) as ExcalidrawElement[],
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
            </div>
          </div>
        )}
      </div>
      {/* Fullscreen modal */}
      <MoodboardModal open={open} onOpenChange={setOpen} moodboard={parsed} title="Moodboard" />
    </Container>
  )
}
