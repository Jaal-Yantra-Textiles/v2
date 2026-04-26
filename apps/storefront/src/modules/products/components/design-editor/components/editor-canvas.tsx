"use client"

import { Stage, Layer, Image as KonvaImage, Rect } from "react-konva"
import Konva from "konva"
import { ImageLayer } from "./image-layer"
import { TextLayer } from "./text-layer"
import { ShapeLayer } from "./shape-layer"
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
    selectedMaterial: RawMaterial | null
    setShowMaterialModal: (show: boolean) => void
    selectedPartner: Partner | null
    setShowPartnerModal: (show: boolean) => void
    isGeneratingAi?: boolean
    showPrintZone?: boolean
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
    selectedMaterial,
    setShowMaterialModal,
    selectedPartner,
    setShowPartnerModal,
    isGeneratingAi,
    showPrintZone = false,
}: EditorCanvasProps) {
    const showLoaderOverlay = baseImageStatus === "loading" || isGeneratingBase
    const showErrorOverlay = baseImageStatus === "error" && !isGeneratingBase
    const showAiOverlay = isGeneratingAi

    return (
        <div className={`flex flex-1 flex-col min-h-0 ${isMobileLayout ? "order-1" : "order-first"}`}>
            <div
                ref={containerRef}
                className="flex-1 min-h-0 overflow-hidden relative"
                style={{ cursor: activeTool === "pan" || isPanning ? "grab" : "default" }}
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
                    style={{ position: "absolute", left: -CANVAS_EXTEND, top: -CANVAS_EXTEND }}
                >
                    {/* Outer background */}
                    <Layer listening={false}>
                        <Rect x={0} y={0} width={stageSize.width} height={stageSize.height} fill="#f1f5f9" />
                    </Layer>

                    {/* Canvas background color (inside print zone area) */}
                    <Layer listening={false}>
                        <Rect
                            x={baseDims.x}
                            y={baseDims.y}
                            width={baseDims.width}
                            height={baseDims.height}
                            fill={design.backgroundColor ?? "#ffffff"}
                        />
                    </Layer>

                    {/* Base Product Image */}
                    <Layer listening={false}>
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
                            if (layer.type === "rect" || layer.type === "circle") {
                                return (
                                    <ShapeLayer
                                        key={layer.id}
                                        layer={layer}
                                        isSelected={design.selectedId === layer.id}
                                        onSelect={() => setDesign((prev) => ({ ...prev, selectedId: layer.id }))}
                                        onChange={(attrs) => updateLayer(layer.id, attrs)}
                                    />
                                )
                            }
                            return null
                        })}
                    </Layer>

                    {/* Print zone overlay */}
                    {showPrintZone && (
                        <Layer listening={false}>
                            <Rect
                                x={baseDims.x}
                                y={baseDims.y}
                                width={baseDims.width}
                                height={baseDims.height}
                                fill="transparent"
                                stroke="#6366f1"
                                strokeWidth={2}
                                dash={[8, 6]}
                                cornerRadius={4}
                            />
                        </Layer>
                    )}
                </Stage>

                {isMobileLayout && (
                    <div className="absolute top-3 right-3 z-20 rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium shadow-md border border-gray-200 backdrop-blur-sm">
                        {Math.round(view.scale * 100)}%
                    </div>
                )}

                {/* Material badge — bottom-left of canvas */}
                {selectedMaterial && (
                    <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-[180px] items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/90 px-3 py-2 shadow-lg backdrop-blur-sm">
                        {(() => {
                            const mediaArray = Array.isArray((selectedMaterial as any).media) ? (selectedMaterial as any).media : []
                            const thumb = mediaArray.find((m: any) => m.isThumbnail)?.url || mediaArray[0]?.url
                            return thumb ? (
                                <img src={thumb} alt="" className="h-7 w-7 flex-shrink-0 rounded-lg object-cover ring-1 ring-neutral-200" />
                            ) : (
                                <div
                                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-sm ring-1 ring-neutral-200"
                                    style={{ backgroundColor: (selectedMaterial as any).color || "#f3f4f6" }}
                                >
                                    🧵
                                </div>
                            )
                        })()}
                        <div className="min-w-0">
                            <p className="truncate text-[11px] font-semibold leading-tight text-neutral-800">
                                {selectedMaterial.name || (selectedMaterial as any).material_type?.name || "Material"}
                            </p>
                            <p className="truncate text-[10px] leading-tight text-neutral-500">
                                {(selectedMaterial as any).material_type?.category || "Material"}
                            </p>
                        </div>
                    </div>
                )}

                {/* Partner badge — bottom-right of canvas */}
                {selectedPartner && (
                    <button
                        type="button"
                        onClick={() => setShowPartnerModal(true)}
                        className="absolute bottom-3 right-3 z-10 flex max-w-[180px] items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/90 px-3 py-2 shadow-lg backdrop-blur-sm transition-shadow hover:shadow-xl"
                    >
                        {(selectedPartner as any).logo_url ? (
                            <img src={(selectedPartner as any).logo_url} alt="" className="h-7 w-7 flex-shrink-0 rounded-lg object-contain ring-1 ring-neutral-200" />
                        ) : (
                            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-neutral-50 text-sm ring-1 ring-neutral-200">
                                🏭
                            </div>
                        )}
                        <div className="min-w-0 text-left">
                            <p className="text-[10px] font-medium leading-tight text-neutral-500">Made by</p>
                            <p className="truncate text-[11px] font-semibold leading-tight text-neutral-800">
                                {selectedPartner.company_name || selectedPartner.name}
                            </p>
                        </div>
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

                {showAiOverlay && (
                    <div className="pointer-events-auto absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-violet-500/10 to-indigo-500/10 backdrop-blur-sm">
                        <div className="flex flex-col items-center gap-4 rounded-3xl border border-purple-200/50 bg-white/90 p-8 shadow-2xl">
                            <div className="relative">
                                <div className="h-16 w-16 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 p-[2px]">
                                    <div className="flex h-full w-full items-center justify-center rounded-full bg-white">
                                        <svg className="h-8 w-8 animate-pulse text-violet-600" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M12 0L14.59 8.41L23 11L14.59 13.59L12 22L9.41 13.59L1 11L9.41 8.41L12 0Z" />
                                        </svg>
                                    </div>
                                </div>
                                <div className="absolute inset-0 animate-spin" style={{ animationDuration: "3s" }}>
                                    <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-violet-400" />
                                </div>
                                <div className="absolute inset-0 animate-spin" style={{ animationDuration: "4s", animationDirection: "reverse" }}>
                                    <div className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-indigo-400" />
                                </div>
                            </div>
                            <div className="text-center">
                                <p className="text-lg font-semibold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">
                                    Generating with AI
                                </p>
                                <p className="mt-1 text-sm text-gray-500">Creating your unique design base...</p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
