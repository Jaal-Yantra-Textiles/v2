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
  "flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:pointer-events-none disabled:opacity-30"

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

  useEffect(() => {
    setDraft(designName)
  }, [designName])

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== designName) onDesignNameChange(trimmed)
    else setDraft(designName)
    setEditing(false)
  }

  return (
    <div className="flex h-[52px] flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 shadow-sm">
      {/* Product + design name */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm font-medium text-slate-400">{productTitle}</span>
        <span className="text-slate-200">·</span>
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
            className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-sm font-medium text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            autoFocus
          />
        ) : (
          <button
            onClick={() => { setDraft(designName); setEditing(true) }}
            className="group flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-medium text-slate-800 hover:bg-slate-100"
          >
            <span className="truncate">{designName || "Untitled Design"}</span>
            <span className="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100">✏</span>
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

      <div className="h-5 w-px bg-slate-200" />

      {/* AI Generate */}
      {onGenerateAi && (
        <button
          onClick={onGenerateAi}
          disabled={isGeneratingAi}
          title={quotaRemaining != null ? `${quotaRemaining} generations remaining` : "Generate with AI"}
          className={clsx(
            "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
            isGeneratingAi
              ? "cursor-not-allowed bg-slate-100 text-slate-400"
              : "bg-gradient-to-r from-violet-600 to-blue-600 text-white shadow hover:from-violet-700 hover:to-blue-700"
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
          {isGeneratingAi ? "Generating…" : "Generate"}
        </button>
      )}

      {/* Try On */}
      {onTryOn && (
        <button
          onClick={onTryOn}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-all hover:border-slate-400 hover:bg-slate-50"
        >
          <Sparkles className="h-3.5 w-3.5" /> Try On
        </button>
      )}

      {/* Save */}
      <button
        onClick={onSave}
        disabled={isSaving}
        className={clsx(
          "rounded-lg px-4 py-1.5 text-xs font-semibold transition-all",
          isSaving
            ? "cursor-not-allowed bg-slate-100 text-slate-400"
            : "bg-slate-900 text-white hover:bg-black"
        )}
      >
        {isSaving ? "Saving…" : "Save"}
      </button>
    </div>
  )
}
