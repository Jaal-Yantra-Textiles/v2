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
}: EditorCanvasProps) {
    const transformerRef = useRef<Konva.Transformer>(null)

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
                {/* Selection Badges - Floating next to canvas */}
                <div className="absolute right-4 top-4 flex flex-col gap-2 z-10">
                    {/* Selected Material Badge */}
                    {selectedMaterial && (
                        <button
                            onClick={() => setShowMaterialModal(true)}
                            className="group flex items-center gap-2 bg-white rounded-full shadow-lg border-2 border-blue-400 px-3 py-2 hover:shadow-xl transition-all hover:scale-105"
                        >
                            {(() => {
                                const mediaArr = Array.isArray(selectedMaterial.media) ? selectedMaterial.media : []
                                const thumb = mediaArr.find((m: any) => m.isThumbnail)?.url || mediaArr[0]?.url
                                return thumb ? (
                                    <img src={thumb} alt="" className="w-8 h-8 rounded-full object-cover border-2 border-blue-300" />
                                ) : (
                                    <div
                                        className="w-8 h-8 rounded-full flex items-center justify-center border-2 border-blue-300"
                                        style={{ backgroundColor: selectedMaterial.color || '#e5e5e5' }}
                                    >
                                        <span className="text-sm">🧵</span>
                                    </div>
                                )
                            })()}
                            <div className="text-left max-w-[120px]">
                                <div className="text-xs font-medium text-gray-800 truncate">
                                    {selectedMaterial.name || selectedMaterial.material_type?.name || 'Material'}
                                </div>
                                <div className="text-xs text-blue-600">Click for details</div>
                            </div>
                        </button>
                    )}

                    {/* Selected Partner Badge */}
                    {selectedPartner && (
                        <button
                            onClick={() => setShowPartnerModal(true)}
                            className="group flex items-center gap-2 bg-white rounded-full shadow-lg border-2 border-green-400 px-3 py-2 hover:shadow-xl transition-all hover:scale-105"
                        >
                            {selectedPartner.logo_url ? (
                                <img src={selectedPartner.logo_url} alt="" className="w-8 h-8 rounded-full object-cover border-2 border-green-300" />
                            ) : (
                                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center border-2 border-green-300">
                                    <span className="text-sm">🏭</span>
                                </div>
                            )}
                            <div className="text-left max-w-[120px]">
                                <div className="text-xs font-medium text-gray-800 truncate">
                                    {selectedPartner.name || selectedPartner.company_name || 'Partner'}
                                </div>
                                <div className="text-xs text-green-600">Click for details</div>
                            </div>
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}
