"use client"

import clsx from "clsx"

type ToolStripProps = {
  activeTool: "select" | "pan"
  setActiveTool: (t: "select" | "pan") => void
  onAddText: () => void
  onAddImage: () => void
  onAddRect: () => void
  onAddCircle: () => void
  showPrintZone: boolean
  onTogglePrintZone: () => void
}

const divider = <div className="mx-auto h-px w-6 bg-slate-200" />

function ToolBtn({
  title,
  active,
  onClick,
  children,
}: {
  title: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={clsx(
        "flex h-9 w-9 items-center justify-center rounded-xl transition-all",
        active
          ? "bg-slate-900 text-white shadow-sm"
          : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
      )}
    >
      {children}
    </button>
  )
}

export function ToolStrip({
  activeTool,
  setActiveTool,
  onAddText,
  onAddImage,
  onAddRect,
  onAddCircle,
  showPrintZone,
  onTogglePrintZone,
}: ToolStripProps) {
  return (
    <div className="flex w-12 flex-shrink-0 flex-col items-center gap-1.5 border-r border-slate-200 bg-white py-3">
      {/* Select */}
      <ToolBtn title="Select (V)" active={activeTool === "select"} onClick={() => setActiveTool("select")}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <path d="M4 0l16 12.3-6.8.9L9.4 22 4 0z" />
        </svg>
      </ToolBtn>

      {/* Pan */}
      <ToolBtn title="Pan (H / Space)" active={activeTool === "pan"} onClick={() => setActiveTool("pan")}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <path d="M9 3a1 1 0 0 1 1-1 1 1 0 0 1 1 1v5h2V5a1 1 0 0 1 1-1 1 1 0 0 1 1 1v3h1a2 2 0 0 1 2 2v3a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-2a1 1 0 0 1 1-1 1 1 0 0 1 1 1v2a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3v-3h-1v2a1 1 0 0 1-2 0V9h-2v4a1 1 0 0 1-2 0V3z" />
        </svg>
      </ToolBtn>

      {divider}

      {/* Add Text */}
      <ToolBtn title="Add Text (T)" onClick={onAddText}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <path d="M2 4v3h5v12h3V7h5V4H2zm17 8h-3v3h-3v3h3v3h3v-3h3v-3h-3v-3z" />
        </svg>
      </ToolBtn>

      {/* Add Image */}
      <ToolBtn title="Upload Image" onClick={onAddImage}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      </ToolBtn>

      {/* Add Rect */}
      <ToolBtn title="Add Rectangle" onClick={onAddRect}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="6" width="18" height="12" rx="2" />
        </svg>
      </ToolBtn>

      {/* Add Circle */}
      <ToolBtn title="Add Circle" onClick={onAddCircle}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
        </svg>
      </ToolBtn>

      {divider}

      {/* Print zone toggle */}
      <ToolBtn title="Toggle print zone" active={showPrintZone} onClick={onTogglePrintZone}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray={showPrintZone ? undefined : "4 3"}>
          <rect x="3" y="3" width="18" height="18" rx="1" />
        </svg>
      </ToolBtn>
    </div>
  )
}
