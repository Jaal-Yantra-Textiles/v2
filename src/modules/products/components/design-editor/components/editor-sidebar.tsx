"use client"

import clsx from "clsx"
import React, { useEffect, useMemo, useCallback } from "react"
import { Text, Tooltip, TooltipProvider } from "@medusajs/ui"
import {
    Plus,
    ArrowsPointingOutMini,
    XMark,
    Sparkles,
    ArrowUturnLeft,
} from "@medusajs/icons"
import {
    AiGenerationHistoryItem,
    BadgeCategory,
    BadgeOption,
    BadgePreferences,
    DesignLayer,
    DesignState,
    DesignProduct,
    MultiBadgeCategory,
    SingleBadgeCategory,
} from "../types"
import { LayerProperties } from "./layer-properties"
import OnboardingOverlay from "./onboarding-overlay"
import { RawMaterial } from "@lib/data/raw-materials"

const badgeSections: Array<{
    key: BadgeCategory
    title: string
    description: string
}> = [
    {
        key: "style",
        title: "Style DNA",
        description: "Pick the aesthetic closest to your idea.",
    },
    {
        key: "colorPalette",
        title: "Color Direction",
        description: "Select the hues you’d like to explore.",
    },
    {
        key: "bodyType",
        title: "Body Type",
        description: "Helps us tailor silhouettes to fit best.",
    },
    {
        key: "silhouette",
        title: "Silhouette Focus",
        description: "Overall shape or drape inspiration.",
    },
    {
        key: "embellishment",
        title: "Embellishment",
        description: "Preferred level of detail or texture.",
    },
    {
        key: "occasion",
        title: "Occasion",
        description: "Where will this piece be worn?",
    },
]

const BADGE_OPTIONS: Record<BadgeCategory, BadgeOption[]> = {
    style: [
        { label: "Minimal", value: "minimal" },
        { label: "Boho", value: "boho" },
        { label: "Avant-garde", value: "avant_garde" },
        { label: "Classic", value: "classic" },
        { label: "Streetwear", value: "streetwear" },
    ],
    colorPalette: [
        { label: "Monochrome", value: "mono", swatch: "#0f172a" },
        { label: "Earth", value: "earth", swatch: "#9a6b4f" },
        { label: "Pastels", value: "pastel", swatch: "#f5cde0" },
        { label: "Bold Pop", value: "bold", swatch: "#f97316" },
        { label: "Neutrals", value: "neutral", swatch: "#d4d4d8" },
    ],
    bodyType: [
        { label: "Petite", value: "petite" },
        { label: "Tall", value: "tall" },
        { label: "Curvy", value: "curvy" },
        { label: "Athletic", value: "athletic" },
    ],
    silhouette: [
        { label: "A-line", value: "aline" },
        { label: "Column", value: "column" },
        { label: "Oversized", value: "oversized" },
        { label: "Structured", value: "structured" },
    ],
    embellishment: [
        { label: "Clean", value: "clean", helper: "Little-to-no detail" },
        { label: "Balanced", value: "balanced", helper: "Select accents" },
        { label: "Maximal", value: "maximal", helper: "Statement flourishes" },
    ],
    occasion: [
        { label: "Daily", value: "daily" },
        { label: "Workwear", value: "work" },
        { label: "Celebration", value: "celebration" },
        { label: "Wedding", value: "wedding" },
        { label: "Resort", value: "resort" },
    ],
}

const multiSelectCategories: MultiBadgeCategory[] = ["colorPalette", "occasion"]

type EditorSidebarProps = {
    isMobileLayout: boolean
    sidebarExpanded: boolean
    setSidebarExpanded: React.Dispatch<React.SetStateAction<boolean>>
    product: DesignProduct
    design: DesignState
    setDesign: React.Dispatch<React.SetStateAction<DesignState>>
    badgePreferences: BadgePreferences
    onEditPreferences: () => void
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
    // Undo support
    undo?: () => void
    historyIndex?: number
    // AI Generation props
    isGeneratingAi?: boolean
    aiGenerationError?: string | null
    quotaRemaining?: number | null
    generationHistory?: AiGenerationHistoryItem[]
    onGenerateAi?: () => void
    onClearAiError?: () => void
    onSelectFromHistory?: (item: AiGenerationHistoryItem) => void
    onClearHistory?: () => void
    onTryOn?: () => void
}

