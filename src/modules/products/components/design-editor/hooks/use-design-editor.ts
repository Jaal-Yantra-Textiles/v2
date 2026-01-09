"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import Konva from "konva"
import { createDesign, CreateDesignInput } from "@lib/data/designs"
import {
    AiGenerationHistoryItem,
    BadgeCategory,
    BadgePreferences,
    CustomerInfo,
    DesignProduct,
    Partner,
    DesignLayer,
    DesignState,
    ViewState,
} from "../types"
import { useImage } from "./use-image"
import { convertToExcalidraw } from "../utils/excalidraw-converter"
import { useOnboardingState } from "./modules/use-onboarding"
import { useDesignDrafts } from "./modules/use-design-drafts"
import { useExternalResources } from "./modules/use-external-resources"
import { useDesignHistory } from "./modules/use-design-history"
import { useAiGeneration } from "./modules/use-ai-generation"

const MIN_SCALE = 0.1
const MAX_SCALE = 5
const ZOOM_STEP = 0.1
const CANVAS_EXTEND = 1500

const BADGE_FLOW_ORDER: BadgeCategory[] = [
    "style",
    "colorPalette",
    "bodyType",
    "silhouette",
    "embellishment",
    "occasion",
]

type UseDesignEditorProps = {
    product: DesignProduct
    customer?: CustomerInfo | null
    countryCode?: string
    isMobileLayout?: boolean
}

