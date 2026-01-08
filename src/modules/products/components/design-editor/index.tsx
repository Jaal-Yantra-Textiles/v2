"use client"

import React from "react"
import clsx from "clsx"
import { Text } from "@medusajs/ui"
import { CustomerInfo, DesignProduct } from "./types"
import { useDesignEditor } from "./hooks/use-design-editor"
import { EditorCanvas } from "./components/editor-canvas"
import { EditorSidebar } from "./components/editor-sidebar"
import { ZoomControls } from "./components/zoom-controls"
import { NameModal } from "./components/name-modal"
import { MaterialDetailModal } from "./components/material-detail-modal"
import { PartnerDetailModal } from "./components/partner-detail-modal"
import { AiLoginPrompt } from "./components/ai-login-prompt"

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
    const checkMobile = () => {
      setIsMobileLayout(window.innerWidth < 768)
    }

    // Initial check
    checkMobile()

    // Listen for resize
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  const editor = useDesignEditor({
    product,
    customer,
    countryCode,
    isMobileLayout,
  })

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
    <div className="h-[calc(100vh-64px)] bg-slate-50/70">
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

      <div
        className={clsx(
          "mx-auto flex h-full w-full max-w-[1600px] min-h-0",
          isMobileLayout ? "flex-col gap-4 px-4 py-4" : "flex-row gap-6 px-8 py-8"
        )}
      >
        {/* Main Canvas Area */}
        <div
          className={clsx(
            "relative flex flex-1 flex-col min-h-0",
            isMobileLayout
              ? "order-2 pb-[60px]"
              : "order-1 rounded-[32px] border border-ui-border-base bg-white shadow-[0_25px_60px_rgba(15,23,42,0.08)] overflow-hidden"
          )}
        >
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
            isMobileLayout={isMobileLayout}
            sidebarExpanded={editor.sidebarExpanded}
            setSidebarExpanded={editor.setSidebarExpanded}
            selectedMaterial={editor.selectedMaterial}
            setShowMaterialModal={editor.setShowMaterialModal}
            selectedPartner={editor.selectedPartner}
            setShowPartnerModal={editor.setShowPartnerModal}
            isGeneratingAi={editor.isGeneratingAi}
          />

          <ZoomControls
            view={editor.view}
            zoomIn={editor.zoomIn}
            zoomOut={editor.zoomOut}
            resetView={editor.resetView}
            undo={editor.undo}
            historyIndex={editor.historyIndex}
          />
        </div>

        {/* Sidebar */}
        <div
          className={clsx(
            isMobileLayout
              ? "order-1 w-full"
              : "order-2 w-[360px] flex-shrink-0 h-full"
          )}
        >
          <EditorSidebar
            isMobileLayout={isMobileLayout}
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
            isGeneratingAi={editor.isGeneratingAi}
            aiGenerationError={editor.aiGenerationError}
            quotaRemaining={editor.quotaRemaining}
            onGenerateAi={editor.generateAiBase}
            onClearAiError={editor.clearAiError}
          />
        </div>
      </div>

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
    </div>
  )
}
