"use client"

import React from "react"
import clsx from "clsx"
import { Text, Tooltip, TooltipProvider } from "@medusajs/ui"
import { Sparkles, XMark } from "@medusajs/icons"
import { AiGenerationHistoryItem, BadgePreferences } from "../types"
import { RawMaterial } from "@lib/data/raw-materials"

type Partner = {
  id: string
  company_name?: string
  name?: string
  location?: string
  [key: string]: any
}

type DesignTabProps = {
  // Badge preferences
  badgePreferences: BadgePreferences
  onEditPreferences: () => void
  // AI generation
  isGeneratingAi: boolean
  aiGenerationError: string | null
  quotaRemaining: number | null | undefined
  generationHistory: AiGenerationHistoryItem[]
  onGenerateAi: () => void
  onClearAiError: () => void
  onSelectFromHistory: (item: AiGenerationHistoryItem) => void
  onClearHistory: () => void
  // Materials
  externalMaterials: RawMaterial[]
  materialsLoading: boolean
  materialsError: string | null
  selectedMaterial: RawMaterial | null
  setSelectedMaterial: (m: RawMaterial | null) => void
  // Partners
  externalPartners: Partner[]
  partnersLoading: boolean
  selectedPartner: Partner | null
  setSelectedPartner: (p: Partner | null) => void
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
      {children}
    </p>
  )
}