export function useDesignEditor({
    product,
    customer,
    countryCode,
    isMobileLayout = false,
}: UseDesignEditorProps) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const stageRef = useRef<Konva.Stage | null>(null)
    const fileInputRef = useRef<HTMLInputElement | null>(null)

    const [stageSize, setStageSize] = useState({ width: 1200, height: 600 })
    const [containerDims, setContainerDims] = useState({ width: 800, height: 600 })

    const [showNameModal, setShowNameModal] = useState(true)
    const [designName, setDesignName] = useState("")
    const [isSaving, setIsSaving] = useState(false)

    // Checkout modal state (shown after design is saved)
    const [showCheckoutModal, setShowCheckoutModal] = useState(false)
    const [savedDesignId, setSavedDesignId] = useState<string | null>(null)

    // Tool state
    const [activeTool, setActiveTool] = useState<"select" | "pan">("select")
    const [isPanning, setIsPanning] = useState(false)
    const [lastPointerPos, setLastPointerPos] = useState<{ x: number; y: number } | null>(null)

    // View state (zoom/pan)
    const [view, setView] = useState<ViewState>({ scale: 1, x: 0, y: 0 })

    // Sidebar + onboarding states
    const {
        sidebarExpanded,
        setSidebarExpanded,
        showOnboarding,
        onboardingSteps,
        onboardingStep,
        handleNextStep,
        handlePrevStep,
        handleSkipOnboarding,
    } = useOnboardingState({ isMobileLayout })

    const {
        selectedMaterial,
        setSelectedMaterial,
        showMaterialModal,
        setShowMaterialModal,
        externalMaterials,
        materialsLoading,
        materialsError,
        selectedPartner,
        setSelectedPartner,
        showPartnerModal,
        setShowPartnerModal,
        externalPartners,
        partnersLoading,
    } = useExternalResources()

    const [design, setDesign] = useState<DesignState>({
        name: "",
        layers: [],
        selectedId: null,
        baseImage: null,
    })

    const defaultBadgePreferences: BadgePreferences = {
        style: null,
        colorPalette: [],
        bodyType: null,
        silhouette: null,
        embellishment: null,
        occasion: [],
    }

    const [badgePreferences, setBadgePreferences] = useState<BadgePreferences>(defaultBadgePreferences)

    const { historyIndex, recordSnapshot, undo, redo } = useDesignHistory({
        design,
        setDesign,
    })

    // AI generation state - managed here so it can be shared between drafts and AI generation hooks
    const [generatedBase, setGeneratedBase] = useState<string | null>(null)
    const [aiGenerationHistory, setAiGenerationHistory] = useState<AiGenerationHistoryItem[]>([])

    const { persistDraftSnapshot, clearDraftSnapshot } = useDesignDrafts({
        product,
        design,
        setDesign,
        badgePreferences,
        defaultBadgePreferences,
        setBadgePreferences,
        selectedMaterial,
        setSelectedMaterial,
        selectedPartner,
        setSelectedPartner,
        externalMaterials,
        externalPartners,
        setDesignName,
        setShowNameModal,
        generatedBase,
        setGeneratedBase,
        aiGenerationHistory,
        setAiGenerationHistory,
    })

    // AI Generation hook - handles AI-powered base image generation
    const {
        isGeneratingAi,
        aiGenerationError,
        showLoginPrompt,
        lastAiGeneration,
        quotaRemaining,
        generationHistory,
        generateAiBase,
        dismissLoginPrompt,
        handleLoginRedirect,
        clearAiError,
        selectFromHistory,
        clearHistory,
    } = useAiGeneration({
        customer: customer ?? null,
        countryCode,
        badgePreferences,
        design,
        setDesign,
        persistDraftSnapshot,
        onBaseImageGenerated: (url: string) => {
            // Update the generated base image URL when AI generation succeeds
            setGeneratedBase(url)
        },
        initialHistory: aiGenerationHistory,
        onHistoryChange: (history) => {
            setAiGenerationHistory(history)
        },
    })
    const [isGeneratingBase, setIsGeneratingBase] = useState(false)

    const [desktopSidebarOffset, setDesktopSidebarOffset] = useState(24)

    // Load base product image
    // AI-generated base takes priority if set, otherwise fall back to product thumbnail
    const baseImageSrc = generatedBase ?? product.thumbnail ?? undefined
    const [baseImage, baseImageStatus] = useImage(baseImageSrc)

    const regenerateBaseImage = useCallback(() => {
        if (product.thumbnail) {
            // force reload by clearing generated base state
            setGeneratedBase(null)
            return
        }
        if (isGeneratingBase) return
        if (typeof window === "undefined") return

        setIsGeneratingBase(true)
        requestAnimationFrame(() => {
            try {
                const canvas = document.createElement("canvas")
                const width = 1024
                const height = 1280
                canvas.width = width
                canvas.height = height
                const ctx = canvas.getContext("2d")
                if (ctx) {
                    // background gradient
                    const gradient = ctx.createLinearGradient(0, 0, width, height)
                    gradient.addColorStop(0, "#f8fafc")
                    gradient.addColorStop(1, "#e2e8f0")
                    ctx.fillStyle = gradient
                    ctx.fillRect(0, 0, width, height)

                    // central rounded rectangle representing garment
                    const garmentWidth = width * 0.55
                    const garmentHeight = height * 0.7
                    const garmentX = (width - garmentWidth) / 2
                    const garmentY = (height - garmentHeight) / 2
                    ctx.fillStyle = "#ffffff"
                    ctx.strokeStyle = "#cbd5f5"
                    ctx.lineWidth = 4
                    const radius = 30
                    ctx.beginPath()
                    ctx.moveTo(garmentX + radius, garmentY)
                    ctx.lineTo(garmentX + garmentWidth - radius, garmentY)
                    ctx.quadraticCurveTo(garmentX + garmentWidth, garmentY, garmentX + garmentWidth, garmentY + radius)
                    ctx.lineTo(garmentX + garmentWidth, garmentY + garmentHeight - radius)
                    ctx.quadraticCurveTo(
                        garmentX + garmentWidth,
                        garmentY + garmentHeight,
                        garmentX + garmentWidth - radius,
                        garmentY + garmentHeight
                    )
                    ctx.lineTo(garmentX + radius, garmentY + garmentHeight)
                    ctx.quadraticCurveTo(
                        garmentX,
                        garmentY + garmentHeight,
                        garmentX,
                        garmentY + garmentHeight - radius
                    )
                    ctx.lineTo(garmentX, garmentY + radius)
                    ctx.quadraticCurveTo(garmentX, garmentY, garmentX + radius, garmentY)
                    ctx.closePath()
                    ctx.fill()
                    ctx.stroke()

                    // dashed centerline
                    ctx.setLineDash([15, 12])
                    ctx.lineWidth = 2
                    ctx.strokeStyle = "#94a3b8"
                    ctx.beginPath()
                    ctx.moveTo(width / 2, garmentY + 20)
                    ctx.lineTo(width / 2, garmentY + garmentHeight - 20)
                    ctx.stroke()
                }
                const dataUrl = canvas.toDataURL("image/png")
                setGeneratedBase(dataUrl)
            } finally {
                setIsGeneratingBase(false)
            }
        })
    }, [isGeneratingBase, product.thumbnail])

    useEffect(() => {
        if (!product.thumbnail && !generatedBase && !isGeneratingBase) {
            regenerateBaseImage()
        }
    }, [generatedBase, isGeneratingBase, product.thumbnail, regenerateBaseImage])

    // Update sizes on resize
    useEffect(() => {
        const updateSize = () => {
            if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect()
                const visibleWidth = rect.width
                const visibleHeight = Math.min(rect.height, window.innerHeight - 120)

                setContainerDims({ width: visibleWidth, height: visibleHeight })
                // Stage is larger to allow elements outside visible area
                setStageSize({
                    width: visibleWidth + CANVAS_EXTEND * 2,
                    height: visibleHeight + CANVAS_EXTEND * 2
                })
            }
        }

        // Small delay to ensure container is rendered
        setTimeout(updateSize, 100)
        window.addEventListener("resize", updateSize)
        return () => window.removeEventListener("resize", updateSize)
    }, [])

    // Calculate base image dimensions to fit visible container area
    const getBaseImageDimensions = useCallback(() => {
        if (!baseImage) {
            const padding = 40
            const width = Math.max(0, containerDims.width - padding * 2)
            const height = Math.max(0, containerDims.height - padding * 2)

            return {
                x: CANVAS_EXTEND + (containerDims.width - width) / 2,
                y: CANVAS_EXTEND + (containerDims.height - height) / 2,
                width,
                height,
            }
        }

        const padding = 40
        const maxWidth = containerDims.width - padding * 2
        const maxHeight = containerDims.height - padding * 2

        const scale = Math.min(maxWidth / baseImage.width, maxHeight / baseImage.height)
        const width = baseImage.width * scale
        const height = baseImage.height * scale

        // Position in center of visible area (offset by CANVAS_EXTEND)
        return {
            x: CANVAS_EXTEND + (containerDims.width - width) / 2,
            y: CANVAS_EXTEND + (containerDims.height - height) / 2,
            width,
            height,

        }
    }, [baseImage, containerDims])

    const baseDims = getBaseImageDimensions()

    useEffect(() => {
        const updateSidebarOffset = () => {
            if (window.innerWidth < 1024) {
                setDesktopSidebarOffset(24)
                return
            }
            const container = containerRef.current
            if (!container) {
                setDesktopSidebarOffset(24)
                return
            }
            const rect = container.getBoundingClientRect()
            const gap = 24
            const overlayWidth = 360
            const availableRight = window.innerWidth - rect.right - overlayWidth
            setDesktopSidebarOffset(Math.max(gap, availableRight))
        }

        updateSidebarOffset()
        window.addEventListener("resize", updateSidebarOffset)
        return () => window.removeEventListener("resize", updateSidebarOffset)
    }, [containerDims, isMobileLayout])

    // Zoom functions
    const zoomIn = useCallback(() => {
        setView(prev => ({
            ...prev,
            scale: Math.min(MAX_SCALE, prev.scale + ZOOM_STEP)
        }))
    }, [])

    const zoomOut = useCallback(() => {
        setView(prev => ({
            ...prev,
            scale: Math.max(MIN_SCALE, prev.scale - ZOOM_STEP)
        }))
    }, [])

    const resetView = useCallback(() => {
        setView({ scale: 1, x: 0, y: 0 })
    }, [])

    const zoomToFit = useCallback(() => {
        if (!baseImage) return
        const padding = 60
        const scaleX = (stageSize.width - padding) / baseImage.width
        const scaleY = (stageSize.height - padding) / baseImage.height
        const newScale = Math.min(scaleX, scaleY, 1)
        setView({ scale: newScale, x: 0, y: 0 })
    }, [baseImage, stageSize])

    // Handle wheel zoom
    const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
        e.evt.preventDefault()

        const stage = stageRef.current
        if (!stage) return

        const oldScale = view.scale
        const pointer = stage.getPointerPosition()
        if (!pointer) return

        const mousePointTo = {
            x: (pointer.x - view.x) / oldScale,
            y: (pointer.y - view.y) / oldScale,
        }

        // Zoom direction
        const direction = e.evt.deltaY > 0 ? -1 : 1
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale + direction * ZOOM_STEP))

        const newPos = {
            x: pointer.x - mousePointTo.x * newScale,
            y: pointer.y - mousePointTo.y * newScale,
        }

        setView({
            scale: newScale,
            x: newPos.x,
            y: newPos.y,
        })
    }, [view])

    // Add image layer
    const addImageLayer = (file: File) => {
        const url = URL.createObjectURL(file)
        const img = new window.Image()

        img.onload = () => {
            const baseDims = getBaseImageDimensions()
            const scale = Math.min(150 / img.width, 150 / img.height)

            const newLayer: DesignLayer = {
                id: `layer-${Date.now()}`,
                type: "image",
                x: baseDims.x + baseDims.width / 2 - (img.width * scale) / 2,
                y: baseDims.y + baseDims.height / 2 - (img.height * scale) / 2,
                width: img.width,
                height: img.height,
                rotation: 0,
                scaleX: scale,
                scaleY: scale,
                src: url,
                draggable: true,
                opacity: 1,
            }

            setDesign((prev) => ({
                ...prev,
                layers: [...prev.layers, newLayer],
                selectedId: newLayer.id,
            }))
        }

        img.src = url
    }

    // Add text layer - positioned at top of base image
    const addTextLayer = () => {
        const baseDims = getBaseImageDimensions()

        const newLayer: DesignLayer = {
            id: `layer-${Date.now()}`,
            type: "text",
            x: baseDims.x + baseDims.width / 2 - 50,
            y: baseDims.y + 40, // Position near top of base image with padding
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            text: "Your Text",
            fontSize: 32,
            fontFamily: "Arial",
            fontStyle: "normal",
            fill: "#000000",
            draggable: true,
            opacity: 1,
        }

        setDesign((prev) => ({
            ...prev,
            layers: [...prev.layers, newLayer],
            selectedId: newLayer.id,
        }))
    }

    // Update layer
    const updateLayer = (id: string, attrs: Partial<DesignLayer>) => {
        setDesign((prev) => ({
            ...prev,
            layers: prev.layers.map((layer) =>
                layer.id === id ? { ...layer, ...attrs } : layer
            ),
        }))
    }

    // Delete selected layer
    const deleteSelectedLayer = useCallback(() => {
        setDesign((prev) => {
            if (!prev.selectedId) return prev

            const nextLayers = prev.layers.filter((layer) => layer.id !== prev.selectedId)
            if (nextLayers.length === prev.layers.length) {
                return prev
            }

            const updated: DesignState = {
                ...prev,
                layers: nextLayers,
                selectedId: null,
            }
            recordSnapshot(updated)
            return updated
        })
    }, [recordSnapshot])

    // Duplicate selected layer
    const duplicateSelectedLayer = useCallback(() => {
        setDesign((prev) => {
            if (!prev.selectedId) return prev

            const layer = prev.layers.find((l) => l.id === prev.selectedId)
            if (!layer) return prev

            const newLayer: DesignLayer = {
                ...layer,
                id: `layer-${Date.now()}`,
                x: layer.x + 20,
                y: layer.y + 20,
            }

            const updated: DesignState = {
                ...prev,
                layers: [...prev.layers, newLayer],
                selectedId: newLayer.id,
            }
            recordSnapshot(updated)
            return updated
        })
    }, [recordSnapshot])

    // Move layer up/down in z-order
    const moveLayerUp = useCallback(() => {
        setDesign((prev) => {
            if (!prev.selectedId) return prev

            const index = prev.layers.findIndex((l) => l.id === prev.selectedId)
            if (index === -1 || index === prev.layers.length - 1) return prev

            const newLayers = [...prev.layers]
            ;[newLayers[index], newLayers[index + 1]] = [newLayers[index + 1], newLayers[index]]

            const updated: DesignState = { ...prev, layers: newLayers }
            recordSnapshot(updated)
            return updated
        })
    }, [recordSnapshot])

    const moveLayerDown = useCallback(() => {
        setDesign((prev) => {
            if (!prev.selectedId) return prev

            const index = prev.layers.findIndex((l) => l.id === prev.selectedId)
            if (index <= 0) return prev

            const newLayers = [...prev.layers]
            ;[newLayers[index], newLayers[index - 1]] = [newLayers[index - 1], newLayers[index]]

            const updated: DesignState = { ...prev, layers: newLayers }
            recordSnapshot(updated)
            return updated
        })
    }, [recordSnapshot])

    // Toggle layer visibility
    const toggleLayerVisibility = useCallback((layerId: string) => {
        setDesign((prev) => {
            let changed = false
            const nextLayers = prev.layers.map((layer) => {
                if (layer.id !== layerId) return layer
                changed = true
                return { ...layer, opacity: layer.opacity === 0 ? 1 : 0 }
            })

            if (!changed) return prev

            const updated: DesignState = { ...prev, layers: nextLayers }
            recordSnapshot(updated)
            return updated
        })
    }, [recordSnapshot])

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Don't trigger if typing in input
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

            if (e.key === "Delete" || e.key === "Backspace") {
                deleteSelectedLayer()
            } else if (e.key === "Escape") {
                setDesign(prev => ({ ...prev, selectedId: null }))
            } else if (e.ctrlKey || e.metaKey) {
                if (e.key === "z") {
                    e.preventDefault()
                    if (e.shiftKey) redo()
                    else undo()
                } else if (e.key === "d") {
                    e.preventDefault()
                    duplicateSelectedLayer()
                } else if (e.key === "=") {
                    e.preventDefault()
                    zoomIn()
                } else if (e.key === "-") {
                    e.preventDefault()
                    zoomOut()
                } else if (e.key === "0") {
                    e.preventDefault()
                    resetView()
                }
            } else if (e.key === "v") {
                setActiveTool("select")
            } else if (e.key === "h" || e.key === " ") {
                setActiveTool("pan")
            }
        }

        window.addEventListener("keydown", handleKeyDown)
        return () => window.removeEventListener("keydown", handleKeyDown)
    }, [deleteSelectedLayer, duplicateSelectedLayer, undo, redo, zoomIn, zoomOut, resetView])

    // Handle stage mouse down (for panning)
    const handleStageMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
        // If pan tool is active or middle mouse button
        const isMiddleButton = 'button' in e.evt && e.evt.button === 1
        if (activeTool === "pan" || isMiddleButton || e.evt.ctrlKey) {
            setIsPanning(true)
            const stage = stageRef.current
            if (stage) {
                const pos = stage.getPointerPosition()
                if (pos) setLastPointerPos(pos)
            }
            return
        }

        // Deselect on stage click
        if (e.target === e.target.getStage()) {
            setDesign((prev) => ({ ...prev, selectedId: null }))
        }
    }, [activeTool])

    const handleStageMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
        if (!isPanning || !lastPointerPos) return

        const stage = stageRef.current
        if (!stage) return

        const pos = stage.getPointerPosition()
        if (!pos) return

        const dx = pos.x - lastPointerPos.x
        const dy = pos.y - lastPointerPos.y

        setView(prev => ({
            ...prev,
            x: prev.x + dx,
            y: prev.y + dy,
        }))

        setLastPointerPos(pos)
    }, [isPanning, lastPointerPos])

    const handleStageMouseUp = useCallback(() => {
        setIsPanning(false)
        setLastPointerPos(null)
    }, [])

    // Save design
    const handleSave = async () => {
        if (!design.name) {
            setShowNameModal(true)
            return
        }

        // Check if user is logged in
        if (!customer) {
            // Save draft to local storage first
            persistDraftSnapshot()

            // Redirect to login page with return URL
            const currentPath = window.location.pathname
            const loginUrl = `/${countryCode || 'us'}/account`

            // Use setTimeout to ensure localStorage is saved before redirect
            setTimeout(() => {
                window.location.href = loginUrl
            }, 100)

            return
        }

        setIsSaving(true)
        try {
            // Try to export canvas as image (thumbnail)
            // This may fail due to CORS/tainted canvas issues with external images
            let dataUrl: string | undefined
            try {
                dataUrl = stageRef.current?.toDataURL({ pixelRatio: 2 })
            } catch (canvasError) {
                console.warn("Could not export canvas as image (tainted canvas):", canvasError)
                // Use product thumbnail as fallback
                dataUrl = product.thumbnail || undefined
            }

            // Collect inventory IDs to link
            // Priority: selected material's inventory > existing product design inventory items
            let inventoryIds: string[] = []

            if (selectedMaterial) {
                // Find the inventory item that has this raw material
                const materialWithInventory = externalMaterials.find(m => m.id === selectedMaterial.id)
                if (materialWithInventory && (materialWithInventory as any).inventory_item?.id) {
                    inventoryIds = [(materialWithInventory as any).inventory_item.id]
                }
            } else {
                // Use existing product's design inventory items
                product.designs?.forEach(d => {
                    d.inventory_items?.forEach(item => {
                        if (item.id && !inventoryIds.includes(item.id)) {
                            inventoryIds.push(item.id)
                        }
                    })
                })
            }

            // Generate Excalidraw data for designers
            const excalidrawData = convertToExcalidraw(
                design.layers,
                product.thumbnail || undefined,
                baseDims,
                design.name || product.title,
                selectedMaterial?.name || selectedMaterial?.material_type?.name,
                selectedPartner?.company_name || selectedPartner?.name
            )

            // Build design input
            const designInput: CreateDesignInput = {
                name: design.name,
                description: `Custom design for ${product.title}`,
                thumbnail_url: dataUrl,
                metadata: {
                    layers: design.layers,
                    base_product_id: product.id,
                    base_product_thumbnail: product.thumbnail || undefined,
                    customer_id: customer.id,
                    badges: badgePreferences,
                    excalidraw: excalidrawData, // Include Excalidraw data for mood board
                },
                inventory_ids: inventoryIds.length > 0 ? inventoryIds : undefined,
                partner_id: selectedPartner?.id,
                tags: ["custom", "customer-design", product.handle],
            }

            console.log("Saving design:", designInput)

            const result = await createDesign(designInput)

            // Clear any draft after successful save
            clearDraftSnapshot()

            console.log("Design saved:", result)

            // Show checkout modal instead of alert
            setSavedDesignId(result.design.id)
            setShowCheckoutModal(true)
        } catch (error) {
            console.error("Failed to save:", error)
            alert("Failed to save design. Please try again.")
        } finally {
            setIsSaving(false)
        }
    }

    // Handle name submission
    const handleNameSubmit = () => {
        if (!designName.trim()) return
        setDesign((prev) => ({ ...prev, name: designName }))
        setShowNameModal(false)
    }

    return {
        stageRef,
        containerRef,
        fileInputRef,

        stageSize,
        containerDims,
        baseImage,
        baseImageStatus,
        isGeneratingBase,
        regenerateBaseImage,
        baseDims,
        CANVAS_EXTEND,

        design,
        setDesign,
        view,
        activeTool,
        setActiveTool,
        isPanning,

        showNameModal,
        setShowNameModal,
        designName,
        setDesignName,
        isSaving,
        badgePreferences,
        setBadgePreferences,

        // Checkout modal
        showCheckoutModal,
        setShowCheckoutModal,
        savedDesignId,

        sidebarExpanded,
        setSidebarExpanded,
        showOnboarding,
        onboardingStep,
        onboardingSteps,

        selectedMaterial,
        setSelectedMaterial,
        showMaterialModal,
        setShowMaterialModal,
        externalMaterials,
        materialsLoading,
        materialsError,

        selectedPartner,
        setSelectedPartner,
        showPartnerModal,
        setShowPartnerModal,
        externalPartners,
        partnersLoading,

        historyIndex,
        desktopSidebarOffset,

        handleNextStep,
        handlePrevStep,
        handleSkipOnboarding,
        handleSave,
        handleNameSubmit,

        zoomIn,
        zoomOut,
        resetView,
        zoomToFit,

        undo,
        redo,

        handleWheel,
        handleStageMouseDown,
        handleStageMouseMove,
        handleStageMouseUp,

        addImageLayer,
        addTextLayer,
        updateLayer,
        deleteSelectedLayer,
        duplicateSelectedLayer,
        moveLayerUp,
        moveLayerDown,
        toggleLayerVisibility,

        // AI Generation
        isGeneratingAi,
        aiGenerationError,
        showLoginPrompt,
        lastAiGeneration,
        quotaRemaining,
        generationHistory,
        generateAiBase,
        dismissLoginPrompt,
        handleLoginRedirect,
        clearAiError,
        selectFromHistory,
        clearHistory,
    }
}
