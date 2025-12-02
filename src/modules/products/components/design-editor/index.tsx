"use client"

import React, { useState, useRef, useEffect, useCallback } from "react"
import { Stage, Layer, Image as KonvaImage, Transformer, Rect, Text as KonvaText, Group, Circle, Line } from "react-konva"
import Konva from "konva"
import { Button, Text, Label, Input } from "@medusajs/ui"
import { 
  Plus, 
  Trash, 
  ArrowUpMini, 
  ArrowDownMini,
  ArrowsPointingOutMini,
  EyeMini,
  EyeSlash,
  SquareTwoStack,
  ArrowUturnLeft,
  CursorArrowRays,
  MinusMini,
  PlusMini,
  XMark,
} from "@medusajs/icons"

// Types
export type DesignProduct = {
  id: string
  handle: string
  title: string
  thumbnail?: string | null
}

type DesignLayer = {
  id: string
  type: "image" | "text"
  x: number
  y: number
  width?: number
  height?: number
  rotation: number
  scaleX: number
  scaleY: number
  src?: string // for images
  text?: string // for text
  fontSize?: number
  fill?: string
  draggable: boolean
  opacity: number
}

type DesignState = {
  name: string
  layers: DesignLayer[]
  selectedId: string | null
  baseImage: HTMLImageElement | null
}

// Zoom/Pan state
type ViewState = {
  scale: number
  x: number
  y: number
}

const MIN_SCALE = 0.1
const MAX_SCALE = 5
const ZOOM_STEP = 0.1

// Custom hook for loading images
function useImage(src: string | undefined): [HTMLImageElement | null, "loading" | "loaded" | "error"] {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading")

  useEffect(() => {
    if (!src) {
      setImage(null)
      setStatus("error")
      return
    }

    console.log("[useImage] Loading image:", src)
    const img = new window.Image()
    
    img.onload = () => {
      console.log("[useImage] Image loaded successfully:", src)
      setImage(img)
      setStatus("loaded")
    }
    
    img.onerror = (e) => {
      console.error("[useImage] Image failed to load:", src, e)
      setImage(null)
      setStatus("error")
    }
    
    // Don't set crossOrigin - it causes CORS issues with local Medusa file provider
    // Canvas export (toDataURL) won't work, but display will
    img.src = src
    setStatus("loading")

    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [src])

  return [image, status]
}

// Draggable Image Layer Component
function ImageLayer({
  layer,
  isSelected,
  onSelect,
  onChange,
}: {
  layer: DesignLayer
  isSelected: boolean
  onSelect: () => void
  onChange: (attrs: Partial<DesignLayer>) => void
}) {
  const shapeRef = useRef<Konva.Image>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const [image] = useImage(layer.src)

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current])
      trRef.current.getLayer()?.batchDraw()
    }
  }, [isSelected])

  if (!image) return null

  return (
    <>
      <KonvaImage
        ref={shapeRef}
        image={image}
        x={layer.x}
        y={layer.y}
        width={layer.width}
        height={layer.height}
        rotation={layer.rotation}
        scaleX={layer.scaleX}
        scaleY={layer.scaleY}
        opacity={layer.opacity}
        draggable={layer.draggable}
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={(e) => {
          onChange({
            x: e.target.x(),
            y: e.target.y(),
          })
        }}
        onTransformEnd={() => {
          const node = shapeRef.current
          if (!node) return
          
          onChange({
            x: node.x(),
            y: node.y(),
            rotation: node.rotation(),
            scaleX: node.scaleX(),
            scaleY: node.scaleY(),
          })
        }}
      />
      {isSelected && (
        <Transformer
          ref={trRef}
          boundBoxFunc={(oldBox, newBox) => {
            // Limit minimum size
            if (newBox.width < 20 || newBox.height < 20) {
              return oldBox
            }
            return newBox
          }}
        />
      )}
    </>
  )
}

// Text Layer Component
function TextLayer({
  layer,
  isSelected,
  onSelect,
  onChange,
}: {
  layer: DesignLayer
  isSelected: boolean
  onSelect: () => void
  onChange: (attrs: Partial<DesignLayer>) => void
}) {
  const shapeRef = useRef<Konva.Text>(null)
  const trRef = useRef<Konva.Transformer>(null)

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current])
      trRef.current.getLayer()?.batchDraw()
    }
  }, [isSelected])

  return (
    <>
      <KonvaText
        ref={shapeRef}
        text={layer.text || "Text"}
        x={layer.x}
        y={layer.y}
        fontSize={layer.fontSize || 24}
        fill={layer.fill || "#000000"}
        rotation={layer.rotation}
        scaleX={layer.scaleX}
        scaleY={layer.scaleY}
        opacity={layer.opacity}
        draggable={layer.draggable}
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={(e) => {
          onChange({
            x: e.target.x(),
            y: e.target.y(),
          })
        }}
        onTransformEnd={() => {
          const node = shapeRef.current
          if (!node) return
          
          onChange({
            x: node.x(),
            y: node.y(),
            rotation: node.rotation(),
            scaleX: node.scaleX(),
            scaleY: node.scaleY(),
          })
        }}
      />
      {isSelected && (
        <Transformer
          ref={trRef}
          enabledAnchors={["middle-left", "middle-right"]}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 20) {
              return oldBox
            }
            return newBox
          }}
        />
      )}
    </>
  )
}

