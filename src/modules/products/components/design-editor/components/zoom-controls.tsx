"use client"

import { Text } from "@medusajs/ui"
import { ArrowUturnLeft, ArrowsPointingOutMini, MinusMini, PlusMini } from "@medusajs/icons"
import clsx from "clsx"
import { ViewState } from "../types"

type ZoomControlsProps = {
  view: ViewState
  zoomIn: () => void
  zoomOut: () => void
  resetView: () => void
  undo: () => void
  redo: () => void
  historyIndex: number
  canRedo: boolean
  variant?: "inline" | "floating"
  className?: string
}

const iconButtonClasses =
  "rounded-full p-1.5 transition-colors hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:opacity-40"

export function ZoomControls({
  view,
  zoomIn,
  zoomOut,
  resetView,
  undo,
  redo,
  historyIndex,
  canRedo,
  variant = "inline",
  className,
}: ZoomControlsProps) {
  if (variant === "floating") {
    return (
      <div
        className={clsx(
          "flex items-center gap-3 rounded-full border border-slate-200 bg-white/95 px-4 py-2 shadow-[0_20px_45px_rgba(15,23,42,0.15)] backdrop-blur",
          className
        )}
      >
        <div className="flex items-center gap-1">
          <button
            onClick={undo}
            disabled={historyIndex <= 0}
            className={iconButtonClasses}
            title="Undo (⌘Z)"
          >
            <ArrowUturnLeft className="h-4 w-4" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className={iconButtonClasses}
            title="Redo (⌘⇧Z)"
          >
            <ArrowUturnLeft className="h-4 w-4 -scale-x-100" />
          </button>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1">
          <button onClick={zoomOut} className={iconButtonClasses} title="Zoom Out">
            <MinusMini className="h-4 w-4" />
          </button>
          <span className="min-w-[50px] text-center text-sm font-medium text-slate-700">
            {Math.round(view.scale * 100)}%
          </span>
          <button onClick={zoomIn} className={iconButtonClasses} title="Zoom In">
            <PlusMini className="h-4 w-4" />
          </button>
        </div>
        <button onClick={resetView} className={iconButtonClasses} title="Reset View (⌘0)">
          <ArrowsPointingOutMini className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div
      className={clsx(
        "flex items-center justify-between border-t border-slate-100 bg-white px-4 py-2",
        className
      )}
    >
      <div className="flex items-center gap-1">
        <button
          onClick={undo}
          disabled={historyIndex <= 0}
          className={iconButtonClasses}
          title="Undo (⌘Z)"
        >
          <ArrowUturnLeft className="h-4 w-4" />
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          className={iconButtonClasses}
          title="Redo (⌘⇧Z)"
        >
          <ArrowUturnLeft className="h-4 w-4 -scale-x-100" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={zoomOut} className={iconButtonClasses} title="Zoom Out">
          <MinusMini className="h-4 w-4" />
        </button>
        <span className="min-w-[60px] text-center text-sm text-gray-600">
          {Math.round(view.scale * 100)}%
        </span>
        <button onClick={zoomIn} className={iconButtonClasses} title="Zoom In">
          <PlusMini className="h-4 w-4" />
        </button>
        <button
          onClick={resetView}
          className={`${iconButtonClasses} ml-2`}
          title="Reset View (⌘0)"
        >
          <ArrowsPointingOutMini className="h-4 w-4" />
        </button>
      </div>

      <Text size="small" className="text-gray-400">
        Scroll to zoom
      </Text>
    </div>
  )
}
