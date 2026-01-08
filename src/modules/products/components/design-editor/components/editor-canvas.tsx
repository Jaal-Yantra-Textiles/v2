"use client"

import { Stage, Layer, Image as KonvaImage, Rect, Transformer } from "react-konva"
import Konva from "konva"
import { useRef, useEffect } from "react"
import { ImageLayer } from "./image-layer"
import { TextLayer } from "./text-layer"
import { DesignLayer, DesignState, ViewState, Partner } from "../types"
import { RawMaterial } from "@lib/data/raw-materials"

type EditorCanvasProps = {
    containerRef: React.RefObject<HTMLDivElement | null>
    stageRef: React.RefObject<Konva.Stage | null>
    stageSize: { width: number; height: number }
    view: ViewState
    activeTool: "select" | "pan"
    isPanning: boolean
    CANVAS_EXTEND: number
    baseImage: HTMLImageElement | null | undefined
    baseImageStatus: "loading" | "loaded" | "error"
    isGeneratingBase: boolean
    regenerateBaseImage: () => void
    baseDims: { x: number; y: number; width: number; height: number }
    design: DesignState
    setDesign: React.Dispatch<React.SetStateAction<DesignState>>
    updateLayer: (id: string, attrs: Partial<DesignLayer>) => void
    handleWheel: (e: Konva.KonvaEventObject<WheelEvent>) => void
    handleStageMouseDown: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void
    handleStageMouseMove: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void
    handleStageMouseUp: () => void
    isMobileLayout?: boolean
    sidebarExpanded: boolean
    setSidebarExpanded: React.Dispatch<React.SetStateAction<boolean>>
    selectedMaterial: RawMaterial | null
    setShowMaterialModal: (show: boolean) => void
    selectedPartner: Partner | null
    setShowPartnerModal: (show: boolean) => void
    // AI Generation
    isGeneratingAi?: boolean
}

