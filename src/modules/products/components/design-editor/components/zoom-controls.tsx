"use client"

import { Text } from "@medusajs/ui"
import {
    ArrowUturnLeft,
    MinusMini,
    PlusMini,
} from "@medusajs/icons"
import { ViewState } from "../types"

type ZoomControlsProps = {
    view: ViewState
    zoomIn: () => void
    zoomOut: () => void
    resetView: () => void
    undo: () => void
    historyIndex: number
}

export function ZoomControls({
    view,
    zoomIn,
    zoomOut,
    resetView,
    undo,
    historyIndex,
}: ZoomControlsProps) {
    return (
        <div className="flex items-center justify-between border-t bg-white px-4 py-2">
            <div className="flex items-center gap-2">
                <button
                    onClick={undo}
                    disabled={historyIndex <= 0}
                    className="rounded p-1.5 transition-colors hover:bg-gray-100 disabled:opacity-40"
                    title="Undo (Ctrl+Z)"
                >
                    <ArrowUturnLeft className="h-4 w-4" />
                </button>
            </div>

            <div className="flex items-center gap-2">
                <button
                    onClick={zoomOut}
                    className="rounded p-1.5 transition-colors hover:bg-gray-100"
                    title="Zoom Out"
                >
                    <MinusMini className="h-4 w-4" />
                </button>
                <span className="min-w-[60px] text-center text-sm text-gray-600">
                    {Math.round(view.scale * 100)}%
                </span>
                <button
                    onClick={zoomIn}
                    className="rounded p-1.5 transition-colors hover:bg-gray-100"
                    title="Zoom In"
                >
                    <PlusMini className="h-4 w-4" />
                </button>
                <button
                    onClick={resetView}
                    className="rounded p-1.5 transition-colors hover:bg-gray-100 ml-2"
                    title="Reset View"
                >
                    <ArrowUturnLeft className="h-4 w-4" />
                </button>
            </div>

            <Text size="small" className="text-gray-400">
                Scroll to zoom
            </Text>
        </div>
    )
}