export function DesignTab({
  badgePreferences,
  onEditPreferences,
  isGeneratingAi,
  aiGenerationError,
  quotaRemaining,
  generationHistory,
  onGenerateAi,
  onClearAiError,
  onSelectFromHistory,
  onClearHistory,
  externalMaterials,
  materialsLoading,
  materialsError,
  selectedMaterial,
  setSelectedMaterial,
  externalPartners,
  partnersLoading,
  selectedPartner,
  setSelectedPartner,
}: DesignTabProps) {
  // Summarise badge preferences into display rows
  const preferenceItems = React.useMemo(() => {
    const norm = (v: string | null | string[] | undefined): string[] => {
      if (!v) return []
      if (Array.isArray(v)) return v.filter(Boolean) as string[]
      return [v]
    }
    return [
      { label: "Style", values: norm(badgePreferences.style) },
      { label: "Color Palette", values: norm(badgePreferences.colorPalette) },
      { label: "Body Type", values: norm(badgePreferences.bodyType) },
      { label: "Silhouette", values: norm(badgePreferences.silhouette) },
      { label: "Embellishment", values: norm(badgePreferences.embellishment) },
      { label: "Occasion", values: norm(badgePreferences.occasion) },
    ]
  }, [badgePreferences])

  const hasPreferences = preferenceItems.some((item) => item.values.length > 0)

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3 space-y-5" data-lenis-prevent>
      {/* Design Profile / Badge Preferences */}
      <section>
        <SectionHeading>Design Profile</SectionHeading>
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500">Guides cost estimates &amp; AI generation</p>
            <button
              type="button"
              onClick={onEditPreferences}
              className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-semibold text-white shadow hover:bg-black"
            >
              Edit
            </button>
          </div>
          {hasPreferences ? (
            <div className="space-y-2">
              {preferenceItems
                .filter((item) => item.values.length > 0)
                .map((item) => (
                  <div key={item.label}>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">{item.label}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {item.values.map((value) => (
                        <span
                          key={`${item.label}-${value}`}
                          className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 shadow-sm"
                        >
                          {value}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-center">
              <p className="text-xs text-slate-400">No preferences yet. Add them to improve AI results.</p>
            </div>
          )}
        </div>
      </section>

      {/* AI Generation */}
      <section>
        <SectionHeading>AI Generation</SectionHeading>
        <div className="space-y-2">
          <button
            onClick={onGenerateAi}
            disabled={isGeneratingAi}
            className={clsx(
              "w-full rounded-2xl px-4 py-3 text-sm font-medium transition-all flex items-center justify-center gap-2",
              isGeneratingAi
                ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                : "bg-gradient-to-r from-violet-600 to-blue-600 text-white shadow-lg hover:from-violet-700 hover:to-blue-700"
            )}
          >
            {isGeneratingAi ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate with AI
              </>
            )}
          </button>

          {quotaRemaining != null && (
            <p className="text-center text-[11px] text-slate-400">
              {quotaRemaining} generations remaining today
            </p>
          )}

          {aiGenerationError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs text-red-600">{aiGenerationError}</p>
                <button onClick={onClearAiError} className="text-red-400 hover:text-red-600 flex-shrink-0">
                  <XMark className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}

          <p className="text-center text-[11px] text-slate-400">
            Uses your style preferences to generate a unique design base
          </p>
        </div>

        {generationHistory.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Previous</p>
              <button
                onClick={onClearHistory}
                className="text-[10px] text-slate-400 hover:text-red-500 transition-colors"
              >
                Clear all
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {generationHistory.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onSelectFromHistory(item)}
                  className="group relative aspect-square overflow-hidden rounded-xl border-2 border-transparent bg-slate-50 transition-all hover:border-violet-400"
                  title={`Generated: ${new Date(item.generated_at).toLocaleString()}`}
                >
                  <img src={item.preview_url} alt="AI Generated" className="h-full w-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Materials */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <SectionHeading>Materials</SectionHeading>
          {materialsLoading && <p className="text-[10px] text-slate-400">Loading…</p>}
        </div>
        {materialsError && <p className="text-xs text-red-500">{materialsError}</p>}
        {!materialsLoading && externalMaterials.length > 0 && (
          <TooltipProvider>
            <div className="grid grid-cols-4 gap-2">
              {externalMaterials.map((material) => {
                const mediaArray = Array.isArray(material.media) ? material.media : []
                const thumbnail =
                  (mediaArray as any[]).find((m) => m.isThumbnail)?.url ||
                  (mediaArray as any[])[0]?.url
                const isSelected = selectedMaterial?.id === material.id
                return (
                  <Tooltip key={material.id} content={material.name || "Material"}>
                    <button
                      onClick={() => setSelectedMaterial(isSelected ? null : material)}
                      className={clsx(
                        "relative aspect-square rounded-xl border-2 transition-all",
                        isSelected
                          ? "border-blue-500 ring-2 ring-blue-200"
                          : "border-transparent hover:border-slate-200"
                      )}
                    >
                      {thumbnail ? (
                        <img
                          src={thumbnail}
                          alt={material.name || "Material"}
                          className="h-full w-full rounded-[10px] object-cover"
                        />
                      ) : (
                        <div
                          className="flex h-full w-full items-center justify-center rounded-[10px] bg-slate-50 text-lg"
                          style={{ backgroundColor: (material as any).color || "#f3f4f6" }}
                        >
                          🧵
                        </div>
                      )}
                    </button>
                  </Tooltip>
                )
              })}
            </div>
          </TooltipProvider>
        )}
        {!materialsLoading && externalMaterials.length === 0 && !materialsError && (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-center">
            <p className="text-xs text-slate-400">No materials available</p>
          </div>
        )}
        {selectedMaterial && (
          <div className="mt-2 rounded-2xl border border-blue-100 bg-blue-50 p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-800">
                  {selectedMaterial.name || (selectedMaterial as any).material_type?.name}
                </p>
                <p className="text-[11px] text-slate-500">
                  {(selectedMaterial as any).material_type?.category || "Material"}
                </p>
              </div>
              <button onClick={() => setSelectedMaterial(null)} className="text-slate-400 hover:text-red-500">
                <XMark className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Production Partners */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <SectionHeading>Production Partners</SectionHeading>
          {partnersLoading && <p className="text-[10px] text-slate-400">Loading…</p>}
        </div>
        {!partnersLoading && externalPartners.length > 0 && (
          <TooltipProvider>
            <div className="grid grid-cols-2 gap-2">
              {externalPartners.map((partner) => {
                const isSelected = selectedPartner?.id === partner.id
                return (
                  <Tooltip key={partner.id} content={partner.company_name || partner.name || "Partner"}>
                    <button
                      onClick={() => setSelectedPartner(isSelected ? null : partner)}
                      className={clsx(
                        "rounded-xl border-2 p-2.5 text-left transition-all",
                        isSelected
                          ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                          : "border-transparent bg-slate-50 hover:border-slate-200"
                      )}
                    >
                      <p className="truncate text-xs font-semibold text-slate-800">
                        {partner.company_name || partner.name}
                      </p>
                      {partner.location && (
                        <p className="truncate text-[11px] text-slate-500">{partner.location}</p>
                      )}
                    </button>
                  </Tooltip>
                )
              })}
            </div>
          </TooltipProvider>
        )}
        {!partnersLoading && externalPartners.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-center">
            <p className="text-xs text-slate-400">No partners available</p>
          </div>
        )}
        {selectedPartner && (
          <div className="mt-2 rounded-2xl border border-blue-100 bg-blue-50 p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-800">
                  {selectedPartner.company_name || selectedPartner.name}
                </p>
                <p className="text-[11px] text-slate-500">
                  {selectedPartner.location || "Production Partner"}
                </p>
              </div>
              <button onClick={() => setSelectedPartner(null)} className="text-slate-400 hover:text-red-500">
                <XMark className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