export function EditorCanvas({
    containerRef,
    stageRef,
    stageSize,
    view,
    activeTool,
    isPanning,
    CANVAS_EXTEND,
    baseImage,
    baseImageStatus,
    isGeneratingBase,
    regenerateBaseImage,
    baseDims,
    design,
    setDesign,
    updateLayer,
    handleWheel,
    handleStageMouseDown,
    handleStageMouseMove,
    handleStageMouseUp,
    isMobileLayout,
    sidebarExpanded,
    setSidebarExpanded,
    selectedMaterial,
    setShowMaterialModal,
    selectedPartner,
    setShowPartnerModal,
    isGeneratingAi,
}: EditorCanvasProps) {
    const transformerRef = useRef<Konva.Transformer>(null)

    const showLoaderOverlay = baseImageStatus === "loading" || isGeneratingBase
    const showErrorOverlay = baseImageStatus === "error" && !isGeneratingBase
    const showAiOverlay = isGeneratingAi

    // Attach transformer to selected layer
    useEffect(() => {
        if (!design.selectedId || !transformerRef.current || !stageRef.current) {
            if (transformerRef.current) {
                transformerRef.current.nodes([])
            }
            return
        }

        // Find the selected node
        const selectedNode = stageRef.current.findOne(`#${design.selectedId}`)

        if (selectedNode && transformerRef.current) {
            transformerRef.current.nodes([selectedNode])
            transformerRef.current.getLayer()?.batchDraw()
        }
    }, [design.selectedId, stageRef])

    return (
        <div className={`flex flex-1 flex-col min-h-0 ${isMobileLayout ? "order-1" : "order-first"}`}>
            {/* Canvas Container - clips the larger stage */}
            <div
                ref={containerRef}
                className="flex-1 min-h-0 overflow-hidden relative"
                style={{
                    cursor: activeTool === "pan" || isPanning ? "grab" : "default",
                }}
            >
                <Stage
                    ref={stageRef}
                    width={stageSize.width}
                    height={stageSize.height}
                    scaleX={view.scale}
                    scaleY={view.scale}
                    x={view.x}
                    y={view.y}
                    onWheel={handleWheel}
                    onMouseDown={handleStageMouseDown}
                    onMouseMove={handleStageMouseMove}
                    onMouseUp={handleStageMouseUp}
                    onTouchStart={handleStageMouseDown}
                    onTouchMove={handleStageMouseMove}
                    onTouchEnd={handleStageMouseUp}
                    style={{
                        position: "absolute",
                        left: -CANVAS_EXTEND,
                        top: -CANVAS_EXTEND,
                    }}
                >
                    {/* Background - covers entire extended canvas */}
                    <Layer listening={false}>
                        <Rect
                            x={0}
                            y={0}
                            width={stageSize.width}
                            height={stageSize.height}
                            fill="#ffffff"
                        />
                    </Layer>

                    {/* Base Product Image */}
                    <Layer>
                        {baseImage && (
                            <KonvaImage
                                image={baseImage}
                                x={baseDims.x}
                                y={baseDims.y}
                                width={baseDims.width}
                                height={baseDims.height}
                            />
                        )}
                    </Layer>

                    {/* Design Layers */}
                    <Layer>
                        {design.layers.map((layer) => {
                            if (layer.type === "image") {
                                return (
                                    <ImageLayer
                                        key={layer.id}
                                        layer={layer}
                                        isSelected={design.selectedId === layer.id}
                                        onSelect={() => setDesign((prev) => ({ ...prev, selectedId: layer.id }))}
                                        onChange={(attrs) => updateLayer(layer.id, attrs)}
                                    />
                                )
                            }
                            if (layer.type === "text") {
                                return (
                                    <TextLayer
                                        key={layer.id}
                                        layer={layer}
                                        isSelected={design.selectedId === layer.id}
                                        onSelect={() => setDesign((prev) => ({ ...prev, selectedId: layer.id }))}
                                        onChange={(attrs) => updateLayer(layer.id, attrs)}
                                        stageRef={stageRef}
                                    />
                                )
                            }
                            return null
                        })}

                        {/* Transformer for selected layer */}
                        {(() => {
                            const transformerRef = useRef<Konva.Transformer>(null)
                            const layerRef = useRef<Konva.Layer>(null)

                            useEffect(() => {
                                if (!design.selectedId || !transformerRef.current || !stageRef.current) return

                                // Find the selected node
                                const selectedNode = stageRef.current.findOne(`#${design.selectedId}`)

                                if (selectedNode && transformerRef.current) {
                                    transformerRef.current.nodes([selectedNode])
                                    transformerRef.current.getLayer()?.batchDraw()
                                } else {
                                    transformerRef.current.nodes([])
                                }
                            }, [design.selectedId])

                            return (
                                <Transformer
                                    ref={transformerRef}
                                    enabledAnchors={[
                                        'top-left',
                                        'top-right',
                                        'bottom-left',
                                        'bottom-right',
                                        'middle-left',
                                        'middle-right',
                                        'top-center',
                                        'bottom-center'
                                    ]}
                                    rotateEnabled={true}
                                    borderStroke="#4F46E5"
                                    borderStrokeWidth={2}
                                    anchorStroke="#4F46E5"
                                    anchorFill="#fff"
                                    anchorSize={8}
                                    anchorCornerRadius={4}
                                    keepRatio={false}
                                    boundBoxFunc={(oldBox, newBox) => {
                                        // Limit resize to prevent too small sizes
                                        if (newBox.width < 10 || newBox.height < 10) {
                                            return oldBox
                                        }
                                        return newBox
                                    }}
                                />
                            )
                        })()}
                    </Layer>
                </Stage>
                {isMobileLayout && (
                    <button
                        type="button"
                        aria-label={sidebarExpanded ? "Hide design panel" : "Show design panel"}
                        onClick={() => setSidebarExpanded((prev) => !prev)}
                        className="absolute bottom-4 right-4 z-20 rounded-full bg-white/90 px-4 py-2 text-sm font-medium shadow-lg border border-ui-border-base backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-ui-fg-interactive"
                    >
                        {sidebarExpanded ? "Hide Panel" : "Show Panel"}
                    </button>
                )}
                {(showLoaderOverlay || showErrorOverlay) && (
                    <div className="pointer-events-auto absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-white/85 backdrop-blur-sm">
                        {showLoaderOverlay && (
                            <>
                                <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-gray-500" />
                                <p className="text-sm font-medium text-gray-600">
                                    {isGeneratingBase ? "Generating base canvas…" : "Loading base design…"}
                                </p>
                            </>
                        )}
                        {showErrorOverlay && (
                            <div className="flex flex-col items-center gap-3 text-center">
                                <p className="text-sm font-medium text-gray-700">
                                    We couldn&apos;t load the base design image.
                                </p>
                                <button
                                    type="button"
                                    onClick={regenerateBaseImage}
                                    className="rounded-full bg-black px-4 py-2 text-xs font-medium text-white hover:bg-gray-900"
                                >
                                    Try regenerating base
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* AI Generation Overlay */}
                {showAiOverlay && (
                    <div className="pointer-events-auto absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-purple-500/10 to-blue-500/10 backdrop-blur-sm">
                        <div className="flex flex-col items-center gap-4 rounded-3xl border border-purple-200/50 bg-white/90 p-8 shadow-2xl">
                            {/* Animated sparkle icon */}
                            <div className="relative">
                                <div className="h-16 w-16 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 p-[2px]">
                                    <div className="flex h-full w-full items-center justify-center rounded-full bg-white">
                                        <svg
                                            className="h-8 w-8 animate-pulse text-purple-600"
                                            fill="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path d="M12 0L14.59 8.41L23 11L14.59 13.59L12 22L9.41 13.59L1 11L9.41 8.41L12 0Z" />
                                        </svg>
                                    </div>
                                </div>
                                {/* Orbiting dots */}
                                <div className="absolute inset-0 animate-spin" style={{ animationDuration: '3s' }}>
                                    <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-purple-400" />
                                </div>
                                <div className="absolute inset-0 animate-spin" style={{ animationDuration: '4s', animationDirection: 'reverse' }}>
                                    <div className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-blue-400" />
                                </div>
                            </div>
                            <div className="text-center">
                                <p className="text-lg font-semibold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                                    Generating with AI
                                </p>
                                <p className="mt-1 text-sm text-gray-500">
                                    Creating your unique design base...
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
