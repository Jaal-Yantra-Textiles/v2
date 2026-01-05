"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import Konva from "konva"
import { listRawMaterials, RawMaterial } from "@lib/data/raw-materials"
import { listPartners, Partner as PartnerData } from "@lib/data/partners"
import { createDesign, CreateDesignInput } from "@lib/data/designs"
import { CustomerInfo, DesignProduct, Partner, DesignLayer, DesignState, ViewState } from "../types"
import { useImage } from "./use-image"
import { convertToExcalidraw } from "../utils/excalidraw-converter"

const DESIGN_DRAFT_KEY = "design_editor_draft"
const MIN_SCALE = 0.1
const MAX_SCALE = 5
const ZOOM_STEP = 0.1
const CANVAS_EXTEND = 1500
const ONBOARDING_STORAGE_KEY = "design-editor-onboarding-dismissed"

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

    // Tool state
    const [activeTool, setActiveTool] = useState<"select" | "pan">("select")
    const [isPanning, setIsPanning] = useState(false)
    const [lastPointerPos, setLastPointerPos] = useState<{ x: number; y: number } | null>(null)

    // View state (zoom/pan)
    const [view, setView] = useState<ViewState>({ scale: 1, x: 0, y: 0 })

    // History for undo/redo
    const [history, setHistory] = useState<DesignState[]>([])
    const [historyIndex, setHistoryIndex] = useState(-1)

    // Sidebar + onboarding states
    const [sidebarExpanded, setSidebarExpanded] = useState(!isMobileLayout)
    const [showOnboarding, setShowOnboarding] = useState(true)
    const [onboardingStep, setOnboardingStep] = useState(0)

    // Material detail modal state
    const [selectedMaterial, setSelectedMaterial] = useState<RawMaterial | null>(null)
    const [showMaterialModal, setShowMaterialModal] = useState(false)

    // External materials from API
    const [externalMaterials, setExternalMaterials] = useState<RawMaterial[]>([])
    const [materialsLoading, setMaterialsLoading] = useState(false)
    const [materialsError, setMaterialsError] = useState<string | null>(null)

    // Partners from API
    const [externalPartners, setExternalPartners] = useState<Partner[]>([])
    const [partnersLoading, setPartnersLoading] = useState(false)
    const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null)
    const [showPartnerModal, setShowPartnerModal] = useState(false)

    const [design, setDesign] = useState<DesignState>({
        name: "",
        layers: [],
        selectedId: null,
        baseImage: null,
    })

    const [desktopSidebarOffset, setDesktopSidebarOffset] = useState(24)

    // Load base product image
    const [baseImage, baseImageStatus] = useImage(product.thumbnail || undefined)

    useEffect(() => {
        if (isMobileLayout) {
            setSidebarExpanded(false)
        } else {
            setSidebarExpanded(true)
        }
    }, [isMobileLayout])

    useEffect(() => {
        if (typeof window === "undefined") {
            return
        }
        const hasDismissed = window.localStorage.getItem(ONBOARDING_STORAGE_KEY)
        if (hasDismissed === "true") {
            setShowOnboarding(false)
        }
    }, [])

    const onboardingSteps = [
        {
            title: "Choose your base",
            description: "Start with a silhouette from our ready-to-tailor collection to anchor your idea.",
        },
        {
            title: "Select handloom fabrics",
            description: "Browse our in-house materials sourced across India and match colors to your story.",
        },
        {
            title: "Assign a production partner",
            description: "Pick an artisan workshop from our global partner list to bring the piece to life.",
        },
    ]

    const dismissOnboarding = useCallback(() => {
        setShowOnboarding(false)
        if (typeof window !== "undefined") {
            try {
                window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true")
            } catch (error) {
                console.warn("Unable to persist onboarding dismissal", error)
            }
        }
    }, [])

    const handleNextStep = () => {
        if (onboardingStep < onboardingSteps.length - 1) {
            setOnboardingStep((prev) => prev + 1)
        } else {
            dismissOnboarding()
        }
    }

    const handlePrevStep = () => {
        setOnboardingStep((prev) => Math.max(prev - 1, 0))
    }

    const handleSkipOnboarding = useCallback(() => {
        dismissOnboarding()
    }, [dismissOnboarding])

    // Save to history when design changes
    const saveToHistory = useCallback((newDesign: DesignState) => {
        setHistory(prev => {
            const newHistory = prev.slice(0, historyIndex + 1)
            return [...newHistory, newDesign]
        })
        setHistoryIndex(prev => prev + 1)
    }, [historyIndex])

    // Undo
    const undo = useCallback(() => {
        if (historyIndex > 0) {
            setHistoryIndex(prev => prev - 1)
            setDesign(history[historyIndex - 1])
        }
    }, [history, historyIndex])

    // Redo
    const redo = useCallback(() => {
        if (historyIndex < history.length - 1) {
            setHistoryIndex(prev => prev + 1)
            setDesign(history[historyIndex + 1])
        }
    }, [history, historyIndex])

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

    // Fetch external materials from store API
    useEffect(() => {
        const fetchMaterials = async () => {
            setMaterialsLoading(true)
            setMaterialsError(null)
            try {
                const { raw_materials } = await listRawMaterials({ limit: 50 })
                setExternalMaterials(raw_materials)
            } catch (error) {
                console.error("Error fetching materials:", error)
                setMaterialsError(error instanceof Error ? error.message : "Failed to load materials")
            } finally {
                setMaterialsLoading(false)
            }
        }

        fetchMaterials()
    }, [])

    // Fetch partners from store API
    useEffect(() => {
        const fetchPartners = async () => {
            setPartnersLoading(true)
            try {
                const { partners } = await listPartners({ limit: 20 })
                setExternalPartners(partners as Partner[])
            } catch (error) {
                console.error("Error fetching partners:", error)
            } finally {
                setPartnersLoading(false)
            }
        }

        fetchPartners()
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
        if (!design.selectedId) return

        const newDesign = {
            ...design,
            layers: design.layers.filter((layer) => layer.id !== design.selectedId),
            selectedId: null,
        }
        setDesign(newDesign)
        saveToHistory(newDesign)
    }, [design, saveToHistory])

    // Duplicate selected layer
    const duplicateSelectedLayer = useCallback(() => {
        if (!design.selectedId) return

        const layer = design.layers.find(l => l.id === design.selectedId)
        if (!layer) return

        const newLayer: DesignLayer = {
            ...layer,
            id: `layer-${Date.now()}`,
            x: layer.x + 20,
            y: layer.y + 20,
        }

        const newDesign = {
            ...design,
            layers: [...design.layers, newLayer],
            selectedId: newLayer.id,
        }
        setDesign(newDesign)
        saveToHistory(newDesign)
    }, [design, saveToHistory])

    // Move layer up/down in z-order
    const moveLayerUp = useCallback(() => {
        if (!design.selectedId) return

        const index = design.layers.findIndex(l => l.id === design.selectedId)
        if (index === design.layers.length - 1) return

        const newLayers = [...design.layers]
            ;[newLayers[index], newLayers[index + 1]] = [newLayers[index + 1], newLayers[index]]

        setDesign(prev => ({ ...prev, layers: newLayers }))
    }, [design])

    const moveLayerDown = useCallback(() => {
        if (!design.selectedId) return

        const index = design.layers.findIndex(l => l.id === design.selectedId)
        if (index === 0) return

        const newLayers = [...design.layers]
            ;[newLayers[index], newLayers[index - 1]] = [newLayers[index - 1], newLayers[index]]

        setDesign(prev => ({ ...prev, layers: newLayers }))
    }, [design])

    // Toggle layer visibility
    const toggleLayerVisibility = useCallback((layerId: string) => {
        setDesign(prev => ({
            ...prev,
            layers: prev.layers.map(l =>
                l.id === layerId ? { ...l, opacity: l.opacity === 0 ? 1 : 0 } : l
            )
        }))
    }, [])

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

    // Save design draft to local storage
    const saveDraftToLocalStorage = useCallback(() => {
        const draft = {
            productId: product.id,
            productHandle: product.handle,
            name: design.name,
            layers: design.layers,
            selectedMaterialId: selectedMaterial?.id,
            selectedPartnerId: selectedPartner?.id,
            savedAt: new Date().toISOString(),
        }
        localStorage.setItem(DESIGN_DRAFT_KEY, JSON.stringify(draft))
        return draft
    }, [product.id, product.handle, design.name, design.layers, selectedMaterial?.id, selectedPartner?.id])

    // Load design draft from local storage
    const loadDraftFromLocalStorage = useCallback(() => {
        try {
            const draftStr = localStorage.getItem(DESIGN_DRAFT_KEY)
            if (!draftStr) return null

            const draft = JSON.parse(draftStr)
            // Only load if it's for the same product
            if (draft.productId === product.id) {
                return draft
            }
            return null
        } catch {
            return null
        }
    }, [product.id])

    // Clear draft from local storage
    const clearDraftFromLocalStorage = useCallback(() => {
        localStorage.removeItem(DESIGN_DRAFT_KEY)
    }, [])

    // Load draft on mount if user is logged in and has a draft
    useEffect(() => {
        if (customer) {
            const draft = loadDraftFromLocalStorage()
            if (draft && draft.layers?.length > 0) {
                // Ask user if they want to restore the draft
                const restore = window.confirm(
                    `You have an unsaved design draft from ${new Date(draft.savedAt).toLocaleString()}. Would you like to restore it?`
                )
                if (restore) {
                    setDesign(prev => ({
                        ...prev,
                        name: draft.name || prev.name,
                        layers: draft.layers || [],
                    }))
                    setDesignName(draft.name || "")
                    if (draft.name) {
                        setShowNameModal(false)
                    }
                    // Clear the draft after restoring
                    clearDraftFromLocalStorage()
                } else {
                    clearDraftFromLocalStorage()
                }
            }
        }
    }, [customer, loadDraftFromLocalStorage, clearDraftFromLocalStorage])

    // Save design
    const handleSave = async () => {
        if (!design.name) {
            setShowNameModal(true)
            return
        }

        // Check if user is logged in
        if (!customer) {
            // Save draft to local storage first
            saveDraftToLocalStorage()

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
                    excalidraw: excalidrawData, // Include Excalidraw data for mood board
                },
                inventory_ids: inventoryIds.length > 0 ? inventoryIds : undefined,
                partner_id: selectedPartner?.id,
                tags: ["custom", "customer-design", product.handle],
            }

            console.log("Saving design:", designInput)

            const result = await createDesign(designInput)

            // Clear any draft after successful save
            clearDraftFromLocalStorage()

            console.log("Design saved:", result)
            alert(`Design "${design.name}" saved successfully!`)
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
    }
}