type SectionKey = "product" | "tools" | "aiGeneration" | "add" | "materials" | "partners" | "layers" | "properties"
const sectionOrder: SectionKey[] = ["product", "tools", "aiGeneration", "add", "materials", "partners", "layers", "properties"]
const sectionLabels: Record<SectionKey, string> = {
    product: "Product Info",
    tools: "Canvas Tools",
    aiGeneration: "AI Generation",
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
    badgePreferences,
    onEditPreferences,
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
    // Undo
    undo,
    historyIndex = 0,
    // AI Generation
    isGeneratingAi,
    aiGenerationError,
    quotaRemaining,
    generationHistory = [],
    onGenerateAi,
    onClearAiError,
    onSelectFromHistory,
    onClearHistory,
    onTryOn,
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

    const normalizedBadges = React.useMemo<BadgePreferences>(
        () => ({
            style: badgePreferences?.style ?? null,
            colorPalette: Array.isArray(badgePreferences?.colorPalette)
                ? badgePreferences!.colorPalette.filter(Boolean)
                : [],
            bodyType: badgePreferences?.bodyType ?? null,
            silhouette: badgePreferences?.silhouette ?? null,
            embellishment: badgePreferences?.embellishment ?? null,
            occasion: Array.isArray(badgePreferences?.occasion)
                ? badgePreferences!.occasion.filter(Boolean)
                : [],
        }),
        [badgePreferences]
    )

    const preferenceItems = React.useMemo(
        () => [
            { label: "Style", values: normalizedBadges.style ? [normalizedBadges.style] : [] },
            { label: "Body", values: normalizedBadges.bodyType ? [normalizedBadges.bodyType] : [] },
            { label: "Silhouette", values: normalizedBadges.silhouette ? [normalizedBadges.silhouette] : [] },
            { label: "Embellishment", values: normalizedBadges.embellishment ? [normalizedBadges.embellishment] : [] },
            {
                label: "Colors",
                values: normalizedBadges.colorPalette,
            },
            {
                label: "Occasion",
                values: normalizedBadges.occasion,
            },
        ],
        [normalizedBadges]
    )

    const hasPreferences = preferenceItems.some((item) => item.values.length > 0)

    const PreferenceSummaryCard = ({ className }: { className?: string }) => (
        <div
            className={clsx(
                "rounded-md border border-neutral-200 bg-white/90 p-4 shadow-sm backdrop-blur",
                className
            )}
        >
            <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                    <Text weight="plus" size="small" className="text-gray-900">
                        Design profile
                    </Text>
                    <Text size="small" className="text-xs text-gray-500">
                        Guides cost estimates &amp; AI base generation.
                    </Text>
                </div>
                <button
                    type="button"
                    onClick={onEditPreferences}
                    className="rounded-full bg-gray-900 px-3 py-1 text-[11px] font-semibold text-white shadow hover:bg-black"
                >
                    Edit
                </button>
            </div>
            {hasPreferences ? (
                <div className="space-y-3">
                    {preferenceItems
                        .filter((item) => item.values.length > 0)
                        .map((item) => (
                            <div key={item.label}>
                                <Text size="small" className="text-[11px] uppercase tracking-wide text-gray-400">
                                    {item.label}
                                </Text>
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                    {item.values.map((value) => (
                                        <span
                                            key={`${item.label}-${value}`}
                                            className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 shadow-sm"
                                        >
                                            {value}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}
                </div>
            ) : (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3 text-center">
                    <Text size="small" className="text-xs text-gray-500">
                        No preferences yet. Add them to improve estimates.
                    </Text>
                </div>
            )}
        </div>
    )

    const productDescriptionSnippet = React.useMemo(() => {
        if (!product.description) return null
        const trimmed = product.description.trim()
        if (!trimmed) return null
        const sentenceEnd = trimmed.indexOf(".")
        if (sentenceEnd === -1) return trimmed
        return `${trimmed.slice(0, sentenceEnd + 1)}`
    }, [product.description])

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

                {/* Compact mobile header with product info and preferences */}
                <div className="px-3 py-2 flex items-center gap-3 bg-white/80 backdrop-blur-sm border-b border-neutral-200">
                    {/* Product thumbnail */}
                    {product.thumbnail && (
                        <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 border border-gray-200">
                            <img src={product.thumbnail} alt={product.title} className="w-full h-full object-cover" />
                        </div>
                    )}
                    {/* Product info */}
                    <div className="flex-1 min-w-0">
                        <Text weight="plus" size="small" className="text-gray-900 truncate">
                            {product.title}
                        </Text>
                        <Text size="small" className="text-gray-500 text-xs truncate">
                            {design.name || "Untitled Design"}
                        </Text>
                    </div>
                    {/* Edit preferences button */}
                    <button
                        type="button"
                        onClick={onEditPreferences}
                        className="px-3 py-1.5 rounded-full bg-gray-100 text-xs font-medium text-gray-700 hover:bg-gray-200 flex-shrink-0"
                    >
                        Preferences
                    </button>
                </div>

                {/* Mobile Active Tab Overlay (Sheet) */}
                {mobileActiveTab && (
                    <div className="fixed bottom-[60px] left-0 right-0 z-20 mx-2 mb-2 max-h-[50vh] overflow-y-auto rounded-xl border border-neutral-200 bg-white/95 p-4 shadow-2xl backdrop-blur transition-all animate-in slide-in-from-bottom-5">
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
                                    className="flex items-center gap-3 rounded-md bg-neutral-50 p-3 hover:bg-neutral-100"
                                >
                                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-neutral-900">
                                        <Plus />
                                    </div>
                                    <Text>Upload Image</Text>
                                </button>
                                <button
                                    onClick={() => {
                                        addTextLayer()
                                        setMobileActiveTab(null)
                                    }}
                                    className="flex items-center gap-3 rounded-md bg-neutral-50 p-3 hover:bg-neutral-100"
                                >
                                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-neutral-900">
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
                                            className={`aspect-square rounded-md overflow-hidden border-2 relative ${selectedMaterial?.id === material.id ? 'border-neutral-900' : 'border-transparent'
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

                        {mobileActiveTab === "ai" && (
                            <div className="space-y-3">
                                <button
                                    onClick={() => {
                                        onGenerateAi?.()
                                        setMobileActiveTab(null)
                                    }}
                                    disabled={isGeneratingAi || !onGenerateAi}
                                    className={clsx(
                                        "w-full rounded-xl px-4 py-3 text-sm font-medium transition-all flex items-center justify-center gap-2",
                                        isGeneratingAi
                                            ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                                            : "bg-gradient-to-r from-violet-600 to-indigo-600 text-white"
                                    )}
                                >
                                    {isGeneratingAi ? (
                                        <>
                                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                            </svg>
                                            Generating...
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles className="h-4 w-4" />
                                            Generate with AI
                                        </>
                                    )}
                                </button>
                                {quotaRemaining !== null && quotaRemaining !== undefined && (
                                    <Text size="small" className="text-xs text-gray-500 text-center">
                                        {quotaRemaining} generations remaining
                                    </Text>
                                )}
                                {aiGenerationError && (
                                    <div className="rounded-lg bg-red-50 p-2">
                                        <Text size="small" className="text-xs text-red-600">{aiGenerationError}</Text>
                                    </div>
                                )}

                                {/* Mobile Generation History */}
                                {generationHistory.length > 0 && (
                                    <div className="mt-3 pt-3 border-t border-gray-100">
                                        <div className="flex items-center justify-between mb-2">
                                            <Text size="small" className="text-[11px] uppercase tracking-wide text-gray-400">
                                                Previous
                                            </Text>
                                            {onClearHistory && (
                                                <button
                                                    onClick={onClearHistory}
                                                    className="text-[10px] text-gray-400 hover:text-red-500"
                                                >
                                                    Clear
                                                </button>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-4 gap-2">
                                            {generationHistory.slice(0, 4).map((item) => (
                                                <button
                                                    key={item.id}
                                                    onClick={() => {
                                                        onSelectFromHistory?.(item)
                                                        setMobileActiveTab(null)
                                                    }}
                                                    className="aspect-square rounded-md overflow-hidden border-2 border-transparent hover:border-neutral-400 bg-gray-50"
                                                >
                                                    <img
                                                        src={item.preview_url}
                                                        alt="AI Generated"
                                                        className="w-full h-full object-cover"
                                                    />
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Bottom Toolbar
                    Layout: [left-half: Undo + AI] [Plus, truly centred] [right-half: Edit + Save]
                    Two equal flex-1 halves flank the Plus so it lands on the exact screen centre. */}
                <div className="fixed bottom-0 left-0 right-0 z-30 flex h-[60px] items-center border-t border-neutral-200 bg-white shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
                    {/* Left half */}
                    <div className="flex flex-1 items-center justify-around">
                        <button
                            onClick={undo}
                            disabled={!undo || historyIndex <= 0}
                            className={`flex flex-col items-center gap-0.5 px-3 py-2 ${historyIndex <= 0 ? "text-gray-300" : "text-gray-500"}`}
                        >
                            <ArrowUturnLeft className="h-5 w-5" />
                            <span className="text-[10px] font-medium">Undo</span>
                        </button>
                        <button
                            onClick={() => toggleMobileTab("ai")}
                            className={`flex flex-col items-center gap-0.5 px-3 py-2 ${mobileActiveTab === "ai" ? "text-neutral-900" : "text-gray-500"}`}
                        >
                            <Sparkles className="h-5 w-5" />
                            <span className="text-[10px] font-medium">AI</span>
                        </button>
                    </div>

                    {/* Centre — raised Add button */}
                    <button
                        onClick={() => toggleMobileTab("add")}
                        className="flex h-12 w-12 -translate-y-3 items-center justify-center rounded-full bg-black text-white shadow-lg transition-transform active:scale-95 flex-shrink-0"
                    >
                        <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                            <path d="M12 5v14M5 12h14" />
                        </svg>
                    </button>

                    {/* Right half */}
                    <div className="flex flex-1 items-center justify-around">
                        <button
                            onClick={() => toggleMobileTab("layers")}
                            className={`flex flex-col items-center gap-0.5 px-3 py-2 ${mobileActiveTab === "layers" ? "text-neutral-900" : "text-gray-500"}`}
                        >
                            <ArrowsPointingOutMini className="h-5 w-5" />
                            <span className="text-[10px] font-medium">Edit</span>
                        </button>
                        {onTryOn && (
                            <button
                                onClick={onTryOn}
                                className="flex flex-col items-center gap-0.5 px-3 py-2 text-gray-500"
                            >
                                <Sparkles className="h-5 w-5" />
                                <span className="text-[10px] font-medium">Try On</span>
                            </button>
                        )}
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className={`flex flex-col items-center gap-0.5 px-3 py-2 ${isSaving ? "text-gray-300" : "text-gray-500"}`}
                        >
                            <div className="h-5 w-5 flex items-center justify-center">
                                {isSaving ? (
                                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                ) : (
                                    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M4 13v3h12v-3M10 3v9m-3-3 3 3 3-3" />
                                    </svg>
                                )}
                            </div>
                            <span className="text-[10px] font-medium">{isSaving ? "Saving…" : "Save"}</span>
                        </button>
                    </div>
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
                className="relative flex h-full flex-1 overflow-hidden rounded-xl border border-neutral-200 bg-white/95 shadow-2xl backdrop-blur transition-all duration-300"
                style={{
                    transform: "translate3d(0, 0, 0)",
                    WebkitTransform: "translate3d(0, 0, 0)",
                    willChange: "transform",
                    isolation: "isolate",
                    WebkitBackdropFilter: "blur(12px)",
                    backdropFilter: "blur(12px)",
                }}
            >
                <div className="flex h-full w-full flex-col">
                    <div className="flex flex-shrink-0 items-center justify-between border-b px-4 py-3 bg-white/95 backdrop-blur-sm">
                        <div className="flex items-center gap-2 flex-1">
                            {activeSection !== "product" && (
                                <button
                                    onClick={() => scrollToSection("product")}
                                    className="flex items-center justify-center h-7 w-7 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700 transition-colors"
                                    title="Back to top"
                                >
                                    <ArrowUturnLeft className="h-3.5 w-3.5" />
                                </button>
                            )}
                            <div>
                                <Text weight="plus" size="small" className="text-gray-900">
                                    {sectionLabels[activeSection]}
                                </Text>
                                <Text size="small" className="text-xs text-gray-400">
                                    Design Tools
                                </Text>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleSave}
                                disabled={isSaving}
                                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${isSaving
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

                    {sidebarExpanded ? (
                        <div className="flex flex-1 flex-col overflow-hidden">
                            {(selectedMaterial || selectedPartner) && (
                                <div className="flex-shrink-0 border-b border-neutral-200 bg-white px-4 py-3">
                                    <div className="flex flex-col gap-2">
                                        {selectedMaterial && (
                                            <div className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 bg-neutral-50/70 px-3 py-2">
                                                <div className="min-w-0">
                                                    <Text weight="plus" size="small" className="truncate text-neutral-900">
                                                        {selectedMaterial.name || selectedMaterial.material_type?.name || "Selected material"}
                                                    </Text>
                                                    <Text size="small" className="text-[11px] text-neutral-700">
                                                        {selectedMaterial.material_type?.category || "Material selection"}
                                                    </Text>
                                                </div>
                                                <button
                                                    onClick={() => setSelectedMaterial(null)}
                                                    className="text-neutral-400 hover:text-neutral-700"
                                                    aria-label="Clear material selection"
                                                >
                                                    <XMark className="h-4 w-4" />
                                                </button>
                                            </div>
                                        )}
                                        {selectedPartner && (
                                            <div className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
                                                <div className="min-w-0">
                                                    <Text weight="plus" size="small" className="truncate text-neutral-900">
                                                        {selectedPartner.company_name || selectedPartner.name || "Selected partner"}
                                                    </Text>
                                                    <Text size="small" className="text-[11px] text-neutral-600">
                                                        {selectedPartner.location || "Production partner"}
                                                    </Text>
                                                </div>
                                                <button
                                                    onClick={() => setSelectedPartner(null)}
                                                    className="text-neutral-400 hover:text-neutral-700"
                                                    aria-label="Clear partner selection"
                                                >
                                                    <XMark className="h-4 w-4" />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div
                                ref={scrollContainerRef}
                                className="flex-1 overflow-y-auto px-1"
                                data-lenis-prevent
                                style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}
                            >
                                <div className="space-y-6 pb-8">
                                    {/* Product / Design Profile Section */}
                                    <section ref={sectionRefs.product} data-section-id="product">
                                        <div className="px-4 pt-4 space-y-3">
                                            <div className="rounded-md border border-neutral-200 bg-white/95 p-4 shadow-sm">
                                                <Text size="small" className="text-[11px] uppercase tracking-wide text-gray-400">
                                                    Base product
                                                </Text>
                                                <Text weight="plus" className="text-gray-900">
                                                    {product.title}
                                                </Text>
                                                {productDescriptionSnippet && (
                                                    <Text size="small" className="mt-1 text-gray-600 line-clamp-2">
                                                        {productDescriptionSnippet}
                                                    </Text>
                                                )}
                                            </div>
                                            <PreferenceSummaryCard />
                                        </div>
                                    </section>

                                    {/* Tools Section */}
                                    <section ref={sectionRefs.tools} data-section-id="tools">
                                        <Text size="small" weight="plus" className="mb-2 px-4 text-xs uppercase tracking-wide text-gray-500">
                                            Canvas Tools
                                        </Text>
                                        <div className="px-4">
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => setActiveTool("select")}
                                                    className={clsx(
                                                        "flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-colors",
                                                        activeTool === "select"
                                                            ? "border-black bg-black text-white"
                                                            : "border-neutral-200 bg-gray-50 hover:bg-gray-100"
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
                                                            : "border-neutral-200 bg-gray-50 hover:bg-gray-100"
                                                    )}
                                                >
                                                    Pan
                                                </button>
                                            </div>
                                        </div>
                                    </section>

                                    {/* AI Generation Section */}
                                    <section ref={sectionRefs.aiGeneration} data-section-id="aiGeneration">
                                        <Text size="small" weight="plus" className="mb-2 px-4 pt-2 text-xs uppercase tracking-wide text-gray-500">
                                            AI Generation
                                        </Text>
                                        <div className="px-4 pb-4 space-y-3">
                                            <button
                                                onClick={onGenerateAi}
                                                disabled={isGeneratingAi || !onGenerateAi}
                                                className={clsx(
                                                    "w-full rounded-md px-4 py-3 text-sm font-medium transition-all flex items-center justify-center gap-2",
                                                    isGeneratingAi
                                                        ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                                                        : "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg hover:from-violet-700 hover:to-indigo-700 hover:shadow-xl"
                                                )}
                                            >
                                                {isGeneratingAi ? (
                                                    <>
                                                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                                        </svg>
                                                        Generating...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Sparkles className="h-4 w-4" />
                                                        Generate with AI
                                                    </>
                                                )}
                                            </button>

                                            {/* Quota display */}
                                            {quotaRemaining !== null && quotaRemaining !== undefined && (
                                                <div className="flex items-center justify-center">
                                                    <Text size="small" className="text-xs text-gray-500">
                                                        {quotaRemaining} generations remaining today
                                                    </Text>
                                                </div>
                                            )}

                                            {/* Error display */}
                                            {aiGenerationError && (
                                                <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                                                    <div className="flex items-start justify-between gap-2">
                                                        <Text size="small" className="text-xs text-red-600">
                                                            {aiGenerationError}
                                                        </Text>
                                                        {onClearAiError && (
                                                            <button
                                                                onClick={onClearAiError}
                                                                className="text-red-400 hover:text-red-600"
                                                            >
                                                                <XMark className="h-3 w-3" />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Help text */}
                                            <Text size="small" className="text-[11px] text-gray-400 text-center">
                                                Uses your style preferences to generate a unique design base
                                            </Text>

                                            {/* Generation History */}
                                            {generationHistory.length > 0 && (
                                                <div className="mt-4 pt-4 border-t border-gray-100">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <Text size="small" className="text-[11px] uppercase tracking-wide text-gray-400">
                                                            Previous Generations
                                                        </Text>
                                                        {onClearHistory && (
                                                            <button
                                                                onClick={onClearHistory}
                                                                className="text-[10px] text-gray-400 hover:text-red-500 transition-colors"
                                                            >
                                                                Clear all
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="grid grid-cols-3 gap-2">
                                                        {generationHistory.map((item) => (
                                                            <button
                                                                key={item.id}
                                                                onClick={() => onSelectFromHistory?.(item)}
                                                                className="group relative aspect-square rounded-md overflow-hidden border-2 border-transparent hover:border-neutral-400 transition-all bg-gray-50"
                                                                title={`Generated: ${new Date(item.generated_at).toLocaleString()}`}
                                                            >
                                                                <img
                                                                    src={item.preview_url}
                                                                    alt="AI Generated"
                                                                    className="w-full h-full object-cover"
                                                                />
                                                                <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                                                <div className="absolute bottom-1 left-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                    <Text size="small" className="text-[9px] text-white truncate">
                                                                        {new Date(item.generated_at).toLocaleDateString()}
                                                                    </Text>
                                                                </div>
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
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
                                                className="rounded-md border border-neutral-200 bg-white px-4 py-3 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
                                            >
                                                + Image
                                            </button>
                                            <button
                                                onClick={addTextLayer}
                                                className="rounded-md border border-neutral-200 bg-white px-4 py-3 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
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
                                                                            "relative aspect-square rounded-md border-2 transition-all",
                                                                            isSelected
                                                                                ? "border-neutral-900 ring-1 ring-neutral-200"
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
                                                <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
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
                                                                            "relative rounded-md border-2 p-3 text-left transition-all",
                                                                            isSelected
                                                                                ? "border-neutral-900 bg-neutral-50 ring-1 ring-neutral-200"
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
                                                <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
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
                                                                    ? "border-neutral-900 bg-neutral-50"
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
                                                        <div className="rounded-md border border-neutral-200 bg-gray-50 p-4">
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
                        </div>
                    ) : (
                        <div className="flex flex-1 items-center justify-center px-4 text-center">
                            <Text size="small" className="text-xs text-gray-500">
                                Sidebar collapsed. Expand to view design tools.
                            </Text>
                        </div>
                    )}
                </div>
            </div>
        </>
    )
}