// Main Design Editor Component
export default function DesignEditor({ product }: { product: DesignProduct }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  const [stageSize, setStageSize] = useState({ width: 1200, height: 600 })
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
  
  // Sidebar expanded state - must be before any conditional returns
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  
  const [design, setDesign] = useState<DesignState>({
    name: "",
    layers: [],
    selectedId: null,
    baseImage: null,
  })

  // Load base product image
  const [baseImage, baseImageStatus] = useImage(product.thumbnail || undefined)
  
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

  // Extra canvas space for elements to extend into (in each direction)
  const CANVAS_EXTEND = 1500
  
  // Track visible container size separately from stage size
  const [containerDims, setContainerDims] = useState({ width: 800, height: 600 })
  
  // Update sizes on resize
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        const visibleWidth = rect.width
        const visibleHeight = Math.min(rect.height, window.innerHeight - 120)
        
        console.log('Container dims:', visibleWidth, visibleHeight)
        console.log('Stage will be:', visibleWidth + CANVAS_EXTEND * 2, visibleHeight + CANVAS_EXTEND * 2)
        
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
    if (!baseImage) return { x: CANVAS_EXTEND, y: CANVAS_EXTEND, width: 0, height: 0 }
    
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

  // Add text layer
  const addTextLayer = () => {
    const baseDims = getBaseImageDimensions()
    
    const newLayer: DesignLayer = {
      id: `layer-${Date.now()}`,
      type: "text",
      x: baseDims.x + baseDims.width / 2 - 50,
      y: baseDims.y + baseDims.height / 2,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      text: "Your Text",
      fontSize: 32,
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

  // Save design
  const handleSave = async () => {
    setIsSaving(true)
    try {
      // Export canvas as image
      const dataUrl = stageRef.current?.toDataURL({ pixelRatio: 2 })
      
      const designData = {
        productId: product.id,
        productHandle: product.handle,
        name: design.name,
        layers: design.layers,
        preview: dataUrl,
      }
      
      console.log("Saving design:", designData)
      // TODO: Implement actual save API call
      alert("Design saved! (placeholder)")
    } catch (error) {
      console.error("Failed to save:", error)
      alert("Failed to save design")
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

  const baseDims = getBaseImageDimensions()

  // Loading state
  if (baseImageStatus === "loading") {
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
  if (!product.thumbnail || baseImageStatus === "error") {
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
    <div className="flex h-screen bg-white">
      {/* Name Modal */}
      {showNameModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <Text weight="plus" className="mb-2 text-lg">
              Name Your Design
            </Text>
            <Text size="small" className="mb-4 text-gray-600">
              Give your custom {product.title} design a name.
            </Text>
            <div className="space-y-4">
              <div>
                <Label htmlFor="designName">Design Name</Label>
                <Input
                  id="designName"
                  autoFocus
                  value={designName}
                  onChange={(e) => setDesignName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleNameSubmit()
                  }}
                  placeholder="e.g., Summer Collection Tee"
                  className="mt-1"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDesignName("Untitled Design")
                    setDesign((prev) => ({ ...prev, name: "Untitled Design" }))
                    setShowNameModal(false)
                  }}
                >
                  Skip
                </Button>
                <Button onClick={handleNameSubmit} disabled={!designName.trim()}>
                  Continue
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) addImageLayer(file)
          e.target.value = ""
        }}
      />

      {/* Main Canvas Area - Now on the left/center */}
      <div className="flex flex-1 flex-col">
        {/* Canvas Container - clips the larger stage */}
        <div 
          ref={containerRef} 
          className="flex-1 overflow-hidden relative"
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
              position: 'absolute',
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
                    />
                  )
                }
                return null
              })}
            </Layer>
          </Stage>
        </div>

        {/* Bottom Zoom Bar */}
        <div className="flex items-center justify-between border-t bg-white px-4 py-2">
          <div className="flex items-center gap-2">
            <button
              onClick={undo}
              disabled={historyIndex <= 0}
              className="rounded p-1.5 transition-colors hover:bg-gray-100 disabled:opacity-40"
              title="Undo (Ctrl+Z)"
            >
              <ArrowUturnLeft className="h-4 w-4" />
            </button>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={zoomOut}
              className="rounded p-1.5 transition-colors hover:bg-gray-100"
              title="Zoom Out"
            >
              <MinusMini className="h-4 w-4" />
            </button>
            <span className="min-w-[60px] text-center text-sm text-gray-600">
              {Math.round(view.scale * 100)}%
            </span>
            <button
              onClick={zoomIn}
              className="rounded p-1.5 transition-colors hover:bg-gray-100"
              title="Zoom In"
            >
              <PlusMini className="h-4 w-4" />
            </button>
            <button
              onClick={resetView}
              className="rounded p-1.5 transition-colors hover:bg-gray-100 ml-2"
              title="Reset View"
            >
              <ArrowUturnLeft className="h-4 w-4" />
            </button>
          </div>

          <Text size="small" className="text-gray-400">
            Scroll to zoom
          </Text>
        </div>
      </div>

      {/* Right Sidebar - Compact & Expandable */}
      <div className={`flex flex-col border-l bg-white transition-all duration-200 ${sidebarExpanded ? "w-64" : "w-14"}`}>
        {/* Toggle Button */}
        <button
          onClick={() => setSidebarExpanded(!sidebarExpanded)}
          className="flex items-center justify-center border-b py-3 hover:bg-gray-50"
          title={sidebarExpanded ? "Collapse" : "Expand"}
        >
          <ArrowsPointingOutMini className={`h-4 w-4 transition-transform ${sidebarExpanded ? "rotate-180" : ""}`} />
        </button>

        {/* Tools - Icon only when collapsed */}
        <div className="border-b p-2">
          {sidebarExpanded && (
            <Text size="small" weight="plus" className="mb-2 px-1 text-gray-500 uppercase tracking-wide text-xs">
              Tools
            </Text>
          )}
          <div className={`flex ${sidebarExpanded ? "gap-1" : "flex-col gap-1"}`}>
            <button
              onClick={() => setActiveTool("select")}
              className={`flex items-center justify-center gap-2 rounded-md p-2 text-sm transition-colors ${
                activeTool === "select" ? "bg-gray-900 text-white" : "bg-gray-100 hover:bg-gray-200"
              } ${sidebarExpanded ? "flex-1" : ""}`}
              title="Select (V)"
            >
              <CursorArrowRays className="h-4 w-4" />
              {sidebarExpanded && "Select"}
            </button>
            <button
              onClick={() => setActiveTool("pan")}
              className={`flex items-center justify-center gap-2 rounded-md p-2 text-sm transition-colors ${
                activeTool === "pan" ? "bg-gray-900 text-white" : "bg-gray-100 hover:bg-gray-200"
              } ${sidebarExpanded ? "flex-1" : ""}`}
              title="Pan (Space)"
            >
              <ArrowsPointingOutMini className="h-4 w-4" />
              {sidebarExpanded && "Pan"}
            </button>
          </div>
        </div>

        {/* Add Elements */}
        <div className="border-b p-2">
          {sidebarExpanded && (
            <Text size="small" weight="plus" className="mb-2 px-1 text-gray-500 uppercase tracking-wide text-xs">
              Add
            </Text>
          )}
          <div className={`flex ${sidebarExpanded ? "flex-col gap-1" : "flex-col gap-1"}`}>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 rounded-md p-2 text-sm bg-gray-100 hover:bg-gray-200 transition-colors"
              title="Add Image"
            >
              <Plus className="h-4 w-4" />
              {sidebarExpanded && "Image"}
            </button>
            <button
              onClick={addTextLayer}
              className="flex items-center gap-2 rounded-md p-2 text-sm bg-gray-100 hover:bg-gray-200 transition-colors"
              title="Add Text"
            >
              <Plus className="h-4 w-4" />
              {sidebarExpanded && "Text"}
            </button>
          </div>
        </div>

        {/* Layers */}
        <div className="flex-1 overflow-auto p-2">
          {sidebarExpanded && (
            <Text size="small" weight="plus" className="mb-2 px-1 text-gray-500 uppercase tracking-wide text-xs">
              Layers ({design.layers.length})
            </Text>
          )}
          <div className="flex flex-col gap-1">
            {design.layers.length === 0 ? (
              sidebarExpanded && (
                <Text size="small" className="text-gray-400 py-2 text-center text-xs">
                  No layers
                </Text>
              )
            ) : (
              [...design.layers].reverse().map((layer, index) => (
                <button
                  key={layer.id}
                  onClick={() => setDesign(prev => ({ ...prev, selectedId: layer.id }))}
                  className={`flex items-center gap-2 rounded-md p-2 text-left text-xs transition-colors ${
                    design.selectedId === layer.id
                      ? "bg-indigo-100 text-indigo-700"
                      : "hover:bg-gray-100"
                  }`}
                  title={layer.type === "text" ? layer.text || "Text" : `Image ${design.layers.length - index}`}
                >
                  {sidebarExpanded ? (
                    <>
                      <span className="flex-1 truncate">
                        {layer.type === "text" ? layer.text || "Text" : `Image ${design.layers.length - index}`}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleLayerVisibility(layer.id)
                        }}
                        className="p-1 hover:bg-gray-200 rounded"
                      >
                        {layer.opacity === 0 ? (
                          <EyeSlash className="h-3 w-3 text-gray-400" />
                        ) : (
                          <EyeMini className="h-3 w-3" />
                        )}
                      </button>
                    </>
                  ) : (
                    <span className="w-full text-center">{design.layers.length - index}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Layer Actions (when selected) */}
        {design.selectedId && (
          <div className="border-t p-2">
            {sidebarExpanded && (
              <Text size="small" weight="plus" className="mb-2 px-1 text-gray-500 uppercase tracking-wide text-xs">
                Actions
              </Text>
            )}
            <div className={`grid ${sidebarExpanded ? "grid-cols-4" : "grid-cols-1"} gap-1`}>
              <button
                onClick={duplicateSelectedLayer}
                className="flex items-center justify-center rounded-md p-2 text-xs hover:bg-gray-100"
                title="Duplicate"
              >
                <SquareTwoStack className="h-4 w-4" />
              </button>
              <button
                onClick={moveLayerUp}
                className="flex items-center justify-center rounded-md p-2 text-xs hover:bg-gray-100"
                title="Move Up"
              >
                <ArrowUpMini className="h-4 w-4" />
              </button>
              <button
                onClick={moveLayerDown}
                className="flex items-center justify-center rounded-md p-2 text-xs hover:bg-gray-100"
                title="Move Down"
              >
                <ArrowDownMini className="h-4 w-4" />
              </button>
              <button
                onClick={deleteSelectedLayer}
                className="flex items-center justify-center rounded-md p-2 text-xs text-red-600 hover:bg-red-50"
                title="Delete"
              >
                <Trash className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Properties Panel (expanded only, when layer selected) */}
        {sidebarExpanded && design.selectedId && (() => {
          const layer = design.layers.find((l) => l.id === design.selectedId)
          if (!layer) return null

          return (
            <div className="border-t p-2">
              <Text size="small" weight="plus" className="mb-2 px-1 text-gray-500 uppercase tracking-wide text-xs">
                Properties
              </Text>
              <div className="flex flex-col gap-3">
                {layer.type === "text" && (
                  <>
                    <Input
                      placeholder="Text"
                      value={layer.text || ""}
                      onChange={(e) => updateLayer(layer.id, { text: e.target.value })}
                      className="text-sm"
                    />
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={layer.fill || "#000000"}
                        onChange={(e) => updateLayer(layer.id, { fill: e.target.value })}
                        className="h-8 w-8 cursor-pointer rounded border"
                      />
                      <Input
                        type="number"
                        value={layer.fontSize || 24}
                        onChange={(e) => updateLayer(layer.id, { fontSize: parseInt(e.target.value) || 24 })}
                        className="flex-1 text-sm"
                        placeholder="Size"
                      />
                    </div>
                  </>
                )}
                <div>
                  <Label className="text-xs text-gray-500 mb-1 block">
                    Opacity {Math.round(layer.opacity * 100)}%
                  </Label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={layer.opacity}
                    onChange={(e) => updateLayer(layer.id, { opacity: parseFloat(e.target.value) })}
                    className="w-full"
                  />
                </div>
                <div>
                  <Label className="text-xs text-gray-500 mb-1 block">
                    Rotation {Math.round(layer.rotation)}°
                  </Label>
                  <input
                    type="range"
                    min="-180"
                    max="180"
                    step="1"
                    value={layer.rotation}
                    onChange={(e) => updateLayer(layer.id, { rotation: parseFloat(e.target.value) })}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          )
        })()}

        {/* Save Button */}
        <div className="border-t p-2">
          <Button 
            className={`w-full ${sidebarExpanded ? "" : "p-2"}`} 
            size="small"
            onClick={handleSave} 
            disabled={isSaving}
          >
            {sidebarExpanded ? (isSaving ? "Saving..." : "Save") : "💾"}
          </Button>
        </div>
      </div>
    </div>
  )
}
