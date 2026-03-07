"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import Konva from "konva"
import { createDesign, updateDesign, CreateDesignInput } from "@lib/data/designs"
import { presignDesignImageUpload } from "@lib/data/uploads"
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
    const [showTryOnModal, setShowTryOnModal] = useState(false)
    const [showAiPaymentModal, setShowAiPaymentModal] = useState(false)
    const [aiFeaturesPaid, setAiFeaturesPaid] = useState(customer?.aiFeaturesPaid ?? false)
    const [savedDesignId, setSavedDesignId] = useState<string | null>(null)
    const [saveError, setSaveError] = useState<string | null>(null)
    const clearSaveError = useCallback(() => setSaveError(null), [])

    const handleAiPaymentSuccess = useCallback(() => {
        setAiFeaturesPaid(true)
        setShowAiPaymentModal(false)
    }, [])

    // Tool state
    const [activeTool, setActiveTool] = useState<"select" | "pan">("select")
    const [isPanning, setIsPanning] = useState(false)
    const [lastPointerPos, setLastPointerPos] = useState<{ x: number; y: number } | null>(null)
    // On mobile, track travel distance so a short tap on empty canvas deselects instead of panning
    const mobileTouchStartOnEmptyRef = useRef(false)
    const mobileTouchTravelRef = useRef(0)

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

    const { historyIndex, canRedo, recordSnapshot, undo, redo } = useDesignHistory({
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
        onPaymentRequired: () => {
            setShowAiPaymentModal(true)
        },
    })
    const [isGeneratingBase, setIsGeneratingBase] = useState(false)
    const [showPrintZone, setShowPrintZone] = useState(false)
    const togglePrintZone = useCallback(() => setShowPrintZone(p => !p), [])

    const [desktopSidebarOffset, setDesktopSidebarOffset] = useState(24)

    // Load base product image
    // AI-generated base takes priority if set, otherwise fall back to product thumbnail
    const baseImageSrc = generatedBase ?? product.thumbnail ?? undefined
    const [baseImage, baseImageStatus] = useImage(baseImageSrc)

    const regenerateBaseImage = useCallback(() => {
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
                    const W = width, H = height, cx = W / 2

                    // ── Background ──────────────────────────────────────────
                    const bg = ctx.createLinearGradient(0, 0, W, H)
                    bg.addColorStop(0, "#f7f8fa")
                    bg.addColorStop(1, "#eceef2")
                    ctx.fillStyle = bg
                    ctx.fillRect(0, 0, W, H)

                    // Subtle dot grid
                    ctx.fillStyle = "rgba(0,0,0,0.035)"
                    for (let gx = 48; gx < W; gx += 48) {
                        for (let gy = 48; gy < H; gy += 48) {
                            ctx.beginPath()
                            ctx.arc(gx, gy, 1.8, 0, Math.PI * 2)
                            ctx.fill()
                        }
                    }

                    // ── Key anchor points (sleeveless shift dress) ───────────
                    // Neckline
                    const neckBtm  = { x: cx,       y: 268 }  // scoop bottom
                    const neckL    = { x: 433,       y: 200 }  // left neckline edge
                    const neckR    = { x: 591,       y: 200 }  // right neckline edge
                    // Shoulders
                    const shldL    = { x: 388,       y: 226 }  // left shoulder point
                    const shldR    = { x: 636,       y: 226 }  // right shoulder point
                    // Armholes (sleeveless — curves inward from shoulder to chest)
                    const armholeL = { x: 408,       y: 390 }
                    const armholeR = { x: 616,       y: 390 }
                    // Body
                    const waistL   = { x: 410,       y: 625 }
                    const waistR   = { x: 614,       y: 625 }
                    const hipL     = { x: 386,       y: 790 }
                    const hipR     = { x: 638,       y: 790 }
                    const hemL     = { x: 362,       y: 1018 }
                    const hemR     = { x: 662,       y: 1018 }

                    // ── Faint body silhouette behind dress ───────────────────
                    // Very subtle hourglass hint so the garment reads as "worn"
                    ctx.save()
                    ctx.globalAlpha = 0.055
                    ctx.fillStyle = "#8896b0"
                    // neck column
                    ctx.beginPath()
                    ctx.ellipse(cx, 138, 38, 52, 0, 0, Math.PI * 2)
                    ctx.fill()
                    // torso
                    ctx.beginPath()
                    ctx.moveTo(cx - 200, 210)
                    ctx.bezierCurveTo(cx - 240, 350, cx - 180, 560, cx - 195, 800)
                    ctx.bezierCurveTo(cx - 195, 860, cx - 230, 920, cx - 220, 1060)
                    ctx.lineTo(cx + 220, 1060)
                    ctx.bezierCurveTo(cx + 230, 920, cx + 195, 860, cx + 195, 800)
                    ctx.bezierCurveTo(cx + 180, 560, cx + 240, 350, cx + 200, 210)
                    ctx.closePath()
                    ctx.fill()
                    ctx.restore()

                    // ── Garment flat outline ─────────────────────────────────
                    ctx.save()
                    ctx.strokeStyle = "#1e2235"
                    ctx.lineWidth = 2.8
                    ctx.lineJoin = "round"
                    ctx.lineCap = "round"

                    ctx.beginPath()
                    // Start bottom of neckline scoop, go clockwise
                    ctx.moveTo(neckBtm.x, neckBtm.y)
                    // Right neckline → neckR
                    ctx.bezierCurveTo(cx + 52, neckBtm.y - 18, neckR.x - 18, neckR.y + 28, neckR.x, neckR.y)
                    // neckR → right shoulder
                    ctx.lineTo(shldR.x, shldR.y)
                    // Right armhole: shoulder → curves down-in to armhole bottom
                    ctx.bezierCurveTo(shldR.x + 22, shldR.y + 48, armholeR.x + 32, armholeR.y - 52, armholeR.x, armholeR.y)
                    // Right side seam: armhole → waist → hip → hem
                    ctx.bezierCurveTo(armholeR.x + 8,  armholeR.y + 80, waistR.x + 12, waistR.y - 80, waistR.x, waistR.y)
                    ctx.bezierCurveTo(waistR.x,        waistR.y + 65,   hipR.x - 4,   hipR.y - 65,   hipR.x, hipR.y)
                    ctx.bezierCurveTo(hipR.x + 6,      hipR.y + 72,     hemR.x + 4,   hemR.y - 48,   hemR.x, hemR.y)
                    // Hem (straight across)
                    ctx.lineTo(hemL.x, hemL.y)
                    // Left side seam: hem → hip → waist → armhole
                    ctx.bezierCurveTo(hemL.x - 4,      hemL.y - 48,     hipL.x - 6,   hipL.y + 72,   hipL.x, hipL.y)
                    ctx.bezierCurveTo(hipL.x,          hipL.y - 65,     waistL.x,     waistL.y + 65, waistL.x, waistL.y)
                    ctx.bezierCurveTo(waistL.x - 12,   waistL.y - 80,   armholeL.x - 8, armholeL.y + 80, armholeL.x, armholeL.y)
                    // Left armhole: curves up-out to shoulder
                    ctx.bezierCurveTo(armholeL.x - 32, armholeL.y - 52, shldL.x - 22, shldL.y + 48, shldL.x, shldL.y)
                    // Left shoulder → neckL
                    ctx.lineTo(neckL.x, neckL.y)
                    // Left neckline → back to neckBtm
                    ctx.bezierCurveTo(neckL.x + 18, neckL.y + 28, cx - 52, neckBtm.y - 18, neckBtm.x, neckBtm.y)
                    ctx.closePath()

                    // White fill first, then stroke on top
                    ctx.fillStyle = "#ffffff"
                    ctx.shadowColor = "rgba(30,34,53,0.10)"
                    ctx.shadowBlur = 28
                    ctx.shadowOffsetY = 6
                    ctx.fill()
                    ctx.shadowColor = "transparent"
                    ctx.stroke()
                    ctx.restore()

                    // ── Inner neckline seam (finish line ~12px inside) ───────
                    ctx.save()
                    ctx.strokeStyle = "rgba(30,34,53,0.18)"
                    ctx.lineWidth = 1.2
                    ctx.lineJoin = "round"
                    ctx.beginPath()
                    const inset = 12
                    ctx.moveTo(neckBtm.x, neckBtm.y - inset)
                    ctx.bezierCurveTo(cx + 40, neckBtm.y - inset - 14, neckR.x - inset - 4, neckR.y + 22, neckR.x - inset, neckR.y + inset)
                    ctx.lineTo(shldR.x - inset, shldR.y + inset)
                    ctx.restore()

                    ctx.save()
                    ctx.strokeStyle = "rgba(30,34,53,0.18)"
                    ctx.lineWidth = 1.2
                    ctx.lineJoin = "round"
                    ctx.beginPath()
                    ctx.moveTo(neckBtm.x, neckBtm.y - inset)
                    ctx.bezierCurveTo(cx - 40, neckBtm.y - inset - 14, neckL.x + inset + 4, neckL.y + 22, neckL.x + inset, neckL.y + inset)
                    ctx.lineTo(shldL.x + inset, shldL.y + inset)
                    ctx.restore()

                    // ── Construction lines ───────────────────────────────────
                    ctx.save()

                    // Center-front line (dashed)
                    ctx.setLineDash([10, 8])
                    ctx.strokeStyle = "rgba(30,34,53,0.15)"
                    ctx.lineWidth = 1.5
                    ctx.beginPath()
                    ctx.moveTo(cx, neckBtm.y)
                    ctx.lineTo(cx, hemR.y)
                    ctx.stroke()

                    // Waist indicator (horizontal dashed)
                    ctx.setLineDash([6, 8])
                    ctx.strokeStyle = "rgba(30,34,53,0.10)"
                    ctx.lineWidth = 1
                    ctx.beginPath()
                    ctx.moveTo(waistL.x, waistL.y)
                    ctx.lineTo(waistR.x, waistR.y)
                    ctx.stroke()

                    ctx.setLineDash([])

                    // Grain line with double-headed arrow
                    const grainY1 = 700, grainY2 = 900
                    ctx.strokeStyle = "rgba(30,34,53,0.22)"
                    ctx.lineWidth = 1.4
                    ctx.beginPath()
                    ctx.moveTo(cx, grainY1)
                    ctx.lineTo(cx, grainY2)
                    ctx.stroke()
                    // Arrow heads
                    ctx.beginPath()
                    ctx.moveTo(cx - 7, grainY1 + 12); ctx.lineTo(cx, grainY1); ctx.lineTo(cx + 7, grainY1 + 12)
                    ctx.stroke()
                    ctx.beginPath()
                    ctx.moveTo(cx - 7, grainY2 - 12); ctx.lineTo(cx, grainY2); ctx.lineTo(cx + 7, grainY2 - 12)
                    ctx.stroke()

                    // Notch marks at shoulder & hip (small perpendicular ticks)
                    const notch = (x: number, y: number, angle: number) => {
                        const len = 10
                        const nx = Math.cos(angle) * len, ny = Math.sin(angle) * len
                        ctx.beginPath()
                        ctx.moveTo(x - nx, y - ny)
                        ctx.lineTo(x + nx, y + ny)
                        ctx.stroke()
                    }
                    ctx.strokeStyle = "rgba(30,34,53,0.25)"
                    ctx.lineWidth = 1.6
                    notch(shldL.x, shldL.y, Math.PI / 2)
                    notch(shldR.x, shldR.y, Math.PI / 2)
                    notch(hipL.x,  hipL.y,  0)
                    notch(hipR.x,  hipR.y,  0)

                    ctx.restore()

                    // ── "Start designing" hint ───────────────────────────────
                    ctx.save()
                    ctx.textAlign = "center"
                    ctx.font = "600 22px -apple-system, BlinkMacSystemFont, sans-serif"
                    ctx.fillStyle = "rgba(30,34,53,0.18)"
                    ctx.fillText("Your design starts here", cx, 1090)
                    ctx.font = "400 17px -apple-system, BlinkMacSystemFont, sans-serif"
                    ctx.fillStyle = "rgba(30,34,53,0.12)"
                    ctx.fillText("Add layers, text, or generate with AI", cx, 1120)
                    ctx.restore()
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

    // Add image layer — upload to S3 first, then store the persistent public URL
    const addImageLayer = async (file: File) => {
        // Use a local blob URL only as a preview while uploading
        const blobUrl = URL.createObjectURL(file)

        // Add layer immediately with blob URL for instant preview
        const layerId = `layer-${Date.now()}`
        const img = new window.Image()

        img.onload = () => {
            const baseDims = getBaseImageDimensions()
            const scale = Math.min(150 / img.width, 150 / img.height)

            const newLayer: DesignLayer = {
                id: layerId,
                type: "image",
                x: baseDims.x + baseDims.width / 2 - (img.width * scale) / 2,
                y: baseDims.y + baseDims.height / 2 - (img.height * scale) / 2,
                width: img.width,
                height: img.height,
                rotation: 0,
                scaleX: scale,
                scaleY: scale,
                src: blobUrl,
                draggable: true,
                opacity: 1,
            }

            setDesign((prev) => {
                const updated: DesignState = {
                    ...prev,
                    layers: [...prev.layers, newLayer],
                    selectedId: newLayer.id,
                }
                recordSnapshot(updated)
                return updated
            })
        }

        img.src = blobUrl

        // Upload to S3 in the background and swap the src with the persistent URL
        try {
            const result = await presignDesignImageUpload({
                name: file.name,
                type: file.type || "image/jpeg",
                size: file.size,
            })

            if (result.presign) {
                const { url: presignedUrl, public_url } = result.presign

                // Upload directly to S3 via presigned URL
                const uploadRes = await fetch(presignedUrl, {
                    method: "PUT",
                    body: file,
                    headers: { "Content-Type": file.type || "image/jpeg" },
                })

                if (uploadRes.ok) {
                    // Replace the temporary blob URL with the persistent public URL
                    setDesign((prev) => ({
                        ...prev,
                        layers: prev.layers.map((layer) =>
                            layer.id === layerId
                                ? { ...layer, src: public_url }
                                : layer
                        ),
                    }))
                    URL.revokeObjectURL(blobUrl)
                } else {
                    console.warn("S3 upload failed, layer will use blob URL (session-only)")
                }
            } else if (result.error?.code === "AUTH_REQUIRED") {
                // Not logged in — keep blob URL for the session, will be stripped on save
                console.warn("Not authenticated: image layer will not persist across sessions")
            }
        } catch (err) {
            console.warn("Image upload failed, layer will use blob URL:", err)
        }
    }

    // Add text layer - positioned at top of base image
    const addTextLayer = () => {
        const baseDims = getBaseImageDimensions()

        const newLayer: DesignLayer = {
            id: `layer-${Date.now()}`,
            type: "text",
            x: baseDims.x + baseDims.width / 2 - 50,
            y: baseDims.y + 40,
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

        setDesign((prev) => {
            const updated: DesignState = {
                ...prev,
                layers: [...prev.layers, newLayer],
                selectedId: newLayer.id,
            }
            recordSnapshot(updated)
            return updated
        })
    }

    // Add rect layer
    const addRectLayer = useCallback(() => {
        const bd = getBaseImageDimensions()
        const size = Math.min(bd.width, bd.height) * 0.3
        const newLayer: DesignLayer = {
            id: `layer-${Date.now()}`,
            type: "rect",
            x: bd.x + bd.width / 2 - size / 2,
            y: bd.y + bd.height / 2 - size / 2,
            width: size,
            height: size,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            fill: "#6366f1",
            strokeWidth: 0,
            cornerRadius: 8,
            draggable: true,
            opacity: 1,
        }
        setDesign((prev) => {
            const updated: DesignState = { ...prev, layers: [...prev.layers, newLayer], selectedId: newLayer.id }
            recordSnapshot(updated)
            return updated
        })
    }, [getBaseImageDimensions, recordSnapshot])

    // Add circle layer
    const addCircleLayer = useCallback(() => {
        const bd = getBaseImageDimensions()
        const radius = Math.min(bd.width, bd.height) * 0.15
        const newLayer: DesignLayer = {
            id: `layer-${Date.now()}`,
            type: "circle",
            x: bd.x + bd.width / 2,
            y: bd.y + bd.height / 2,
            width: radius * 2,
            height: radius * 2,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            fill: "#f59e0b",
            strokeWidth: 0,
            draggable: true,
            opacity: 1,
        }
        setDesign((prev) => {
            const updated: DesignState = { ...prev, layers: [...prev.layers, newLayer], selectedId: newLayer.id }
            recordSnapshot(updated)
            return updated
        })
    }, [getBaseImageDimensions, recordSnapshot])

    // Align selected layer relative to the base image area
    const alignLayer = useCallback((direction: "left" | "centerH" | "right" | "top" | "centerV" | "bottom") => {
        const bd = getBaseImageDimensions()
        const selectedId = design.selectedId
        if (!selectedId) return
        const layer = design.layers.find((l) => l.id === selectedId)
        if (!layer) return

        // Get actual bounding box from Konva for accuracy
        let layerW = (layer.width ?? 100) * Math.abs(layer.scaleX)
        let layerH = (layer.height ?? 100) * Math.abs(layer.scaleY)
        if (stageRef.current) {
            const node = stageRef.current.findOne(`#${selectedId}`)
            if (node) {
                const rect = node.getClientRect()
                const s = stageRef.current.scaleX()
                layerW = rect.width / s
                layerH = rect.height / s
            }
        }

        let newX = layer.x
        let newY = layer.y
        switch (direction) {
            case "left":    newX = bd.x; break
            case "centerH": newX = bd.x + (bd.width - layerW) / 2; break
            case "right":   newX = bd.x + bd.width - layerW; break
            case "top":     newY = bd.y; break
            case "centerV": newY = bd.y + (bd.height - layerH) / 2; break
            case "bottom":  newY = bd.y + bd.height - layerH; break
        }

        setDesign((prev) => {
            const updated: DesignState = {
                ...prev,
                layers: prev.layers.map((l) => (l.id === selectedId ? { ...l, x: newX, y: newY } : l)),
            }
            recordSnapshot(updated)
            return updated
        })
    }, [design.selectedId, design.layers, getBaseImageDimensions, recordSnapshot, stageRef])

    // Flip selected layer horizontally / vertically
    const flipLayerH = useCallback(() => {
        setDesign((prev) => {
            if (!prev.selectedId) return prev
            const updated: DesignState = {
                ...prev,
                layers: prev.layers.map((l) => l.id === prev.selectedId ? { ...l, scaleX: -l.scaleX } : l),
            }
            recordSnapshot(updated)
            return updated
        })
    }, [recordSnapshot])

    const flipLayerV = useCallback(() => {
        setDesign((prev) => {
            if (!prev.selectedId) return prev
            const updated: DesignState = {
                ...prev,
                layers: prev.layers.map((l) => l.id === prev.selectedId ? { ...l, scaleY: -l.scaleY } : l),
            }
            recordSnapshot(updated)
            return updated
        })
    }, [recordSnapshot])

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

    // Handle stage mouse/touch down
    const handleStageMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
        const isMiddleButton = 'button' in e.evt && e.evt.button === 1
        const isEmptyStage = e.target === e.target.getStage()

        // On mobile, single-finger drag on empty canvas = pan.
        // We also track travel so a quick tap (< 8px) deselects instead.
        const mobileEmptyDrag = isMobileLayout && isEmptyStage

        if (activeTool === "pan" || isMiddleButton || e.evt.ctrlKey || mobileEmptyDrag) {
            setIsPanning(true)
            mobileTouchStartOnEmptyRef.current = mobileEmptyDrag
            mobileTouchTravelRef.current = 0
            const stage = stageRef.current
            if (stage) {
                const pos = stage.getPointerPosition()
                if (pos) setLastPointerPos(pos)
            }
            return
        }

        // Desktop: deselect on bare stage click
        if (isEmptyStage) {
            setDesign((prev) => ({ ...prev, selectedId: null }))
        }
    }, [activeTool, isMobileLayout])

    const handleStageMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
        if (!isPanning || !lastPointerPos) return

        const stage = stageRef.current
        if (!stage) return

        const pos = stage.getPointerPosition()
        if (!pos) return

        const dx = pos.x - lastPointerPos.x
        const dy = pos.y - lastPointerPos.y

        // Accumulate travel so we can distinguish tap from drag on mobile
        mobileTouchTravelRef.current += Math.sqrt(dx * dx + dy * dy)

        setView(prev => ({
            ...prev,
            x: prev.x + dx,
            y: prev.y + dy,
        }))

        setLastPointerPos(pos)
    }, [isPanning, lastPointerPos])

    const handleStageMouseUp = useCallback(() => {
        // Mobile tap on empty canvas (< 8px travel) → deselect instead of pan
        if (mobileTouchStartOnEmptyRef.current && mobileTouchTravelRef.current < 8) {
            setDesign((prev) => ({ ...prev, selectedId: null }))
        }
        mobileTouchStartOnEmptyRef.current = false
        mobileTouchTravelRef.current = 0
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

            // Redirect to login page with redirect_to so user returns to editor after login
            const currentPath = window.location.pathname
            const loginUrl = `/${countryCode || 'us'}/account?redirect_to=${encodeURIComponent(currentPath)}`

            // Use setTimeout to ensure localStorage is saved before redirect
            setTimeout(() => {
                window.location.href = loginUrl
            }, 100)

            return
        }

        setIsSaving(true)
        try {
            // Generate thumbnail and upload it to S3 to avoid sending a data URL in the JSON body.
            // A base64 JPEG can be 100-400KB which easily exceeds the 100KB JSON body limit.
            let thumbnailUrl: string | undefined = product.thumbnail || undefined
            try {
                const raw = stageRef.current?.toDataURL({
                    pixelRatio: 1,
                    mimeType: "image/jpeg",
                    quality: 0.6,
                })
                if (raw) {
                    // Convert data URL to Blob and upload via presigned URL
                    const byteStr = atob(raw.split(",")[1])
                    const bytes = new Uint8Array(byteStr.length)
                    for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i)
                    const blob = new Blob([bytes], { type: "image/jpeg" })

                    const presignResult = await presignDesignImageUpload({
                        name: `thumbnail-${Date.now()}.jpg`,
                        type: "image/jpeg",
                        size: blob.size,
                    })

                    if (presignResult.presign) {
                        const { url: presignedUrl, public_url } = presignResult.presign
                        const uploadRes = await fetch(presignedUrl, {
                            method: "PUT",
                            body: blob,
                            headers: { "Content-Type": "image/jpeg" },
                        })
                        if (uploadRes.ok) {
                            thumbnailUrl = public_url
                        }
                    }
                    // If presign fails (not auth'd or upload error), thumbnailUrl stays as product.thumbnail
                }
            } catch {
                // Keep product.thumbnail as fallback
            }

            // For image layers that still have blob: or data: URLs, attempt to re-upload
            // via the Konva stage before stripping. The stage still holds the rendered pixels
            // even if the original File object is gone.
            const layersForStorage = await Promise.all(
                design.layers.map(async (layer) => {
                    if (
                        layer.type !== "image" ||
                        !layer.src ||
                        layer.src.startsWith("http")
                    ) {
                        return layer // already persistent or non-image
                    }

                    // Try to recover image data from the Konva stage node
                    try {
                        const node = stageRef.current?.findOne(`#${layer.id}`) as Konva.Image | undefined
                        if (node) {
                            const dataUrl = node.toDataURL({ mimeType: "image/jpeg", quality: 0.8 })
                            const byteStr = atob(dataUrl.split(",")[1])
                            const bytes = new Uint8Array(byteStr.length)
                            for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i)
                            const blob = new Blob([bytes], { type: "image/jpeg" })

                            const presignResult = await presignDesignImageUpload({
                                name: `layer-${layer.id}-${Date.now()}.jpg`,
                                type: "image/jpeg",
                                size: blob.size,
                            })

                            if (presignResult.presign) {
                                const { url: presignedUrl, public_url } = presignResult.presign
                                const uploadRes = await fetch(presignedUrl, {
                                    method: "PUT",
                                    body: blob,
                                    headers: { "Content-Type": "image/jpeg" },
                                })
                                if (uploadRes.ok) {
                                    // Revoke the old blob URL and swap in the persistent URL
                                    if (layer.src?.startsWith("blob:")) URL.revokeObjectURL(layer.src)
                                    return { ...layer, src: public_url } as typeof layer
                                }
                            }
                        }
                    } catch {
                        // Fall through to strip
                    }

                    // Could not upload — strip the src so the payload stays small
                    const { src: _src, ...rest } = layer as any
                    return rest
                })
            )

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

            // Sync any newly uploaded layer URLs back into editor state
            // so the canvas continues showing images after save
            const uploadedLayers = layersForStorage as DesignLayer[]
            const hasNewUploads = uploadedLayers.some(
                (ul, i) => ul.src && ul.src !== design.layers[i]?.src
            )
            if (hasNewUploads) {
                setDesign((prev) => ({ ...prev, layers: uploadedLayers }))
            }

            // Generate Excalidraw data using the resolved layers (with S3 URLs where possible)
            const excalidrawData = convertToExcalidraw(
                uploadedLayers,
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
                thumbnail_url: thumbnailUrl,
                metadata: {
                    layers: layersForStorage,
                    base_product_id: product.id,
                    base_product_thumbnail: product.thumbnail || undefined,
                    customer_id: customer.id,
                    badges: badgePreferences,
                },
                moodboard: excalidrawData,
                inventory_ids: inventoryIds.length > 0 ? inventoryIds : undefined,
                partner_id: selectedPartner?.id,
                tags: ["custom", "customer-design", product.handle],
            }

            // Create or update depending on whether the design has already been saved
            let savedId: string
            if (savedDesignId) {
                const result = await updateDesign(savedDesignId, designInput)
                savedId = result.design.id
            } else {
                const result = await createDesign(designInput)
                savedId = result.design.id
            }

            // Clear any draft after successful save
            clearDraftSnapshot()

            // Show checkout modal
            setSavedDesignId(savedId)
            setShowCheckoutModal(true)
        } catch (error) {
            console.error("Failed to save:", error)
            setSaveError("Failed to save design. Please try again.")
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

        // Try-on modal
        showTryOnModal,
        setShowTryOnModal,

        // AI payment modal
        showAiPaymentModal,
        setShowAiPaymentModal,
        aiFeaturesPaid,
        handleAiPaymentSuccess,

        savedDesignId,
        saveError,
        clearSaveError,

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
        canRedo,
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
        addRectLayer,
        addCircleLayer,
        updateLayer,
        deleteSelectedLayer,
        duplicateSelectedLayer,
        moveLayerUp,
        moveLayerDown,
        toggleLayerVisibility,
        alignLayer,
        flipLayerH,
        flipLayerV,

        showPrintZone,
        togglePrintZone,

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
