"use client"

import React from "react"
import { Text } from "@medusajs/ui"
import { CustomerInfo, DesignProduct } from "./types"
import { useDesignEditor } from "./hooks/use-design-editor"
import { EditorCanvas } from "./components/editor-canvas"
import { EditorSidebar } from "./components/editor-sidebar"
import { ZoomControls } from "./components/zoom-controls"
import { NameModal } from "./components/name-modal"
import { MaterialDetailModal } from "./components/material-detail-modal"
import { PartnerDetailModal } from "./components/partner-detail-modal"

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

  // Loading state
  if (product.thumbnail && editor.baseImageStatus === "loading") {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-indigo-500" />
          <Text className="text-gray-600">Loading design editor...</Text>
        </div>
      </div>
    )
  }

  // No image fallback
  if (product.thumbnail && editor.baseImageStatus === "error") {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <Text weight="plus">No product image available</Text>
          <Text size="small" className="text-gray-600">
            This product doesn&apos;t have an image to customize.
          </Text>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`relative flex h-[calc(100vh-64px)] bg-white overflow-hidden ${isMobileLayout ? "flex-col" : ""}`}
    >
      {/* Name Modal */}
      <NameModal
        isOpen={editor.showNameModal}
        productTitle={product.title}
        designName={editor.designName}
        setDesignName={editor.setDesignName}
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

      {/* Main Canvas Area */}
      <div className={`flex flex-1 flex-col min-h-0 ${isMobileLayout ? "pb-[60px]" : ""} relative`}>
        <EditorCanvas
          containerRef={editor.containerRef}
          stageRef={editor.stageRef}
          stageSize={editor.stageSize}
          view={editor.view}
          activeTool={editor.activeTool}
          isPanning={editor.isPanning}
          CANVAS_EXTEND={editor.CANVAS_EXTEND}
          baseImage={editor.baseImage}
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
      <EditorSidebar
        isMobileLayout={isMobileLayout}
        sidebarExpanded={editor.sidebarExpanded}
        setSidebarExpanded={editor.setSidebarExpanded}
        product={product}
        design={editor.design}
        setDesign={editor.setDesign}
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
        setShowOnboarding={editor.setShowOnboarding}
        onboardingSteps={editor.onboardingSteps}
        onboardingStep={editor.onboardingStep}
        handleNextStep={editor.handleNextStep}
        handlePrevStep={editor.handlePrevStep}
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
      />

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

      {/* Save Button (Absolute positioned / floating) - Desktop only */}
      {!isMobileLayout && (
        <div className="absolute top-4 right-[420px] z-30 flex gap-2">
          <button
            onClick={editor.handleSave}
            disabled={editor.isSaving}
            className={`px-6 py-2.5 rounded-xl shadow-lg font-medium transition-all ${editor.isSaving
              ? "bg-gray-100 text-gray-400 cursor-not-allowed"
              : "bg-black text-white hover:bg-gray-800 hover:shadow-xl"
              }`}
          >
            {editor.isSaving ? "Saving..." : "Save Design"}
          </button>
        </div>
      )}
    </div>
  )
}
