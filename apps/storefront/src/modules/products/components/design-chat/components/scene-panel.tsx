"use client"

import React from "react"
import clsx from "clsx"
import { Button, Text } from "@medusajs/ui"
import { CheckCircleSolid } from "@medusajs/icons"

/**
 * Scene panel — the chat design editor's board view.
 *
 * Loads the Excalidraw elements from design.moodboard (the canvas workspace —
 * inspirations + generated canvas takes on ONE board, see backend
 * canvas-scene.ts) and renders them READ-ONLY. No @excalidraw editor dep: the
 * elements the tools write are simple (rectangle / text / image), so a
 * lightweight absolutely-positioned renderer is all the shop needs. Partner-ui
 * renders the same scene with the full editor; the shop only needs to show it.
 *
 * Canvas elements (customData.canvas) render with A/B labels and a pick
 * action; the active pick renders with a check. Inspiration elements render
 * smaller, without actions.
 */

export type SceneElement = {
  id: string
  type: string
  x: number
  y: number
  width: number | null
  height: number | null
  angle: number
  opacity: number
  isDeleted: boolean
  link?: string | null
  fileId?: string
  mimeType?: string
  text?: string
  fontSize?: number
  fillStyle?: string
  backgroundColor?: string
  strokeColor?: string
  customData?: {
    source?: string
    label?: string
    canvas?: {
      id: string
      letter: "A" | "B" | null
      kind: "initial" | "revision" | "layer"
      parent_canvas_id: string | null
      media_id: string | null
      prompt_used: string
      active: boolean
      generated_at: string
    }
    [key: string]: any
  } | null
}

export type CanvasScene = {
  elements: SceneElement[]
  files: Record<string, { id: string; dataURL: string; mimeType: string }>
  appState?: Record<string, any>
}

/** Parse any stored moodboard value into a well-formed scene (mirror of the
 * backend normalizeCanvasScene — tolerant of legacy shapes). */
export const normalizeScene = (raw: unknown): CanvasScene | null => {
  if (!raw) return null
  let parsed: any = raw
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!parsed || typeof parsed !== "object") return null
  const elements: SceneElement[] = Array.isArray(parsed.elements)
    ? parsed.elements.filter((el: any) => !el?.isDeleted)
    : []
  const files: CanvasScene["files"] =
    parsed.files && typeof parsed.files === "object" ? parsed.files : {}
  return { elements, files }
}

const resolveImageUrl = (
  el: SceneElement,
  files: CanvasScene["files"]
): string | null => {
  const fromFile = el.fileId ? files[el.fileId]?.dataURL : null
  const url = fromFile || (typeof el.link === "string" ? el.link : null)
  return url && (url.startsWith("http") || url.startsWith("data:")) ? url : null
}

type ScenePanelProps = {
  scene: CanvasScene | null
  /** The design's thumbnail (backend-stamped active pick) — preferred active
   * signal when the scene marker hasn't caught up. */
  thumbnailUrl?: string | null
  /** Pick an A/B canvas take. */
  onPickCanvas?: (canvasId: string) => void
  picking?: boolean
  className?: string
}

