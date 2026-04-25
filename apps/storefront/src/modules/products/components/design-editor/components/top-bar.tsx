"use client"

import React, { useState, useRef, useEffect } from "react"
import { ArrowUturnLeft, Sparkles } from "@medusajs/icons"
import clsx from "clsx"

type TopBarProps = {
  designName: string
  onDesignNameChange: (name: string) => void
  productTitle: string
  isSaving: boolean
  onSave: () => void
  undo: () => void
  redo: () => void
  historyIndex: number
  canRedo: boolean
  onGenerateAi?: () => void
  isGeneratingAi?: boolean
  quotaRemaining?: number | null
  onTryOn?: () => void
}

const iconBtn =
  "flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-900 disabled:pointer-events-none disabled:opacity-30"

export function TopBar({
  designName,
  onDesignNameChange,
  productTitle,
  isSaving,
  onSave,
  undo,
  redo,
  historyIndex,
  canRedo,
  onGenerateAi,
  isGeneratingAi,
  quotaRemaining,
  onTryOn,
}: TopBarProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(designName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(designName) }, [designName])

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== designName) onDesignNameChange(trimmed)
    else setDraft(designName)
    setEditing(false)
  }

  return (
    <div className="flex h-[52px] flex-shrink-0 items-center gap-3 border-b border-neutral-200 bg-white px-4">
      {/* Product + design name */}
      <div className="flex min-w-0 flex-1 items-center gap-2 font-sans">
        <span className="truncate text-xs uppercase tracking-widest text-neutral-400">{productTitle}</span>
        <span className="text-neutral-200">/</span>
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit()
              if (e.key === "Escape") { setDraft(designName); setEditing(false) }
            }}
            className="min-w-0 flex-1 rounded border border-neutral-300 bg-white px-2 py-0.5 text-sm text-neutral-900 outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-300"
            autoFocus
          />
        ) : (
          <button
            onClick={() => { setDraft(designName); setEditing(true) }}
            className="group flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-sm font-medium text-neutral-800 hover:bg-neutral-100"
          >
            <span className="truncate">{designName || "Untitled Design"}</span>
            <span className="text-[10px] text-neutral-300 opacity-0 group-hover:opacity-100">✏</span>
          </button>
        )}
      </div>

      {/* Undo / Redo */}
      <div className="flex items-center gap-0.5">
        <button onClick={undo} disabled={historyIndex <= 0} className={iconBtn} title="Undo (⌘Z)">
          <ArrowUturnLeft className="h-4 w-4" />
        </button>
        <button onClick={redo} disabled={!canRedo} className={iconBtn} title="Redo (⌘⇧Z)">
          <ArrowUturnLeft className="h-4 w-4 -scale-x-100" />
        </button>
      </div>

      <div className="h-4 w-px bg-neutral-200" />

      {/* AI Generate */}
      {onGenerateAi && (
        <button
          onClick={onGenerateAi}
          disabled={isGeneratingAi}
          title={quotaRemaining != null ? `${quotaRemaining} generations remaining` : "Generate with AI"}
          className={clsx(
            "flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium tracking-wide transition-all",
            isGeneratingAi
              ? "cursor-not-allowed bg-neutral-100 text-neutral-400"
              : "bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700"
          )}
        >
          {isGeneratingAi ? (
            <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {isGeneratingAi ? "Generating…" : "AI Generate"}
        </button>
      )}

      {/* Try On */}
      {onTryOn && (
        <button
          onClick={onTryOn}
          className="flex items-center gap-1.5 rounded border border-neutral-200 px-3 py-1.5 text-xs font-medium tracking-wide text-neutral-700 transition-all hover:bg-neutral-50"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Try On
        </button>
      )}

      {/* Save */}
      <button
        onClick={onSave}
        disabled={isSaving}
        className={clsx(
          "rounded px-4 py-1.5 text-xs font-medium tracking-widest uppercase transition-all",
          isSaving
            ? "cursor-not-allowed bg-neutral-100 text-neutral-400"
            : "bg-neutral-900 text-white hover:bg-black"
        )}
      >
        {isSaving ? "Saving…" : "Save"}
      </button>
    </div>
  )
}
