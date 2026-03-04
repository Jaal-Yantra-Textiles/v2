"use client"

import React, { useCallback } from "react"
import clsx from "clsx"
import { Text } from "@medusajs/ui"
import { CustomerInfo, DesignProduct } from "./types"
import { useDesignEditor } from "./hooks/use-design-editor"
import { EditorCanvas } from "./components/editor-canvas"
import { EditorSidebar } from "./components/editor-sidebar"
import { ZoomControls } from "./components/zoom-controls"
import { TopBar } from "./components/top-bar"
import { ToolStrip } from "./components/tool-strip"
import { RightPanel } from "./components/right-panel"
import { NameModal } from "./components/name-modal"
import { MaterialDetailModal } from "./components/material-detail-modal"
import { PartnerDetailModal } from "./components/partner-detail-modal"
import { AiLoginPrompt } from "./components/ai-login-prompt"
import { DesignCheckoutModal } from "./components/design-checkout-modal"

interface DesignEditorProps {
  product: DesignProduct
  customer?: CustomerInfo | null
  countryCode?: string
  isMobileLayout?: boolean
}

export default function DesignEditor({
  product,
  customer,
  countryCode,
  isMobileLayout: initialMobileLayout = false,
}: DesignEditorProps) {
  // Client-side responsive detection to prevent hydration errors
  const [isMobileLayout, setIsMobileLayout] = React.useState(initialMobileLayout)

  React.useEffect(() => {
    const checkMobile = () => setIsMobileLayout(window.innerWidth < 768)
    checkMobile()
    window.addEventListener("resize", checkMobile)
    return () => window.removeEventListener("resize", checkMobile)
  }, [])

  const editor = useDesignEditor({
    product,
    customer,
    countryCode,
    isMobileLayout,
  })

  const handleBackgroundColorChange = useCallback((color: string) => {
    editor.setDesign((prev) => ({ ...prev, backgroundColor: color }))
  }, [editor.setDesign])

  const showBlockingLoader = editor.baseImageStatus === "loading" && !editor.baseImage
  const showBlockingError = editor.baseImageStatus === "error" && !editor.baseImage && !editor.isGeneratingBase

  if (showBlockingLoader) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4 rounded-3xl border border-slate-200 bg-white px-10 py-8 shadow-lg">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-500" />
          <Text className="text-sm text-slate-600">Preparing your base design…</Text>
        </div>
      </div>
    )
  }

  if (showBlockingError) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 px-4">
        <div className="flex max-w-md flex-col items-center gap-6 rounded-3xl border border-slate-200 bg-white px-10 py-10 text-center shadow-lg">
          <div className="rounded-full bg-slate-100 p-4 text-slate-500">⚠️</div>
          <div>
            <Text weight="plus" className="text-slate-900">
              We couldn&apos;t load a base design
            </Text>
            <Text size="small" className="mt-2 text-slate-600">
              We&apos;ll generate a neutral template so you can keep customizing.
            </Text>
          </div>
          <button
            type="button"
            onClick={editor.regenerateBaseImage}
            className="rounded-full bg-black px-5 py-2 text-sm font-medium text-white hover:bg-gray-900"
          >
            Generate fallback base
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={clsx(
        "bg-slate-50/70",
        isMobileLayout ? "h-[100dvh] overflow-hidden" : "h-[calc(100vh-64px)]"
      )}
    >
      {/* Name Modal */}
      <NameModal
        isOpen={editor.showNameModal}
        productTitle={product.title}
        designName={editor.designName}
        setDesignName={editor.setDesignName}
        badgePreferences={editor.badgePreferences}
        setBadgePreferences={editor.setBadgePreferences}
        onSubmit={editor.handleNameSubmit}
        onSkip={() => {
          editor.setDesignName("Untitled Design")
          editor.setDesign((prev) => ({ ...prev, name: "Untitled Design" }))
          editor.setShowNameModal(false)
        }}
      />

      {/* Hidden file input */}
      <input
        ref={editor.fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) editor.addImageLayer(file)
          e.target.value = ""
        }}
      />

      {/* ─── MOBILE LAYOUT ─────────────────────────────────── */}
      {isMobileLayout && (
        <div className="flex h-full flex-col pb-[60px]">
          {/* Canvas */}
          <div className="relative order-2 flex flex-1 flex-col min-h-0">
            <EditorCanvas
              containerRef={editor.containerRef}
              stageRef={editor.stageRef}
              stageSize={editor.stageSize}
              view={editor.view}
              activeTool={editor.activeTool}
              isPanning={editor.isPanning}
              CANVAS_EXTEND={editor.CANVAS_EXTEND}
              baseImage={editor.baseImage}
              baseImageStatus={editor.baseImageStatus}
              isGeneratingBase={editor.isGeneratingBase}
              regenerateBaseImage={editor.regenerateBaseImage}
              baseDims={editor.baseDims}
              design={editor.design}
              setDesign={editor.setDesign}
              updateLayer={editor.updateLayer}
              handleWheel={editor.handleWheel}
              handleStageMouseDown={editor.handleStageMouseDown}
              handleStageMouseMove={editor.handleStageMouseMove}
              handleStageMouseUp={editor.handleStageMouseUp}
              isMobileLayout={true}
              selectedMaterial={editor.selectedMaterial}
              setShowMaterialModal={editor.setShowMaterialModal}
              selectedPartner={editor.selectedPartner}
              setShowPartnerModal={editor.setShowPartnerModal}
              isGeneratingAi={editor.isGeneratingAi}
              showPrintZone={editor.showPrintZone}
            />
          </div>
          {/* Sidebar */}
          <div className="order-1 w-full flex-shrink-0">
            <EditorSidebar
              isMobileLayout={true}
              sidebarExpanded={editor.sidebarExpanded}
              setSidebarExpanded={editor.setSidebarExpanded}
              product={product}
              design={editor.design}
              setDesign={editor.setDesign}
              badgePreferences={editor.badgePreferences}
              onEditPreferences={() => editor.setShowNameModal(true)}
              activeTool={editor.activeTool}
              setActiveTool={editor.setActiveTool}
              fileInputRef={editor.fileInputRef}
              addImageLayer={editor.addImageLayer}
              addTextLayer={editor.addTextLayer}
              externalMaterials={editor.externalMaterials}
              materialsLoading={editor.materialsLoading}
              materialsError={editor.materialsError}
              selectedMaterial={editor.selectedMaterial}
              setSelectedMaterial={editor.setSelectedMaterial}
              showOnboarding={editor.showOnboarding}
              onboardingSteps={editor.onboardingSteps}
              onboardingStep={editor.onboardingStep}
              handleNextStep={editor.handleNextStep}
              handlePrevStep={editor.handlePrevStep}
              handleSkipOnboarding={editor.handleSkipOnboarding}
              updateLayer={editor.updateLayer}
              externalPartners={editor.externalPartners}
              partnersLoading={editor.partnersLoading}
              selectedPartner={editor.selectedPartner}
              setSelectedPartner={editor.setSelectedPartner}
              moveLayerUp={editor.moveLayerUp}
              moveLayerDown={editor.moveLayerDown}
              toggleLayerVisibility={editor.toggleLayerVisibility}
              deleteSelectedLayer={editor.deleteSelectedLayer}
              handleSave={editor.handleSave}
              isSaving={editor.isSaving}
              undo={editor.undo}
              historyIndex={editor.historyIndex}
              isGeneratingAi={editor.isGeneratingAi}
              aiGenerationError={editor.aiGenerationError}
              quotaRemaining={editor.quotaRemaining}
              generationHistory={editor.generationHistory}
              onGenerateAi={editor.generateAiBase}
              onClearAiError={editor.clearAiError}
              onSelectFromHistory={editor.selectFromHistory}
              onClearHistory={editor.clearHistory}
            />
          </div>
        </div>
      )}

      {/* ─── DESKTOP LAYOUT ────────────────────────────────── */}
      {!isMobileLayout && (
        <div className="flex h-full flex-col">
          {/* Top bar */}
          <TopBar
            designName={editor.designName || editor.design.name || ""}
            onDesignNameChange={(name) => {
              editor.setDesignName(name)
              editor.setDesign((prev) => ({ ...prev, name }))
            }}
            productTitle={product.title}
            isSaving={editor.isSaving}
            onSave={editor.handleSave}
            undo={editor.undo}
            redo={editor.redo}
            historyIndex={editor.historyIndex}
            canRedo={editor.canRedo}
            onGenerateAi={editor.generateAiBase}
            isGeneratingAi={editor.isGeneratingAi}
            quotaRemaining={editor.quotaRemaining}
          />

          {/* Main area: ToolStrip + Canvas + RightPanel */}
          <div className="flex min-h-0 flex-1">
            {/* Tool strip */}
            <ToolStrip
              activeTool={editor.activeTool}
              setActiveTool={editor.setActiveTool}
              onAddText={editor.addTextLayer}
              onAddImage={() => editor.fileInputRef.current?.click()}
              onAddRect={editor.addRectLayer}
              onAddCircle={editor.addCircleLayer}
              showPrintZone={editor.showPrintZone}
              onTogglePrintZone={editor.togglePrintZone}
            />

            {/* Canvas area */}
            <div className="relative flex flex-1 flex-col overflow-hidden">
              <EditorCanvas
                containerRef={editor.containerRef}
                stageRef={editor.stageRef}
                stageSize={editor.stageSize}
                view={editor.view}
                activeTool={editor.activeTool}
                isPanning={editor.isPanning}
                CANVAS_EXTEND={editor.CANVAS_EXTEND}
                baseImage={editor.baseImage}
                baseImageStatus={editor.baseImageStatus}
                isGeneratingBase={editor.isGeneratingBase}
                regenerateBaseImage={editor.regenerateBaseImage}
                baseDims={editor.baseDims}
                design={editor.design}
                setDesign={editor.setDesign}
                updateLayer={editor.updateLayer}
                handleWheel={editor.handleWheel}
                handleStageMouseDown={editor.handleStageMouseDown}
                handleStageMouseMove={editor.handleStageMouseMove}
                handleStageMouseUp={editor.handleStageMouseUp}
                isMobileLayout={false}
                selectedMaterial={editor.selectedMaterial}
                setShowMaterialModal={editor.setShowMaterialModal}
                selectedPartner={editor.selectedPartner}
                setShowPartnerModal={editor.setShowPartnerModal}
                isGeneratingAi={editor.isGeneratingAi}
                showPrintZone={editor.showPrintZone}
              />

              <ZoomControls
                view={editor.view}
                zoomIn={editor.zoomIn}
                zoomOut={editor.zoomOut}
                resetView={editor.resetView}
                undo={editor.undo}
                redo={editor.redo}
                historyIndex={editor.historyIndex}
                canRedo={editor.canRedo}
              />
            </div>

            {/* Right panel */}
            <div className="flex flex-shrink-0 items-start p-3">
              <RightPanel
                design={editor.design}
                setDesign={editor.setDesign}
                updateLayer={editor.updateLayer}
                moveLayerUp={editor.moveLayerUp}
                moveLayerDown={editor.moveLayerDown}
                toggleLayerVisibility={editor.toggleLayerVisibility}
                deleteSelectedLayer={editor.deleteSelectedLayer}
                duplicateSelectedLayer={editor.duplicateSelectedLayer}
                onAddText={editor.addTextLayer}
                onAddImage={() => editor.fileInputRef.current?.click()}
                onAddRect={editor.addRectLayer}
                onAddCircle={editor.addCircleLayer}
                fileInputRef={editor.fileInputRef}
                alignLayer={editor.alignLayer}
                flipLayerH={editor.flipLayerH}
                flipLayerV={editor.flipLayerV}
                onBackgroundColorChange={handleBackgroundColorChange}
                showPrintZone={editor.showPrintZone}
                onTogglePrintZone={editor.togglePrintZone}
                badgePreferences={editor.badgePreferences}
                onEditPreferences={() => editor.setShowNameModal(true)}
                isGeneratingAi={editor.isGeneratingAi}
                aiGenerationError={editor.aiGenerationError}
                quotaRemaining={editor.quotaRemaining}
                generationHistory={editor.generationHistory}
                onGenerateAi={editor.generateAiBase}
                onClearAiError={editor.clearAiError}
                onSelectFromHistory={editor.selectFromHistory}
                onClearHistory={editor.clearHistory}
                externalMaterials={editor.externalMaterials}
                materialsLoading={editor.materialsLoading}
                materialsError={editor.materialsError}
                selectedMaterial={editor.selectedMaterial}
                setSelectedMaterial={editor.setSelectedMaterial}
                externalPartners={editor.externalPartners}
                partnersLoading={editor.partnersLoading}
                selectedPartner={editor.selectedPartner}
                setSelectedPartner={editor.setSelectedPartner}
              />
            </div>
          </div>
        </div>
      )}

      {/* Detail Modals */}
      <MaterialDetailModal
        isOpen={editor.showMaterialModal}
        onClose={() => editor.setShowMaterialModal(false)}
        material={editor.selectedMaterial!}
        onRemove={() => editor.setSelectedMaterial(null)}
      />

      <PartnerDetailModal
        isOpen={editor.showPartnerModal}
        onClose={() => editor.setShowPartnerModal(false)}
        partner={editor.selectedPartner!}
        onRemove={() => editor.setSelectedPartner(null)}
      />

      {/* AI Login Prompt Modal */}
      <AiLoginPrompt
        isOpen={editor.showLoginPrompt}
        onLogin={editor.handleLoginRedirect}
        onCancel={editor.dismissLoginPrompt}
      />

      {/* Save error notification */}
      {editor.saveError && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-full border border-red-200 bg-red-50 px-5 py-2.5 shadow-lg">
            <span className="text-sm font-medium text-red-700">{editor.saveError}</span>
            <button
              type="button"
              onClick={editor.clearSaveError}
              className="rounded-full p-0.5 text-red-400 hover:text-red-600"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Design Checkout Modal */}
      <DesignCheckoutModal
        isOpen={editor.showCheckoutModal}
        onClose={() => editor.setShowCheckoutModal(false)}
        designId={editor.savedDesignId}
        designName={editor.designName || editor.design.name || ""}
        countryCode={countryCode || "us"}
      />
    </div>
  )
}