export function ScenePanel({
  scene,
  thumbnailUrl,
  onPickCanvas,
  picking = false,
  className,
}: ScenePanelProps) {
  const canvases = React.useMemo(
    () =>
      (scene?.elements ?? []).filter(
        (el) => el.type === "image" && el.customData?.canvas
      ),
    [scene]
  )
  const inspirations = React.useMemo(
    () =>
      (scene?.elements ?? []).filter(
        (el) =>
          el.type === "image" &&
          el.customData?.source === "inspiration" &&
          !el.customData?.canvas
      ),
    [scene]
  )
  const texts = React.useMemo(
    () => (scene?.elements ?? []).filter((el) => el.type === "text" && el.text),
    [scene]
  )

  if (!scene || scene.elements.length === 0) {
    return (
      <div
        className={clsx(
          "flex flex-col items-center justify-center rounded-2xl border border-dashed border-ui-border-base bg-ui-bg-subtle px-6 py-10 text-center",
          className
        )}
      >
        <span className="mb-2 text-2xl">🧵</span>
        <Text size="small" className="text-ui-fg-subtle">
          Your board is empty — generated takes and inspirations land here.
        </Text>
      </div>
    )
  }

  const isActive = (el: SceneElement): boolean => {
    if (el.customData?.canvas?.active) return true
    const url = resolveImageUrl(el, scene?.files ?? {})
    return Boolean(thumbnailUrl && url && url === thumbnailUrl)
  }

  return (
    <div className={clsx("flex flex-col gap-4", className)}>
      {/* Canvas takes — A/B cards with pick actions */}
      {canvases.length > 0 && (
        <section>
          <Text
            weight="plus"
            size="xsmall"
            className="mb-2 uppercase tracking-widest text-ui-fg-muted"
          >
            Takes on the board
          </Text>
          <div className="grid grid-cols-2 gap-2">
            {canvases.map((el) => {
              const marker = el.customData!.canvas!
              const url = resolveImageUrl(el, scene?.files ?? {})
              const active = isActive(el)
              return (
                <button
                  key={el.id}
                  type="button"
                  onClick={() => !active && onPickCanvas?.(marker.id)}
                  disabled={active || picking || !onPickCanvas}
                  title={
                    marker.prompt_used
                      ? `${marker.kind} take · ${marker.prompt_used}`
                      : `${marker.kind} take`
                  }
                  className={clsx(
                    "group relative aspect-[3/4] overflow-hidden rounded-xl border-2 bg-ui-bg-base transition-all",
                    active
                      ? "border-ui-fg-base ring-1 ring-ui-border-base"
                      : "border-transparent hover:border-ui-border-strong"
                  )}
                >
                  {url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={url}
                      alt={marker.prompt_used || "Design take"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full bg-ui-bg-base-pressed" />
                  )}
                  {/* A/B label */}
                  {marker.letter && !active && (
                    <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                      {marker.letter}
                    </span>
                  )}
                  {/* kind chip */}
                  {marker.kind !== "initial" && (
                    <span className="absolute right-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium capitalize text-white">
                      {marker.kind}
                    </span>
                  )}
                  {/* active / pick overlay */}
                  <div
                    className={clsx(
                      "absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 py-1.5 text-[11px] font-semibold text-white transition-opacity",
                      active
                        ? "bg-ui-fg-base opacity-100"
                        : "bg-black/60 opacity-0 group-hover:opacity-100"
                    )}
                  >
                    {active ? (
                      <>
                        <CheckCircleSolid className="h-3 w-3" />
                        Active take
                      </>
                    ) : picking ? (
                      "Picking…"
                    ) : (
                      "Build on this"
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* Inspirations */}
      {inspirations.length > 0 && (
        <section>
          <Text
            weight="plus"
            size="xsmall"
            className="mb-2 uppercase tracking-widest text-ui-fg-muted"
          >
            Inspirations
          </Text>
          <div className="flex flex-wrap gap-2">
            {inspirations.map((el) => {
              const url = resolveImageUrl(el, scene?.files ?? {})
              return (
                <div
                  key={el.id}
                  className="h-16 w-16 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base"
                >
                  {url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={url}
                      alt="Inspiration"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full bg-ui-bg-base-pressed" />
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Board notes (brief cards etc.) — rendered as quiet text */}
      {texts.length > 0 && (
        <section className="rounded-xl border border-ui-border-base bg-ui-bg-subtle p-3">
          {texts.map((el) => (
            <p
              key={el.id}
              className="whitespace-pre-wrap text-xs text-ui-fg-subtle"
            >
              {el.text}
            </p>
          ))}
        </section>
      )}
    </div>
  )
}

/** Skeleton state shown while generation is running (~20s per image). */
export function ScenePanelGeneratingSkeleton({ className }: { className?: string }) {
  return (
    <section className={clsx("flex flex-col gap-2", className)}>
      <Text
        weight="plus"
        size="xsmall"
        className="uppercase tracking-widest text-ui-fg-muted"
      >
        Generating two takes…
      </Text>
      <div className="grid grid-cols-2 gap-2">
        {["A", "B"].map((letter) => (
          <div
            key={letter}
            className="relative aspect-[3/4] animate-pulse overflow-hidden rounded-xl border border-ui-border-base bg-ui-bg-base-pressed"
          >
            <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
              {letter}
            </span>
            <div className="absolute inset-x-0 bottom-0 py-1.5 text-center text-[11px] text-ui-fg-subtle">
              ~20 seconds per image
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
