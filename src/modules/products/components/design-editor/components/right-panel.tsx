"use client"

import React, { useEffect, useState } from "react"
import clsx from "clsx"
import { AiGenerationHistoryItem, BadgePreferences, DesignLayer, DesignState } from "../types"
import { StyleTab } from "./style-tab"
import { LayersTab } from "./layers-tab"
import { DesignTab } from "./design-tab"
import { DesignBriefPanel } from "./design-brief-panel"
import { RawMaterial } from "@lib/data/raw-materials"
import { DesignDetail } from "@lib/data/designs"

type Tab = "layers" | "style" | "design" | "brief"

type Partner = {
  id: string
  company_name?: string
  name?: string
  location?: string
  [key: string]: any
}

type RightPanelProps = {
  // Shared design state
  design: DesignState
  setDesign: React.Dispatch<React.SetStateAction<DesignState>>
  updateLayer: (id: string, attrs: Partial<DesignLayer>) => void
  // Layer actions
  moveLayerUp: () => void
  moveLayerDown: () => void
  toggleLayerVisibility: (id: string) => void
  deleteSelectedLayer: () => void
  duplicateSelectedLayer: () => void
  // Add elements
  onAddText: () => void
  onAddImage: () => void
  onAddRect: () => void
  onAddCircle: () => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  // Alignment & transform
  alignLayer: (direction: "left" | "centerH" | "right" | "top" | "centerV" | "bottom") => void
  flipLayerH: () => void
  flipLayerV: () => void
  // Canvas background
  onBackgroundColorChange: (color: string) => void
  // Print zone
  showPrintZone: boolean
  onTogglePrintZone: () => void
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
  // Design brief (admin-created)
  designSpecs?: NonNullable<DesignDetail["specifications"]>
  designColors?: NonNullable<DesignDetail["colors"]>
  designColorPalette?: Array<{ name: string; code: string }>
  designerNotes?: string
}

const BASE_TABS: { id: Tab; label: string }[] = [
  { id: "layers", label: "Layers" },
  { id: "style", label: "Style" },
  { id: "design", label: "Design" },
]

export function RightPanel({
  design,
  setDesign,
  updateLayer,
  moveLayerUp,
  moveLayerDown,
  toggleLayerVisibility,
  deleteSelectedLayer,
  duplicateSelectedLayer,
  onAddText,
  onAddImage,
  onAddRect,
  onAddCircle,
  fileInputRef,
  alignLayer,
  flipLayerH,
  flipLayerV,
  onBackgroundColorChange,
  showPrintZone,
  onTogglePrintZone,
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
  designSpecs = [],
  designColors,
  designColorPalette,
  designerNotes,
}: RightPanelProps) {
  const hasBrief = designSpecs.length > 0 || (designColors && designColors.length > 0) || (designColorPalette && designColorPalette.length > 0) || !!designerNotes
  const TABS = hasBrief
    ? [...BASE_TABS, { id: "brief" as Tab, label: "Brief" }]
    : BASE_TABS
  const [activeTab, setActiveTab] = useState<Tab>("layers")

  // Auto-switch to Style tab when a layer is selected
  useEffect(() => {
    if (design.selectedId) {
      setActiveTab("style")
    }
  }, [design.selectedId])

  return (
    <div className="flex h-full w-[300px] flex-shrink-0 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      {/* Tab bar */}
      <div className="flex h-10 flex-shrink-0 items-center border-b border-neutral-100 px-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              "flex-1 rounded-md py-1.5 text-xs font-medium transition-all",
              activeTab === tab.id
                ? "bg-neutral-100 text-neutral-900"
                : "text-neutral-400 hover:text-neutral-700"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "layers" && (
          <LayersTab
            design={design}
            setDesign={setDesign}
            onAddText={onAddText}
            onAddImage={onAddImage}
            onAddRect={onAddRect}
            onAddCircle={onAddCircle}
            fileInputRef={fileInputRef}
            moveLayerUp={moveLayerUp}
            moveLayerDown={moveLayerDown}
            toggleLayerVisibility={toggleLayerVisibility}
            deleteSelectedLayer={deleteSelectedLayer}
            duplicateSelectedLayer={duplicateSelectedLayer}
            selectedMaterial={selectedMaterial}
            selectedPartner={selectedPartner}
          />
        )}
        {activeTab === "style" && (
          <StyleTab
            design={design}
            updateLayer={updateLayer}
            alignLayer={alignLayer}
            flipLayerH={flipLayerH}
            flipLayerV={flipLayerV}
            onBackgroundColorChange={onBackgroundColorChange}
            showPrintZone={showPrintZone}
            onTogglePrintZone={onTogglePrintZone}
          />
        )}
        {activeTab === "design" && (
          <DesignTab
            badgePreferences={badgePreferences}
            onEditPreferences={onEditPreferences}
            isGeneratingAi={isGeneratingAi}
            aiGenerationError={aiGenerationError}
            quotaRemaining={quotaRemaining}
            generationHistory={generationHistory}
            onGenerateAi={onGenerateAi}
            onClearAiError={onClearAiError}
            onSelectFromHistory={onSelectFromHistory}
            onClearHistory={onClearHistory}
            externalMaterials={externalMaterials}
            materialsLoading={materialsLoading}
            materialsError={materialsError}
            selectedMaterial={selectedMaterial}
            setSelectedMaterial={setSelectedMaterial}
            externalPartners={externalPartners}
            partnersLoading={partnersLoading}
            selectedPartner={selectedPartner}
            setSelectedPartner={setSelectedPartner}
          />
        )}
        {activeTab === "brief" && (
          <DesignBriefPanel
            designSpecs={designSpecs}
            colors={designColors}
            colorPalette={designColorPalette}
            designerNotes={designerNotes}
          />
        )}
      </div>
    </div>
  )
}
