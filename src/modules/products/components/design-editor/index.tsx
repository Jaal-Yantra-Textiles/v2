"use client"

import React, { useState, useRef, useEffect, useCallback } from "react"
import { Stage, Layer, Image as KonvaImage, Transformer, Rect, Text as KonvaText, Group, Circle, Line } from "react-konva"
import Konva from "konva"
import { Button, Text, Label, Input, Tooltip, TooltipProvider } from "@medusajs/ui"
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

import { listRawMaterials, RawMaterial } from "@lib/data/raw-materials"
import { listPartners, Partner as PartnerData } from "@lib/data/partners"
import { createDesign, CreateDesignInput } from "@lib/data/designs"

// Types - RawMaterial imported from @lib/data/raw-materials

type InventoryItem = {
  id: string
  raw_materials?: RawMaterial // Single object, not array
}

type Partner = {
  id: string
  name?: string
  company_name?: string
  type?: string
  logo_url?: string
  description?: string
}

type Design = {
  id: string
  name?: string
  description?: string
  status?: string
  partners?: Partner[]
  inventory_items?: InventoryItem[]
  tasks?: Array<{
    id: string
    title?: string
    status?: string
  }>
}

export type DesignProduct = {
  id: string
  handle: string
  title: string
  thumbnail?: string | null
  description?: string
  designs?: Design[]
  metadata?: Record<string, any>
}

export type CustomerInfo = {
  id: string
  email: string
}

// Local storage key for saving design drafts
const DESIGN_DRAFT_KEY = "design_editor_draft"

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
  fontFamily?: string
  fontStyle?: string // "normal" | "bold" | "italic" | "bold italic"
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

