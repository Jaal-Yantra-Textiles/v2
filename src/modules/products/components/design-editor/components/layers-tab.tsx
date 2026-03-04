"use client"

import React from "react"
import clsx from "clsx"
import { DesignState } from "../types"

type LayersTabProps = {
  design: DesignState
  setDesign: React.Dispatch<React.SetStateAction<DesignState>>
  onAddText: () => void
  onAddImage: () => void
  onAddRect: () => void
  onAddCircle: () => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  moveLayerUp: () => void
  moveLayerDown: () => void
  toggleLayerVisibility: (id: string) => void
  deleteSelectedLayer: () => void
  duplicateSelectedLayer: () => void
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  image: (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="1" width="14" height="14" rx="2" />
      <circle cx="5" cy="5" r="1.2" />
      <polyline points="1 11 5 7 9 11 12 8 15 11" />
    </svg>
  ),
  text: (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
      <path d="M2 3h5v2H5v6h2v2H4V5H2V3zm7 0h5v2h-2v8h-1V5h-2V3z" />
    </svg>
  ),
  rect: (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="2" y="4" width="12" height="8" rx="1.5" />
    </svg>
  ),
  circle: (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6" />
    </svg>
  ),
}

function LayerThumbnail({ type, src, fill }: { type: string; src?: string; fill?: string }) {
  if (type === "image" && src) {
    return (
      <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
        <img src={src} alt="" className="h-full w-full object-cover" />
      </div>
    )
  }
  return (
    <div
      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-500"
      style={type === "rect" || type === "circle" ? { backgroundColor: fill ?? "#e2e8f0" } : { backgroundColor: "#f8fafc" }}
    >
      {TYPE_ICONS[type] ?? TYPE_ICONS.image}
    </div>
  )
}

function IconBtn({ title, onClick, disabled, children }: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  )
}

export function LayersTab({
  design,
  setDesign,
  onAddText,
  onAddImage,
  onAddRect,
  onAddCircle,
  fileInputRef,
  moveLayerUp,
  moveLayerDown,
  toggleLayerVisibility,
  deleteSelectedLayer,
  duplicateSelectedLayer,
}: LayersTabProps) {
  const layers = [...design.layers].reverse() // show topmost first
  const selectedId = design.selectedId

  return (
    <div className="flex h-full flex-col">
      {/* Layer list */}
      <div className="flex-1 overflow-y-auto p-3" data-lenis-prevent>
        {layers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="mb-3 rounded-2xl border border-dashed border-slate-200 p-5">
              <p className="text-sm font-medium text-slate-400">No layers yet</p>
              <p className="mt-1 text-xs text-slate-400">Add an element below to get started</p>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {layers.map((layer, idx) => {
              const realIdx = design.layers.indexOf(layer)
              const isSelected = selectedId === layer.id
              const isHidden = layer.opacity === 0

              const labelText =
                layer.type === "text"
                  ? (layer.text?.slice(0, 20) || "Text")
                  : layer.type === "image"
                  ? "Image"
                  : layer.type === "rect"
                  ? "Rectangle"
                  : "Circle"

              return (
                <div
                  key={layer.id}
                  onClick={() => setDesign((prev) => ({ ...prev, selectedId: layer.id }))}
                  className={clsx(
                    "group flex cursor-pointer items-center gap-2 rounded-xl border p-2 transition-all",
                    isSelected
                      ? "border-slate-300 bg-slate-100 shadow-sm"
                      : "border-transparent hover:border-slate-200 hover:bg-slate-50"
                  )}
                >
                  <LayerThumbnail type={layer.type} src={layer.src} fill={layer.fill} />

                  <div className="min-w-0 flex-1">
                    <p className={clsx("truncate text-xs font-medium", isHidden ? "text-slate-400 line-through" : "text-slate-800")}>
                      {labelText}
                    </p>
                    <p className="text-[10px] text-slate-400 capitalize">{layer.type}</p>
                  </div>

                  {/* Actions (shown on hover or when selected) */}
                  <div className={clsx("flex items-center gap-0.5 transition-opacity", isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
                    {/* Visibility */}
                    <IconBtn title={isHidden ? "Show" : "Hide"} onClick={(e) => { (e as any).stopPropagation?.(); toggleLayerVisibility(layer.id) }}>
                      {isHidden ? (
                        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <path d="M1 1l14 14M6.9 6.9A3 3 0 0 0 9.1 9.1M4 4C2.5 5.3 1.5 6.6 1.1 8c1 3.3 4 5.5 7 5.5a7 7 0 0 0 3.1-.7" />
                          <path d="M12 12c1.5-1.3 2.5-2.6 2.9-4C14 4.7 11 2.5 8 2.5A7 7 0 0 0 5 3.3" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <path d="M1.1 8C2 4.7 5 2.5 8 2.5S14 4.7 14.9 8C14 11.3 11 13.5 8 13.5S2 11.3 1.1 8z" />
                          <circle cx="8" cy="8" r="2.5" />
                        </svg>
                      )}
                    </IconBtn>

                    {/* Duplicate */}
                    {isSelected && (
                      <IconBtn title="Duplicate" onClick={(e) => { (e as any).stopPropagation?.(); duplicateSelectedLayer() }}>
                        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="5" y="5" width="9" height="9" rx="1.5" />
                          <path d="M3 11V3a2 2 0 0 1 2-2h8" />
                        </svg>
                      </IconBtn>
                    )}

                    {/* Move up / down */}
                    {isSelected && (
                      <>
                        <IconBtn title="Move up" disabled={realIdx === design.layers.length - 1} onClick={(e) => { (e as any).stopPropagation?.(); moveLayerUp() }}>
                          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M8 12V4M4 8l4-4 4 4" />
                          </svg>
                        </IconBtn>
                        <IconBtn title="Move down" disabled={realIdx === 0} onClick={(e) => { (e as any).stopPropagation?.(); moveLayerDown() }}>
                          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M8 4v8M4 8l4 4 4-4" />
                          </svg>
                        </IconBtn>
                      </>
                    )}

                    {/* Delete */}
                    {isSelected && (
                      <IconBtn title="Delete" onClick={(e) => { (e as any).stopPropagation?.(); deleteSelectedLayer() }}>
                        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 4h12M6 4V2h4v2M5 4l1 9h4l1-9" />
                        </svg>
                      </IconBtn>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add element buttons */}
      <div className="border-t border-slate-100 p-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Add element</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="1" width="14" height="14" rx="2" />
              <circle cx="5" cy="5" r="1.2" />
              <polyline points="1 11 5 7 9 11 12 8 15 11" />
            </svg>
            Image
          </button>
          <button
            onClick={onAddText}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 text-xs font-medium text-purple-700 hover:bg-purple-100"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
              <path d="M2 3h5v2H5v6h2v2H4V5H2V3zm7 0h5v2h-2v8h-1V5h-2V3z" />
            </svg>
            Text
          </button>
          <button
            onClick={onAddRect}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <rect x="2" y="4" width="12" height="8" rx="1.5" />
            </svg>
            Rectangle
          </button>
          <button
            onClick={onAddCircle}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 hover:bg-amber-100"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="8" cy="8" r="6" />
            </svg>
            Circle
          </button>
        </div>
      </div>
    </div>
  )
}
