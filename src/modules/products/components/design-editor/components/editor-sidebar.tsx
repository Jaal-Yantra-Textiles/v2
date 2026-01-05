"use client"

import clsx from "clsx"
import React, { useEffect, useMemo, useCallback } from "react"
import { Text, Tooltip, TooltipProvider } from "@medusajs/ui"
import {
    Plus,
    ArrowsPointingOutMini,
    CursorArrowRays,
    XMark,
} from "@medusajs/icons"
import { DesignLayer, DesignState, DesignProduct } from "../types"
import { LayerProperties } from "./layer-properties"
import OnboardingOverlay from "./onboarding-overlay"
import { RawMaterial } from "@lib/data/raw-materials"

type EditorSidebarProps = {
    isMobileLayout: boolean
    sidebarExpanded: boolean
    setSidebarExpanded: React.Dispatch<React.SetStateAction<boolean>>
    product: DesignProduct
    design: DesignState
    setDesign: React.Dispatch<React.SetStateAction<DesignState>>
    activeTool: "select" | "pan"
    setActiveTool: React.Dispatch<React.SetStateAction<"select" | "pan">>
    fileInputRef: React.RefObject<HTMLInputElement | null>
    addImageLayer: (file: File) => void
    addTextLayer: () => void
    externalMaterials: RawMaterial[]
    materialsLoading: boolean
    materialsError: string | null
    selectedMaterial: RawMaterial | null
    setSelectedMaterial: React.Dispatch<React.SetStateAction<RawMaterial | null>>
    showOnboarding: boolean
    onboardingSteps: { title: string; description: string }[]
    onboardingStep: number
    handleNextStep: () => void
    handlePrevStep: () => void
    handleSkipOnboarding: () => void
    updateLayer: (id: string, attrs: Partial<DesignLayer>) => void
    externalPartners: any[]
    partnersLoading: boolean
    selectedPartner: any | null
    setSelectedPartner: React.Dispatch<React.SetStateAction<any | null>>
    moveLayerUp: () => void
    moveLayerDown: () => void
    toggleLayerVisibility: (id: string) => void
    deleteSelectedLayer: () => void
    handleSave: () => void
    isSaving: boolean
}

type SectionKey = "product" | "tools" | "add" | "materials" | "partners" | "layers" | "properties"
const sectionOrder: SectionKey[] = ["product", "tools", "add", "materials", "partners", "layers", "properties"]
const sectionLabels: Record<SectionKey, string> = {
    product: "Product Info",
    tools: "Canvas Tools",
    add: "Add Elements",
    materials: "Materials",
    partners: "Partners",
    layers: "Layers",
    properties: "Properties",
}
type SectionRefs = Record<SectionKey, React.RefObject<HTMLDivElement | null>>