// Text Layer Component with inline editing
function TextLayer({
  layer,
  isSelected,
  onSelect,
  onChange,
  stageRef,
}: {
  layer: DesignLayer
  isSelected: boolean
  onSelect: () => void
  onChange: (attrs: Partial<DesignLayer>) => void
  stageRef?: React.RefObject<Konva.Stage | null>
}) {
  const shapeRef = useRef<Konva.Text>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const [isEditing, setIsEditing] = useState(false)

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current && !isEditing) {
      trRef.current.nodes([shapeRef.current])
      trRef.current.getLayer()?.batchDraw()
    }
  }, [isSelected, isEditing])

  // Handle double-click to edit text
  const handleDblClick = () => {
    if (!shapeRef.current || !stageRef?.current) return
    
    const textNode = shapeRef.current
    const stage = stageRef.current
    const stageBox = stage.container().getBoundingClientRect()
    
    // Hide text node and transformer
    textNode.hide()
    if (trRef.current) trRef.current.hide()
    
    setIsEditing(true)
    
    // Get position relative to stage container
    const textPosition = textNode.absolutePosition()
    const areaPosition = {
      x: stageBox.left + textPosition.x * stage.scaleX() + stage.x(),
      y: stageBox.top + textPosition.y * stage.scaleY() + stage.y(),
    }
    
    // Create textarea
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    
    textarea.value = layer.text || ''
    textarea.style.position = 'fixed'
    textarea.style.top = `${areaPosition.y}px`
    textarea.style.left = `${areaPosition.x}px`
    textarea.style.width = `${Math.max(textNode.width() * stage.scaleX() * textNode.scaleX(), 100)}px`
    textarea.style.height = `${Math.max(textNode.height() * stage.scaleY() * textNode.scaleY() + 10, 40)}px`
    textarea.style.fontSize = `${(layer.fontSize || 24) * stage.scaleX()}px`
    textarea.style.fontFamily = layer.fontFamily || 'Arial'
    textarea.style.color = layer.fill || '#000000'
    textarea.style.border = '2px solid #4f46e5'
    textarea.style.borderRadius = '4px'
    textarea.style.padding = '4px'
    textarea.style.margin = '0'
    textarea.style.overflow = 'hidden'
    textarea.style.background = 'white'
    textarea.style.outline = 'none'
    textarea.style.resize = 'none'
    textarea.style.lineHeight = '1.2'
    textarea.style.transformOrigin = 'left top'
    textarea.style.zIndex = '1000'
    
    textarea.focus()
    textarea.select()
    
    const removeTextarea = () => {
      if (textarea.parentNode) {
        textarea.parentNode.removeChild(textarea)
      }
      textNode.show()
      if (trRef.current) trRef.current.show()
      setIsEditing(false)
    }
    
    textarea.addEventListener('keydown', (e) => {
      // Enter without shift = save
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        onChange({ text: textarea.value })
        removeTextarea()
      }
      // Escape = cancel
      if (e.key === 'Escape') {
        removeTextarea()
      }
    })
    
    textarea.addEventListener('blur', () => {
      onChange({ text: textarea.value })
      removeTextarea()
    })
  }

  return (
    <>
      <KonvaText
        ref={shapeRef}
        text={layer.text || "Text"}
        x={layer.x}
        y={layer.y}
        fontSize={layer.fontSize || 24}
        fontFamily={layer.fontFamily || "Arial"}
        fontStyle={layer.fontStyle || "normal"}
        fill={layer.fill || "#000000"}
        rotation={layer.rotation}
        scaleX={layer.scaleX}
        scaleY={layer.scaleY}
        opacity={layer.opacity}
        draggable={layer.draggable}
        onClick={onSelect}
        onTap={onSelect}
        onDblClick={handleDblClick}
        onDblTap={handleDblClick}
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
      {isSelected && !isEditing && (
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
interface DesignEditorProps {
  product: DesignProduct
  customer?: CustomerInfo | null
  countryCode?: string
}

export default function DesignEditor({ product, customer, countryCode }: DesignEditorProps) {
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
  
  // Material detail modal state
  const [selectedMaterial, setSelectedMaterial] = useState<RawMaterial | null>(null)
  
  // External materials from API
  const [externalMaterials, setExternalMaterials] = useState<RawMaterial[]>([])
  const [materialsLoading, setMaterialsLoading] = useState(false)
  const [materialsError, setMaterialsError] = useState<string | null>(null)
  
  // Partners from API
  const [externalPartners, setExternalPartners] = useState<Partner[]>([])
  const [partnersLoading, setPartnersLoading] = useState(false)
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null)
  
  // Modal states for badge details
  const [showMaterialModal, setShowMaterialModal] = useState(false)
  const [showPartnerModal, setShowPartnerModal] = useState(false)
  
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
    <div className="flex h-[calc(100vh-64px)] bg-white">
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
      <div className="flex flex-1 flex-col min-h-0">
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
                      stageRef={stageRef}
                    />
                  )
                }
                return null
              })}
            </Layer>
          </Stage>
          
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
                  const thumb = mediaArr.find(m => m.isThumbnail)?.url || mediaArr[0]?.url
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
          
          {/* Material Detail Modal */}
          {showMaterialModal && selectedMaterial && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowMaterialModal(false)}>
              <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
                {/* Modal Header */}
                <div className="bg-blue-500 text-white px-6 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🧵</span>
                    <div>
                      <h3 className="font-semibold text-lg">
                        {selectedMaterial.name || selectedMaterial.material_type?.name || 'Material'}
                      </h3>
                      {selectedMaterial.material_type?.category && (
                        <p className="text-blue-100 text-sm">{selectedMaterial.material_type.category}</p>
                      )}
                    </div>
                  </div>
                  <button onClick={() => setShowMaterialModal(false)} className="p-1 hover:bg-blue-600 rounded">
                    <XMark className="h-5 w-5" />
                  </button>
                </div>
                
                {/* Modal Body */}
                <div className="p-6 space-y-4">
                  {/* Preview Image */}
                  {(() => {
                    const mediaArr = Array.isArray(selectedMaterial.media) ? selectedMaterial.media : []
                    const thumb = mediaArr.find(m => m.isThumbnail)?.url || mediaArr[0]?.url
                    if (thumb) {
                      return <img src={thumb} alt="" className="w-full h-48 object-cover rounded-lg" />
                    }
                    return (
                      <div 
                        className="w-full h-48 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: selectedMaterial.color || '#e5e5e5' }}
                      >
                        <span className="text-6xl">🧵</span>
                      </div>
                    )
                  })()}
                  
                  {/* Details Grid */}
                  <div className="grid grid-cols-2 gap-4">
                    {selectedMaterial.color && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Color</div>
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-6 h-6 rounded-full border-2 border-gray-200"
                            style={{ backgroundColor: selectedMaterial.color }}
                          />
                          <span className="text-sm font-medium">{selectedMaterial.color}</span>
                        </div>
                      </div>
                    )}
                    
                    {selectedMaterial.composition && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Composition</div>
                        <span className="text-sm font-medium">{selectedMaterial.composition}</span>
                      </div>
                    )}
                    
                    {selectedMaterial.material_type?.name && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Type</div>
                        <span className="text-sm font-medium">{selectedMaterial.material_type.name}</span>
                      </div>
                    )}
                    
                    {selectedMaterial.material_type?.description && (
                      <div className="bg-gray-50 rounded-lg p-3 col-span-2">
                        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Description</div>
                        <span className="text-sm">{selectedMaterial.material_type.description}</span>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Modal Footer */}
                <div className="border-t px-6 py-4 flex justify-between items-center bg-gray-50">
                  <button
                    onClick={() => {
                      setSelectedMaterial(null)
                      setShowMaterialModal(false)
                    }}
                    className="text-sm text-red-600 hover:text-red-700"
                  >
                    Remove Selection
                  </button>
                  <Button size="small" onClick={() => setShowMaterialModal(false)}>
                    Close
                  </Button>
                </div>
              </div>
            </div>
          )}
          
          {/* Partner Detail Modal */}
          {showPartnerModal && selectedPartner && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowPartnerModal(false)}>
              <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
                {/* Modal Header */}
                <div className="bg-green-500 text-white px-6 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {selectedPartner.logo_url ? (
                      <img src={selectedPartner.logo_url} alt="" className="w-12 h-12 rounded-full object-cover border-2 border-white" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-green-400 flex items-center justify-center border-2 border-white">
                        <span className="text-2xl">🏭</span>
                      </div>
                    )}
                    <div>
                      <h3 className="font-semibold text-lg">
                        {selectedPartner.company_name || selectedPartner.name || 'Partner'}
                      </h3>
                      {selectedPartner.type && (
                        <p className="text-green-100 text-sm">{selectedPartner.type}</p>
                      )}
                    </div>
                  </div>
                  <button onClick={() => setShowPartnerModal(false)} className="p-1 hover:bg-green-600 rounded">
                    <XMark className="h-5 w-5" />
                  </button>
                </div>
                
                {/* Modal Body */}
                <div className="p-6 space-y-4">
                  {/* Partner Info */}
                  <div className="space-y-3">
                    {selectedPartner.name && selectedPartner.company_name && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Contact Name</div>
                        <span className="text-sm font-medium">{selectedPartner.name}</span>
                      </div>
                    )}
                    
                    {selectedPartner.description && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">About</div>
                        <span className="text-sm">{selectedPartner.description}</span>
                      </div>
                    )}
                    
                    {selectedPartner.type && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Specialization</div>
                        <span className="inline-block bg-green-100 text-green-700 text-sm px-3 py-1 rounded-full">
                          {selectedPartner.type}
                        </span>
                      </div>
                    )}
                  </div>
                  
                  {/* Production Badge */}
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                    <div className="text-green-600 text-sm font-medium mb-1">✓ Selected for Production</div>
                    <div className="text-gray-600 text-xs">This partner will produce your custom design</div>
                  </div>
                </div>
                
                {/* Modal Footer */}
                <div className="border-t px-6 py-4 flex justify-between items-center bg-gray-50">
                  <button
                    onClick={() => {
                      setSelectedPartner(null)
                      setShowPartnerModal(false)
                    }}
                    className="text-sm text-red-600 hover:text-red-700"
                  >
                    Remove Selection
                  </button>
                  <Button size="small" onClick={() => setShowPartnerModal(false)}>
                    Close
                  </Button>
                </div>
              </div>
            </div>
          )}
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
        {/* Toggle Button - Fixed Header */}
        <div className="flex-shrink-0 border-b">
          <button
            onClick={() => setSidebarExpanded(!sidebarExpanded)}
            className="flex items-center justify-center w-full py-3 hover:bg-gray-50"
            title={sidebarExpanded ? "Collapse" : "Expand"}
          >
            <ArrowsPointingOutMini className={`h-4 w-4 transition-transform ${sidebarExpanded ? "rotate-180" : ""}`} />
          </button>
        </div>
        
        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">

        {/* Product Info - Show when expanded */}
        {sidebarExpanded && (
          <div className="border-b p-2">
            <Text size="small" weight="plus" className="mb-2 px-1 text-gray-500 uppercase tracking-wide text-xs">
              Product Info
            </Text>
            <div className="space-y-2 text-xs">
              <div className="bg-gray-50 rounded p-2">
                <Text size="small" weight="plus" className="text-gray-700">{product.title}</Text>
                {product.description && (
                  <Text size="small" className="text-gray-500 mt-1 line-clamp-2">{product.description}</Text>
                )}
              </div>
              
              {/* Designs & Partners */}
              {product.designs && product.designs.length > 0 && (
                <div className="space-y-1">
                  {product.designs.map((design) => (
                    <div key={design.id} className="bg-blue-50 rounded p-2">
                      <Text size="small" weight="plus" className="text-blue-700">
                        {design.name || "Design"}
                      </Text>
                      {design.status && (
                        <span className="text-xs bg-blue-100 text-blue-600 px-1 rounded ml-1">
                          {design.status}
                        </span>
                      )}
                      
                      {/* Partners */}
                      {design.partners && design.partners.length > 0 && (
                        <div className="mt-1">
                          <Text size="small" className="text-gray-500">Made by:</Text>
                          {design.partners.map((partner) => (
                            <Text key={partner.id} size="small" className="text-gray-700 ml-1">
                              • {partner.company_name || partner.name || "Partner"}
                            </Text>
                          ))}
                        </div>
                      )}
                      
                      {/* Raw Materials */}
                      {design.inventory_items && design.inventory_items.length > 0 && (
                        <div className="mt-1">
                          <Text size="small" className="text-gray-500">Materials:</Text>
                          {design.inventory_items
                            .filter(item => item.raw_materials)
                            .map(item => (
                              <Text key={item.id} size="small" className="text-gray-700 ml-1">
                                • {item.raw_materials?.name || item.raw_materials?.material_type?.name || "Material"}
                                {item.raw_materials?.color && ` (${item.raw_materials.color})`}
                              </Text>
                            ))
                          }
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

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

        {/* Materials / Fabrics - Visual swatches from API */}
        <div className="border-b p-2">
          {sidebarExpanded && (
            <Text size="small" weight="plus" className="mb-2 px-1 text-gray-500 uppercase tracking-wide text-xs">
              Materials
            </Text>
          )}
          
          {/* Loading state */}
          {materialsLoading && (
            <div className="flex items-center justify-center py-4">
              <Text size="small" className="text-gray-400">Loading materials...</Text>
            </div>
          )}
          
          {/* Error state */}
          {materialsError && !materialsLoading && (
            <div className="text-center py-2">
              <Text size="small" className="text-red-500 text-xs">{materialsError}</Text>
            </div>
          )}
          
          {/* Empty state */}
          {!materialsLoading && !materialsError && externalMaterials.length === 0 && (
            <div className="text-center py-2">
              <Text size="small" className="text-gray-400 text-xs">No materials available</Text>
            </div>
          )}
          
          {/* Materials grid */}
          {!materialsLoading && externalMaterials.length > 0 && (
            <TooltipProvider>
              <div className={`${sidebarExpanded ? "grid grid-cols-3 gap-1" : "flex flex-col gap-1"}`}>
                {externalMaterials.map((material) => {
                    const mediaArray = Array.isArray(material.media) ? material.media : []
                    const thumbnail = mediaArray.find(m => m.isThumbnail)?.url || mediaArray[0]?.url
                    const bgColor = material.color || '#e5e5e5'
                    const isSelected = selectedMaterial?.id === material.id
                    const materialName = material.name || material.material_type?.name || 'Material'
                    
                    return (
                      <Tooltip key={material.id} content={materialName}>
                        <button
                          onClick={() => setSelectedMaterial(isSelected ? null : material)}
                          className={`group relative rounded overflow-hidden border-2 transition-all ${
                            isSelected 
                              ? "border-blue-500 ring-2 ring-blue-200" 
                              : "border-transparent hover:border-gray-300"
                          }`}
                        >
                          {thumbnail ? (
                            <img 
                              src={thumbnail} 
                              alt={materialName} 
                              className={`${sidebarExpanded ? "w-full h-10" : "w-10 h-10"} object-cover`}
                            />
                          ) : (
                            <div 
                              className={`${sidebarExpanded ? "w-full h-10" : "w-10 h-10"} flex items-center justify-center`}
                              style={{ backgroundColor: bgColor }}
                            >
                              <span className="text-xs">🧵</span>
                            </div>
                          )}
                        </button>
                      </Tooltip>
                    )
                  })}
              </div>
            </TooltipProvider>
          )}
          
          {/* Selected Material Details - shown outside the grid */}
          {sidebarExpanded && selectedMaterial && !materialsLoading && (
            <div className="mt-2 bg-gray-50 rounded-lg p-2 space-y-2">
              {/* Header with close */}
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <Text size="small" weight="plus" className="text-gray-800 truncate">
                    {selectedMaterial.name || selectedMaterial.material_type?.name || "Material"}
                  </Text>
                  {selectedMaterial.material_type?.category && (
                    <Text size="small" className="text-gray-500 text-xs">
                      {selectedMaterial.material_type.category}
                    </Text>
                  )}
                </div>
                <button 
                  onClick={() => setSelectedMaterial(null)}
                  className="p-0.5 hover:bg-gray-200 rounded flex-shrink-0"
                >
                  <XMark className="h-3.5 w-3.5 text-gray-500" />
                </button>
              </div>
              
              {/* Preview */}
              {(() => {
                const mediaArr = Array.isArray(selectedMaterial.media) ? selectedMaterial.media : []
                const thumb = mediaArr.find(m => m.isThumbnail)?.url || mediaArr[0]?.url
                if (thumb) {
                  return <img src={thumb} alt="" className="w-full h-20 object-cover rounded" />
                }
                return (
                  <div 
                    className="w-full h-20 rounded flex items-center justify-center"
                    style={{ backgroundColor: selectedMaterial.color || '#e5e5e5' }}
                  >
                    <span className="text-2xl">🧵</span>
                  </div>
                )
              })()}
              
              {/* Details */}
              <div className="space-y-1 text-xs">
                {selectedMaterial.color && (
                  <div className="flex items-center gap-1.5">
                    <div 
                      className="w-4 h-4 rounded border flex-shrink-0"
                      style={{ backgroundColor: selectedMaterial.color }}
                    />
                    <span className="text-gray-600 truncate">{selectedMaterial.color}</span>
                  </div>
                )}
                {selectedMaterial.composition && (
                  <div className="text-gray-600">
                    <span className="text-gray-400">Composition: </span>
                    {selectedMaterial.composition}
                  </div>
                )}
              </div>
              
              {/* Add to Canvas Button */}
              {(() => {
                const mediaArr = Array.isArray(selectedMaterial.media) ? selectedMaterial.media : []
                const firstMediaUrl = mediaArr[0]?.url
                if (!firstMediaUrl) return null
                
                return (
                  <button
                    onClick={() => {
                      const baseDims = getBaseImageDimensions()
                      const img = new window.Image()
                      img.crossOrigin = "anonymous"
                      img.onload = () => {
                        const scale = Math.min(80 / img.width, 80 / img.height)
                        const newLayer: DesignLayer = {
                          id: `layer-${Date.now()}`,
                          type: "image",
                          x: baseDims.x + baseDims.width / 2 - (img.width * scale) / 2,
                          y: baseDims.y + baseDims.height / 2 - (img.height * scale) / 2,
                          width: img.width * scale,
                          height: img.height * scale,
                          rotation: 0,
                          scaleX: 1,
                          scaleY: 1,
                          src: firstMediaUrl,
                          draggable: true,
                          opacity: 1,
                        }
                        setDesign((prev) => ({
                          ...prev,
                          layers: [...prev.layers, newLayer],
                          selectedId: newLayer.id,
                        }))
                        setSelectedMaterial(null)
                      }
                      img.src = firstMediaUrl
                    }}
                    className="w-full py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors"
                  >
                    + Add to Canvas
                  </button>
                )
              })()}
            </div>
          )}
        </div>

        {/* AI Tools - Future AI manipulation features */}
        <div className="border-b p-2">
          {sidebarExpanded && (
            <Text size="small" weight="plus" className="mb-2 px-1 text-gray-500 uppercase tracking-wide text-xs">
              AI Tools
            </Text>
          )}
          <div className={`flex ${sidebarExpanded ? "flex-col gap-1" : "flex-col gap-1"}`}>
            <button
              onClick={() => {
                // TODO: Implement AI background removal
                alert("AI Background Removal - Coming Soon!")
              }}
              className="flex items-center gap-2 rounded-md p-2 text-sm bg-purple-50 hover:bg-purple-100 text-purple-700 transition-colors"
              title="Remove Background (AI)"
            >
              <span className="text-xs">✨</span>
              {sidebarExpanded && "Remove BG"}
            </button>
            <button
              onClick={() => {
                // TODO: Implement AI image generation
                alert("AI Image Generation - Coming Soon!")
              }}
              className="flex items-center gap-2 rounded-md p-2 text-sm bg-purple-50 hover:bg-purple-100 text-purple-700 transition-colors"
              title="Generate Image (AI)"
            >
              <span className="text-xs">🎨</span>
              {sidebarExpanded && "Generate"}
            </button>
            <button
              onClick={() => {
                // TODO: Implement AI style transfer
                alert("AI Style Transfer - Coming Soon!")
              }}
              className="flex items-center gap-2 rounded-md p-2 text-sm bg-purple-50 hover:bg-purple-100 text-purple-700 transition-colors"
              title="Style Transfer (AI)"
            >
              <span className="text-xs">🖼️</span>
              {sidebarExpanded && "Style"}
            </button>
          </div>
        </div>

        {/* Partners - Select production partner */}
        <div className="border-b p-2">
          {sidebarExpanded && (
            <Text size="small" weight="plus" className="mb-2 px-1 text-gray-500 uppercase tracking-wide text-xs">
              Production Partner
            </Text>
          )}
          
          {/* Loading state */}
          {partnersLoading && (
            <div className="flex items-center justify-center py-2">
              <Text size="small" className="text-gray-400 text-xs">Loading partners...</Text>
            </div>
          )}
          
          {/* Partners list */}
          {!partnersLoading && externalPartners.length > 0 && (
            <TooltipProvider>
              <div className={`${sidebarExpanded ? "flex flex-col gap-1" : "flex flex-col gap-1"}`}>
                {externalPartners.slice(0, 5).map((partner) => {
                  const isSelected = selectedPartner?.id === partner.id
                  
                  return (
                    <Tooltip key={partner.id} content={partner.company_name || partner.name || 'Partner'}>
                      <button
                        onClick={() => setSelectedPartner(isSelected ? null : partner)}
                        className={`flex items-center gap-2 rounded-md p-2 text-xs transition-all ${
                          isSelected 
                            ? "bg-green-100 text-green-700 ring-1 ring-green-300" 
                            : "bg-gray-50 hover:bg-gray-100"
                        }`}
                      >
                        {partner.logo_url ? (
                          <img 
                            src={partner.logo_url} 
                            alt={partner.name || 'Partner'} 
                            className="w-6 h-6 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center">
                            <span className="text-xs">🏭</span>
                          </div>
                        )}
                        {sidebarExpanded && (
                          <div className="flex-1 min-w-0 text-left">
                            <div className="truncate font-medium">
                              {partner.name || partner.company_name}
                            </div>
                            {partner.type && (
                              <div className="text-gray-500 text-xs truncate">{partner.type}</div>
                            )}
                          </div>
                        )}
                        {isSelected && sidebarExpanded && (
                          <span className="text-green-600">✓</span>
                        )}
                      </button>
                    </Tooltip>
                  )
                })}
              </div>
            </TooltipProvider>
          )}
          
          {/* No partners */}
          {!partnersLoading && externalPartners.length === 0 && sidebarExpanded && (
            <Text size="small" className="text-gray-400 text-xs text-center py-2">
              No partners available
            </Text>
          )}
          
          {/* Selected partner info */}
          {sidebarExpanded && selectedPartner && (
            <div className="mt-2 p-2 bg-green-50 rounded text-xs">
              <div className="flex items-center justify-between">
                <span className="text-green-700 font-medium">Selected:</span>
                <button 
                  onClick={() => setSelectedPartner(null)}
                  className="text-green-600 hover:text-green-800"
                >
                  <XMark className="h-3 w-3" />
                </button>
              </div>
              <div className="text-green-800 mt-1">
                {selectedPartner.company_name || selectedPartner.name}
              </div>
            </div>
          )}
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
                <div
                  key={layer.id}
                  onClick={() => setDesign(prev => ({ ...prev, selectedId: layer.id }))}
                  className={`flex items-center gap-2 rounded-md p-2 text-left text-xs transition-colors cursor-pointer ${
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
                </div>
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
                    <div>
                      <Label className="text-xs text-gray-500 mb-1 block">Font</Label>
                      <select
                        value={layer.fontFamily || "Arial"}
                        onChange={(e) => updateLayer(layer.id, { fontFamily: e.target.value })}
                        className="w-full text-sm border rounded px-2 py-1.5"
                      >
                        <option value="Arial">Arial</option>
                        <option value="Helvetica">Helvetica</option>
                        <option value="Times New Roman">Times New Roman</option>
                        <option value="Georgia">Georgia</option>
                        <option value="Verdana">Verdana</option>
                        <option value="Courier New">Courier New</option>
                        <option value="Impact">Impact</option>
                        <option value="Comic Sans MS">Comic Sans MS</option>
                      </select>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => updateLayer(layer.id, { 
                          fontStyle: layer.fontStyle === "bold" || layer.fontStyle === "bold italic" 
                            ? layer.fontStyle.replace("bold", "").trim() || "normal"
                            : layer.fontStyle === "italic" ? "bold italic" : "bold"
                        })}
                        className={`flex-1 py-1 text-sm border rounded ${
                          layer.fontStyle?.includes("bold") ? "bg-gray-200 font-bold" : ""
                        }`}
                      >
                        B
                      </button>
                      <button
                        onClick={() => updateLayer(layer.id, { 
                          fontStyle: layer.fontStyle === "italic" || layer.fontStyle === "bold italic"
                            ? layer.fontStyle.replace("italic", "").trim() || "normal"
                            : layer.fontStyle === "bold" ? "bold italic" : "italic"
                        })}
                        className={`flex-1 py-1 text-sm border rounded italic ${
                          layer.fontStyle?.includes("italic") ? "bg-gray-200" : ""
                        }`}
                      >
                        I
                      </button>
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
        </div>
        {/* End Scrollable Content Area */}

        {/* Login Status & Save Button - Fixed Footer */}
        <div className="flex-shrink-0 border-t p-2 bg-white space-y-2">
          {/* Login status indicator */}
          {sidebarExpanded && (
            <div className={`text-xs px-2 py-1 rounded ${customer ? "bg-green-50 text-green-700" : "bg-yellow-50 text-yellow-700"}`}>
              {customer ? (
                <span>✓ Logged in as {customer.email}</span>
              ) : (
                <span>⚠ Not logged in - design will be saved as draft</span>
              )}
            </div>
          )}
          <Button 
            className={`w-full ${sidebarExpanded ? "" : "p-2"}`} 
            size="small"
            onClick={handleSave} 
            disabled={isSaving}
          >
            {sidebarExpanded 
              ? (isSaving ? "Saving..." : (customer ? "Save Design" : "Save & Login")) 
              : "💾"
            }
          </Button>
        </div>
      </div>
    </div>
  )
}