export function EditorSidebar({
    isMobileLayout,
    sidebarExpanded,
    setSidebarExpanded,
    product,
    design,
    setDesign,
    activeTool,
    setActiveTool,
    fileInputRef,
    addImageLayer,
    addTextLayer,
    externalMaterials,
    materialsLoading,
    materialsError,
    selectedMaterial,
    setSelectedMaterial,
    showOnboarding,
    onboardingSteps,
    onboardingStep,
    handleNextStep,
    handlePrevStep,
    handleSkipOnboarding,
    updateLayer,
    externalPartners,
    partnersLoading,
    selectedPartner,
    setSelectedPartner,
    moveLayerUp,
    moveLayerDown,
    toggleLayerVisibility,
    deleteSelectedLayer,
    handleSave,
    isSaving,
}: EditorSidebarProps) {
    // State for mobile overlay sheets
    const [mobileActiveTab, setMobileActiveTab] = React.useState<string | null>(null)

    // Handlers for mobile toolbar interactions
    const toggleMobileTab = (tab: string) => {
        if (mobileActiveTab === tab) {
            setMobileActiveTab(null)
        } else {
            setMobileActiveTab(tab)
        }
    }

    // --- MOBILE LAYOUT ---
    if (isMobileLayout) {
        return (
            <>
                <OnboardingOverlay
                    visible={showOnboarding}
                    steps={onboardingSteps}
                    currentStep={onboardingStep}
                    onNext={handleNextStep}
                    onPrev={handlePrevStep}
                    onSkip={handleSkipOnboarding}
                    isMobile={true}
                />

                {/* Mobile Active Tab Overlay (Sheet) */}
                {mobileActiveTab && (
                    <div className="fixed bottom-[60px] left-0 right-0 z-20 mx-2 mb-2 max-h-[60vh] overflow-y-auto rounded-xl border border-ui-border-base bg-white/95 p-4 shadow-2xl backdrop-blur transition-all animate-in slide-in-from-bottom-5">
                        <div className="flex items-center justify-between mb-3 border-b pb-2">
                            <Text weight="plus" className="capitalize">{mobileActiveTab}</Text>
                            <button onClick={() => setMobileActiveTab(null)}><XMark /></button>
                        </div>

                        {/* Tab Content */}
                        {mobileActiveTab === "add" && (
                            <div className="flex flex-col gap-2">
                                <button
                                    onClick={() => {
                                        fileInputRef.current?.click()
                                        setMobileActiveTab(null)
                                    }}
                                    className="flex items-center gap-3 rounded-lg bg-ui-bg-subtle p-3 hover:bg-ui-bg-base"
                                >
                                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                                        <Plus />
                                    </div>
                                    <Text>Upload Image</Text>
                                </button>
                                <button
                                    onClick={() => {
                                        addTextLayer()
                                        setMobileActiveTab(null)
                                    }}
                                    className="flex items-center gap-3 rounded-lg bg-ui-bg-subtle p-3 hover:bg-ui-bg-base"
                                >
                                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 text-purple-600">
                                        <Plus />
                                    </div>
                                    <Text>Add Text</Text>
                                </button>
                            </div>
                        )}

                        {mobileActiveTab === "materials" && (
                            <div className="grid grid-cols-3 gap-2">
                                {materialsLoading && <Text size="small">Loading...</Text>}
                                {!materialsLoading && externalMaterials.map((material) => {
                                    const mediaArray = Array.isArray(material.media) ? material.media : []
                                    const thumbnail = mediaArray.find((m: any) => m.isThumbnail)?.url || mediaArray[0]?.url
                                    return (
                                        <button
                                            key={material.id}
                                            onClick={() => {
                                                setSelectedMaterial(selectedMaterial?.id === material.id ? null : material)
                                                // Don't close immediately so they can browse
                                            }}
                                            className={`aspect-square rounded-lg overflow-hidden border-2 relative ${selectedMaterial?.id === material.id ? 'border-blue-500' : 'border-transparent'
                                                }`}
                                        >
                                            {thumbnail ? (
                                                <img src={thumbnail} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full bg-gray-100 flex items-center justify-center">🧵</div>
                                            )}
                                        </button>
                                    )
                                })}
                            </div>
                        )}

                        {mobileActiveTab === "tools" && (
                            <div className="flex gap-2">
                                <button
                                    onClick={() => {
                                        setActiveTool("select")
                                        setMobileActiveTab(null)
                                    }}
                                    className={`flex-1 rounded-lg p-3 text-center border ${activeTool === "select" ? "bg-black text-white" : "bg-gray-50"}`}
                                >
                                    Select
                                </button>
                                <button
                                    onClick={() => {
                                        setActiveTool("pan")
                                        setMobileActiveTab(null)
                                    }}
                                    className={`flex-1 rounded-lg p-3 text-center border ${activeTool === "pan" ? "bg-black text-white" : "bg-gray-50"}`}
                                >
                                    Pan
                                </button>
                            </div>
                        )}

                        {mobileActiveTab === "layers" && design.selectedId && (
                            // Simple properties for selected layer
                            (() => {
                                const layer = design.layers.find(l => l.id === design.selectedId)
                                if (!layer) return <Text size="small">No layer selected</Text>
                                return <LayerProperties layer={layer} onChange={updateLayer} />
                            })()
                        )}
                        {mobileActiveTab === "layers" && !design.selectedId && (
                            <Text size="small" className="text-gray-500 text-center py-4">Select an element on the canvas to edit its properties.</Text>
                        )}
                    </div>
                )}

                {/* Bottom Toolbar */}
                <div className="fixed bottom-0 left-0 right-0 z-30 flex h-[60px] items-center justify-around border-t border-ui-border-base bg-white px-2 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
                    <button onClick={() => toggleMobileTab("tools")} className={`flex flex-col items-center gap-1 p-2 ${mobileActiveTab === "tools" ? "text-blue-600" : "text-gray-500"}`}>
                        <CursorArrowRays className="h-5 w-5" />
                        <span className="text-[10px] font-medium">Tools</span>
                    </button>
                    <button onClick={() => toggleMobileTab("materials")} className={`flex flex-col items-center gap-1 p-2 ${mobileActiveTab === "materials" ? "text-blue-600" : "text-gray-500"}`}>
                        <div className="h-5 w-5 rounded-full border border-current flex items-center justify-center text-[10px]">M</div>
                        <span className="text-[10px] font-medium">Fabrics</span>
                    </button>

                    {/* Main Action Button */}
                    <button
                        onClick={() => toggleMobileTab("add")}
                        className="flex h-12 w-12 -translate-y-4 items-center justify-center rounded-full bg-black text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
                    >
                        <Plus className="h-6 w-6" />
                    </button>

                    <button onClick={() => toggleMobileTab("layers")} className={`flex flex-col items-center gap-1 p-2 ${mobileActiveTab === "layers" ? "text-blue-600" : "text-gray-500"}`}>
                        <ArrowsPointingOutMini className="h-5 w-5" />
                        <span className="text-[10px] font-medium">Edit</span>
                    </button>
                    {/* Save Button */}
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className={`flex flex-col items-center gap-1 p-2 ${isSaving ? "text-gray-400" : "text-green-600"}`}
                    >
                        <div className="h-5 w-5 flex items-center justify-center">
                            {isSaving ? "⏳" : "💾"}
                        </div>
                        <span className="text-[10px] font-medium">{isSaving ? "Saving" : "Save"}</span>
                    </button>
                </div>
            </>
        )
    }

    // --- DESKTOP LAYOUT (Floating) ---
    const scrollContainerRef = React.useRef<HTMLDivElement>(null)
    const sectionRefs = useMemo<SectionRefs>(() => {
        return sectionOrder.reduce((acc, key) => {
            acc[key] = React.createRef<HTMLDivElement>()
            return acc
        }, {} as SectionRefs)
    }, [])
    const [activeSection, setActiveSection] = React.useState<SectionKey>("product")

    const scrollToSection = useCallback(
        (key: SectionKey) => {
            const container = scrollContainerRef.current
            const node = sectionRefs[key]?.current
            if (container && node) {
                container.scrollTo({
                    top: node.offsetTop - 16,
                    behavior: "smooth",
                })
            }
        },
        [sectionRefs]
    )

    useEffect(() => {
        if (!sidebarExpanded) return
        const container = scrollContainerRef.current
        if (!container) return

        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries
                    .filter((entry) => entry.isIntersecting)
                    .sort((a, b) => (a.target as HTMLElement).offsetTop - (b.target as HTMLElement).offsetTop)
                if (visible[0]) {
                    const id = visible[0].target.getAttribute("data-section-id") as SectionKey | null
                    if (id && id !== activeSection) {
                        setActiveSection(id)
                    }
                }
            },
            {
                root: container,
                threshold: 0.3,
            }
        )

        sectionOrder.forEach((key) => {
            const node = sectionRefs[key]?.current
            if (node) observer.observe(node)
        })

        return () => observer.disconnect()
    }, [sidebarExpanded, sectionRefs, activeSection])

    return (
        <>
            {/* Onboarding Wizard - Managed by index.tsx or here? It's passed as prop. 
                 It handles its own visibility.
             */}
            <OnboardingOverlay
                visible={showOnboarding}
                steps={onboardingSteps}
                currentStep={onboardingStep}
                onNext={handleNextStep}
                onPrev={handlePrevStep}
                onSkip={handleSkipOnboarding}
            />

            <div
                className="relative flex h-full flex-1 rounded-3xl border border-ui-border-base bg-white/95 shadow-2xl backdrop-blur transition-all duration-300"
                style={{
                    transform: 'translate3d(0, 0, 0)',
                    WebkitTransform: 'translate3d(0, 0, 0)',
                    willChange: 'transform',
                    isolation: 'isolate',
                    WebkitBackdropFilter: 'blur(12px)',
                    backdropFilter: 'blur(12px)',
                }}
            >
                <div className="flex flex-shrink-0 items-center justify-between border-b px-4 py-3">
                    <div className="flex-1">
                        <Text weight="plus" size="small" className="text-gray-900">
                            {sectionLabels[activeSection]}
                        </Text>
                        <Text size="small" className="text-xs text-gray-400">
                            Design Tools
                        </Text>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${isSaving
                                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                                : "bg-black text-white hover:bg-gray-800"
                                }`}
                        >
                            {isSaving ? "Saving..." : "Save"}
                        </button>
                        <button onClick={() => setSidebarExpanded((prev) => !prev)} className="text-gray-400 hover:text-black">
                            <ArrowsPointingOutMini className={`h-4 w-4 transition-transform ${sidebarExpanded ? "rotate-45" : ""}`} />
                        </button>
                    </div>
                </div>

                {sidebarExpanded && (
                    <div className="flex-1 flex flex-col">
                        {(selectedMaterial || selectedPartner) && (
                            <div className="border-b border-ui-border-base bg-white/90 px-4 py-3 backdrop-blur-sm">
                                <div className="space-y-3">
                                    {selectedMaterial && (
                                        <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-3 shadow-inner">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <Text weight="plus" size="small" className="truncate text-blue-900">
                                                        {selectedMaterial.name || selectedMaterial.material_type?.name || "Selected material"}
                                                    </Text>
                                                    <Text size="small" className="text-xs text-blue-700">
                                                        {selectedMaterial.material_type?.category || "Material selection"}
                                                    </Text>
                                                </div>
                                                <button
                                                    onClick={() => setSelectedMaterial(null)}
                                                    className="text-blue-500 hover:text-blue-700"
                                                    aria-label="Clear material selection"
                                                >
                                                    <XMark className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                    {selectedPartner && (
                                        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3 shadow-inner">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <Text weight="plus" size="small" className="truncate text-emerald-900">
                                                        {selectedPartner.company_name || selectedPartner.name || "Selected partner"}
                                                    </Text>
                                                    <Text size="small" className="text-xs text-emerald-700">
                                                        {selectedPartner.location || "Production partner"}
                                                    </Text>
                                                </div>
                                                <button
                                                    onClick={() => setSelectedPartner(null)}
                                                    className="text-emerald-500 hover:text-emerald-700"
                                                    aria-label="Clear partner selection"
                                                >
                                                    <XMark className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        <div
                            ref={scrollContainerRef}
                            className="flex-1 overflow-y-auto px-1"
                            style={{ maxHeight: "calc(100vh - 220px)", overscrollBehavior: "contain" }}
                        >
                        {/* Product Section */}
                        <section ref={sectionRefs.product} data-section-id="product">
                            <Text size="small" weight="plus" className="mb-2 px-4 pt-4 text-xs uppercase tracking-wide text-gray-500">
                                Base Product
                            </Text>
                            <div className="px-4 pb-4">
                                <div className="rounded-2xl border border-ui-border-base bg-gray-50 p-4">
                                    <Text weight="plus" className="text-gray-900">
                                        {product.title}
                                    </Text>
                                    {product.description && (
                                        <Text size="small" className="mt-1 text-gray-600">
                                            {product.description}
                                        </Text>
                                    )}
                                </div>
                            </div>
                        </section>

                        {/* Tools Section */}
                        <section ref={sectionRefs.tools} data-section-id="tools">
                            <Text size="small" weight="plus" className="mb-2 px-4 pt-2 text-xs uppercase tracking-wide text-gray-500">
                                Canvas Tools
                            </Text>
                            <div className="px-4 pb-4">
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setActiveTool("select")}
                                        className={clsx(
                                            "flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-colors",
                                            activeTool === "select"
                                                ? "border-black bg-black text-white"
                                                : "border-ui-border-base bg-gray-50 hover:bg-gray-100"
                                        )}
                                    >
                                        Select
                                    </button>
                                    <button
                                        onClick={() => setActiveTool("pan")}
                                        className={clsx(
                                            "flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-colors",
                                            activeTool === "pan"
                                                ? "border-black bg-black text-white"
                                                : "border-ui-border-base bg-gray-50 hover:bg-gray-100"
                                        )}
                                    >
                                        Pan
                                    </button>
                                </div>
                            </div>
                        </section>

                        {/* Add Section */}
                        <section ref={sectionRefs.add} data-section-id="add">
                            <Text size="small" weight="plus" className="mb-2 px-4 pt-2 text-xs uppercase tracking-wide text-gray-500">
                                Add Elements
                            </Text>
                            <div className="px-4 pb-4 grid grid-cols-2 gap-3">
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                                >
                                    + Image
                                </button>
                                <button
                                    onClick={addTextLayer}
                                    className="rounded-2xl border border-purple-200 bg-purple-50 px-4 py-3 text-sm font-medium text-purple-700 hover:bg-purple-100 transition-colors"
                                >
                                    + Text
                                </button>
                            </div>
                        </section>

                        {/* Materials Section */}
                        <section ref={sectionRefs.materials} data-section-id="materials">
                            <div className="flex items-center justify-between px-4 pt-2">
                                <Text size="small" weight="plus" className="text-xs uppercase tracking-wide text-gray-500">
                                    Materials
                                </Text>
                                {materialsLoading && (
                                    <Text size="small" className="text-[10px] text-gray-400">
                                        Loading…
                                    </Text>
                                )}
                            </div>
                            <div className="px-4 pb-4">
                                {materialsError && (
                                    <Text size="small" className="text-xs text-red-500">
                                        {materialsError}
                                    </Text>
                                )}
                                {!materialsLoading && externalMaterials.length > 0 && (
                                    <TooltipProvider>
                                        <div className="grid grid-cols-4 gap-2">
                                            {externalMaterials.map((material) => {
                                                const mediaArray = Array.isArray(material.media) ? material.media : []
                                                const thumbnail =
                                                    mediaArray.find((m: any) => m.isThumbnail)?.url || mediaArray[0]?.url
                                                const isSelected = selectedMaterial?.id === material.id

                                                return (
                                                    <Tooltip key={material.id} content={material.name || "Material"}>
                                                        <button
                                                            onClick={() => setSelectedMaterial(isSelected ? null : material)}
                                                            className={clsx(
                                                                "relative aspect-square rounded-xl border-2 transition-all",
                                                                isSelected
                                                                    ? "border-blue-500 ring-2 ring-blue-200"
                                                                    : "border-transparent hover:border-gray-200"
                                                            )}
                                                        >
                                                            {thumbnail ? (
                                                                <img
                                                                    src={thumbnail}
                                                                    alt={material.name || "Material"}
                                                                    className="h-full w-full rounded-lg object-cover"
                                                                />
                                                            ) : (
                                                                <div
                                                                    className="flex h-full w-full items-center justify-center rounded-lg bg-gray-50"
                                                                    style={{ backgroundColor: material.color || "#f3f4f6" }}
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

                                {selectedMaterial && (
                                    <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50 p-3">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <Text weight="plus" size="small">
                                                    {selectedMaterial.name || selectedMaterial.material_type?.name}
                                                </Text>
                                                <Text size="small" className="text-xs text-gray-500">
                                                    {selectedMaterial.material_type?.category || "Material"}
                                                </Text>
                                            </div>
                                            <button
                                                onClick={() => setSelectedMaterial(null)}
                                                className="text-gray-400 hover:text-red-500"
                                            >
                                                <XMark className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </section>

                        {/* Partners Section */}
                        <section ref={sectionRefs.partners} data-section-id="partners">
                            <div className="flex items-center justify-between px-4 pt-2">
                                <Text size="small" weight="plus" className="text-xs uppercase tracking-wide text-gray-500">
                                    Production Partners
                                </Text>
                                {partnersLoading && (
                                    <Text size="small" className="text-[10px] text-gray-400">
                                        Loading…
                                    </Text>
                                )}
                            </div>
                            <div className="px-4 pb-4">
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
                                                                "relative rounded-xl border-2 p-3 text-left transition-all",
                                                                isSelected
                                                                    ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                                                                    : "border-transparent bg-gray-50 hover:border-gray-200"
                                                            )}
                                                        >
                                                            <Text weight="plus" size="small" className="truncate">
                                                                {partner.company_name || partner.name}
                                                            </Text>
                                                            {partner.location && (
                                                                <Text size="small" className="text-xs text-gray-500 truncate">
                                                                    {partner.location}
                                                                </Text>
                                                            )}
                                                        </button>
                                                    </Tooltip>
                                                )
                                            })}
                                        </div>
                                    </TooltipProvider>
                                )}

                                {selectedPartner && (
                                    <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50 p-3">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <Text weight="plus" size="small">
                                                    {selectedPartner.company_name || selectedPartner.name}
                                                </Text>
                                                <Text size="small" className="text-xs text-gray-500">
                                                    {selectedPartner.location || "Production Partner"}
                                                </Text>
                                            </div>
                                            <button
                                                onClick={() => setSelectedPartner(null)}
                                                className="text-gray-400 hover:text-red-500"
                                            >
                                                <XMark className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </section>

                        {/* Layers Section */}
                        <section ref={sectionRefs.layers} data-section-id="layers">
                            <Text size="small" weight="plus" className="mb-2 px-4 pt-2 text-xs uppercase tracking-wide text-gray-500">
                                All Layers
                            </Text>
                            <div className="px-4 pb-4">
                                {design.layers.length === 0 ? (
                                    <Text size="small" className="text-xs text-gray-500">
                                        No layers yet. Add text or images to get started.
                                    </Text>
                                ) : (
                                    <div className="space-y-2">
                                        {design.layers.map((layer, index) => (
                                            <div
                                                key={layer.id}
                                                onClick={() => setDesign(prev => ({ ...prev, selectedId: layer.id }))}
                                                className={clsx(
                                                    "flex items-center gap-2 rounded-xl border p-2 cursor-pointer transition-all",
                                                    design.selectedId === layer.id
                                                        ? "border-blue-500 bg-blue-50"
                                                        : "border-gray-200 bg-gray-50 hover:border-gray-300"
                                                )}
                                            >
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        toggleLayerVisibility(layer.id)
                                                    }}
                                                    className="text-gray-400 hover:text-gray-600"
                                                >
                                                    {layer.opacity === 0 ? "👁️‍🗨️" : "👁️"}
                                                </button>
                                                <div className="flex-1 min-w-0">
                                                    <Text size="small" weight="plus" className="truncate">
                                                        {layer.type === "text" ? layer.text : `Image ${index + 1}`}
                                                    </Text>
                                                    <Text size="small" className="text-xs text-gray-500">
                                                        {layer.type}
                                                    </Text>
                                                </div>
                                                <div className="flex gap-1">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            setDesign(prev => ({ ...prev, selectedId: layer.id }))
                                                            moveLayerUp()
                                                        }}
                                                        disabled={index === design.layers.length - 1}
                                                        className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                                                    >
                                                        ↑
                                                    </button>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            setDesign(prev => ({ ...prev, selectedId: layer.id }))
                                                            moveLayerDown()
                                                        }}
                                                        disabled={index === 0}
                                                        className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                                                    >
                                                        ↓
                                                    </button>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            setDesign(prev => ({ ...prev, selectedId: layer.id }))
                                                            deleteSelectedLayer()
                                                        }}
                                                        className="text-gray-400 hover:text-red-500"
                                                    >
                                                        <XMark className="h-3 w-3" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </section>

                        {/* Properties Section */}
                        <section ref={sectionRefs.properties} data-section-id="properties">
                            <Text size="small" weight="plus" className="mb-2 px-4 pt-2 text-xs uppercase tracking-wide text-gray-500">
                                Properties
                            </Text>
                            <div className="px-4 pb-4">
                                {design.selectedId ? (
                                    (() => {
                                        const layer = design.layers.find((l) => l.id === design.selectedId)
                                        if (!layer) return null
                                        return (
                                            <div className="rounded-2xl border border-ui-border-base bg-gray-50 p-4">
                                                <LayerProperties layer={layer} onChange={updateLayer} />
                                            </div>
                                        )
                                    })()
                                ) : (
                                    <Text size="small" className="text-xs text-gray-500">
                                        Select an element on the canvas to edit its properties.
                                    </Text>
                                )}
                            </div>
                        </section>
                        </div>
                    </div>
                )}
            </div>
        </>
    )
}