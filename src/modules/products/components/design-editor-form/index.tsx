"use client"

import { Button, Text, Label, Input, Select } from "@medusajs/ui"
import React, { useRef, useState } from "react"

type MoodboardProduct = {
  title: string
  thumbnail?: string | null
}

const DesignEditorForm = ({ product }: { product?: MoodboardProduct }) => {
  const [formData, setFormData] = useState({
    customName: "",
    buttonType: "Standard",
    material: "Cotton",
    color: "#ff0000",
  })

  const [prompt, setPrompt] = useState("")
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [activeHotspot, setActiveHotspot] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [scale, setScale] = useState(1)
  const minScale = 1
  const maxScale = 3
  const containerRef = useRef<HTMLDivElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchState = useRef<{ dist: number; center: { x: number; y: number }; scale: number } | null>(null)

  // Track fitted content size (the displayed image size with object-contain at scale=1)
  const [contentSize, setContentSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })

  // Moodboard items (multi-image)
  type MoodItem = {
    id: string
    src: string
    x: number // in px within content coordinates
    y: number // in px within content coordinates
    scale: number // per-item scale
    rotation: number // degrees
    z: number
    locked?: boolean
    isBase?: boolean
    w?: number
    h?: number
  }
  const [items, setItems] = useState<MoodItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const itemDragRef = useRef<{ id: string; startX: number; startY: number; itemX: number; itemY: number } | null>(null)
  const itemResizeRef = useRef<{ id: string; originScale: number; originSize: { w: number; h: number }; startX: number; startY: number } | null>(null)
  const itemRotateRef = useRef<{ id: string; center: { x: number; y: number }; originAngle: number; startAngle: number } | null>(null)
  const itemInteractionRef = useRef<{ type: 'drag' | 'resize' | 'rotate' | null }>({ type: null })
  const resizeRaf = useRef<number | null>(null)

  const computeContentSize = () => {
    const el = containerRef.current
    const img = imageRef.current
    if (!el || !img) return
    const cw = el.clientWidth
    const ch = el.clientHeight
    const nw = img.naturalWidth || 0
    const nh = img.naturalHeight || 0
    if (!nw || !nh) return
    const fit = Math.min(cw / nw, ch / nh)
    setContentSize({ w: nw * fit, h: nh * fit })
  }

  React.useEffect(() => {
    computeContentSize()
    const onResize = () => computeContentSize()
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  // Initialize base product image as locked item when available
  React.useEffect(() => {
    if (!product?.thumbnail || !contentSize.w || !contentSize.h) return
    setItems((prev) => {
      if (prev.some((i) => i.isBase)) return prev
      const base: MoodItem = {
        id: "base-product",
        src: product.thumbnail!,
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        z: 0,
        locked: false,
        isBase: true,
      }
      return [...prev, base]
    })
  }, [product?.thumbnail, contentSize.w, contentSize.h])

  // Toolbar actions
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const onAddImageFile = (file: File) => {
    const url = URL.createObjectURL(file)
    // Place roughly center
    const id = `item-${Date.now()}`
    setItems((prev) => {
      const maxZ = prev.reduce((m, it) => Math.max(m, it.z), 0)
      return [
        ...prev,
        {
          id,
          src: url,
          x: -contentSize.w * 0.15,
          y: -contentSize.h * 0.15,
          scale: 0.5,
          rotation: 0,
          z: maxZ + 1,
        },
      ]
    })
    setSelectedId(id)
  }
  const bringForward = () => {
    if (!selectedId) return
    setItems((prev) => {
      const maxZ = prev.reduce((m, it) => Math.max(m, it.z), 0)
      return prev.map((it) => (it.id === selectedId ? { ...it, z: maxZ + 1 } : it))
    })
  }
  const sendBackward = () => {
    if (!selectedId) return
    setItems((prev) => prev.map((it) => (it.id === selectedId ? { ...it, z: Math.max(0, it.z - 1) } : it)))
  }
  const deleteItem = () => {
    if (!selectedId) return
    setItems((prev) => prev.filter((it) => it.id !== selectedId || it.isBase)) // do not delete base
    setSelectedId((id) => {
      const target = items.find((i) => i.id === id)
      return target?.isBase ? id : null
    })
  }
  const toggleLock = () => {
    if (!selectedId) return
    setItems((prev) => prev.map((it) => (it.id === selectedId ? { ...it, locked: !it.locked } : it)))
  }

  const clampOffset = (next: { x: number; y: number }, nextScale?: number) => {
    const el = containerRef.current
    if (!el) return next
    const cw = el.clientWidth
    const ch = el.clientHeight
    const s = nextScale ?? scale
    const vw = contentSize.w * s
    const vh = contentSize.h * s
    // If content is smaller than viewport, keep centered (no pan beyond small epsilon)
    const maxX = Math.max(0, (vw - cw) / 2)
    const maxY = Math.max(0, (vh - ch) / 2)
    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    }
  }

  // Simple default hotspots (percent positions relative to canvas)
  const hotspots: { key: keyof typeof formData; label: string; x: number; y: number; type: "select" | "color" }[] = [
    { key: "buttonType", label: "Buttons", x: 58, y: 47, type: "select" },
    { key: "material", label: "Material", x: 30, y: 65, type: "select" },
    { key: "color", label: "Color", x: 75, y: 20, type: "color" },
  ]

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  // no traditional submit; canvas-first UX

  return (
    <div className="min-h-screen">
      {/* Canvas-only view with hotspots */}
      <div className="min-h-screen w-full">
        <div ref={containerRef} className="relative h-[100vh] w-full overflow-hidden">
          {/* Content layer: sized to fitted image, centered; zoom/pan applied here only */}
          <div
            className={`absolute left-1/2 top-1/2 touch-none ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
            style={{
              width: contentSize.w ? `${contentSize.w}px` : "auto",
              height: contentSize.h ? `${contentSize.h}px` : "auto",
              transform: `translate(-50%, -50%) translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
              transformOrigin: "50% 50%",
            }}
            onPointerDown={(e) => {
              // Don't start dragging if interacting with a control/popover button
              const target = e.target as HTMLElement
              if (target.closest("button, input, select, textarea")) return
              activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
              if (activePointers.current.size === 1) {
                setIsDragging(true)
                setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y })
              } else if (activePointers.current.size === 2) {
                const pts = Array.from(activePointers.current.values())
                const dx = pts[1].x - pts[0].x
                const dy = pts[1].y - pts[0].y
                const dist = Math.hypot(dx, dy)
                const center = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
                pinchState.current = { dist, center, scale }
              }
              ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => {
              // keep pointer positions updated for pinch
              if (activePointers.current.has(e.pointerId)) {
                activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
              }
              if (itemInteractionRef.current.type) {
                // don't process pinch while interacting with an item
                return
              }
              if (activePointers.current.size === 2 && pinchState.current) {
                const pts = Array.from(activePointers.current.values())
                const dx = pts[1].x - pts[0].x
                const dy = pts[1].y - pts[0].y
                const dist = Math.hypot(dx, dy)
                const center = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
                const ratio = dist / (pinchState.current.dist || 1)
                let newScale = Math.min(maxScale, Math.max(minScale, pinchState.current.scale * ratio))
                // zoom around the pinch center based on content size
                const el = containerRef.current
                if (el) {
                  const rect = el.getBoundingClientRect()
                  const cx = center.x - rect.left - rect.width / 2
                  const cy = center.y - rect.top - rect.height / 2
                  const k = newScale / scale
                  const newOffset = clampOffset({ x: cx - (cx - offset.x) * k, y: cy - (cy - offset.y) * k }, newScale)
                  setOffset(newOffset)
                }
                setScale(newScale)
              } else if (isDragging && dragStart) {
                const next = { x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }
                setOffset(clampOffset(next))
              }
            }}
            onPointerUp={(e) => {
              activePointers.current.delete(e.pointerId)
              setIsDragging(false)
              setDragStart(null)
              pinchState.current = null
              try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
            }}
            onPointerCancel={(e) => {
              activePointers.current.clear()
              setIsDragging(false)
              setDragStart(null)
              pinchState.current = null
              try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
            }}
            onPointerLeave={() => {
              // If pointer leaves while dragging, stop dragging
              setIsDragging(false)
              setDragStart(null)
              pinchState.current = null
            }}
            onWheel={(e) => {
              // Only zoom on Ctrl+wheel, and never while interacting with items
              if (!e.ctrlKey || itemInteractionRef.current.type) {
                return
              }
              e.preventDefault()
              const el = containerRef.current
              if (!el) return
              const rect = el.getBoundingClientRect()
              const wheel = e.deltaY
              const zoom = Math.exp(-wheel * 0.001)
              let newScale = Math.min(maxScale, Math.max(minScale, scale * zoom))
              const cx = e.clientX - rect.left - rect.width / 2
              const cy = e.clientY - rect.top - rect.height / 2
              const k = newScale / scale
              const newOffset = clampOffset({ x: cx - (cx - offset.x) * k, y: cy - (cy - offset.y) * k }, newScale)
              setOffset(newOffset)
              setScale(newScale)
            }}
          >
          {/* Hidden preloader for measuring natural size */}
          {product?.thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imageRef}
              src={product.thumbnail}
              alt="measure"
              style={{ position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none" }}
              onLoad={computeContentSize}
            />
          )}

          {/* Moodboard items (within content layer) */}
          <div className="pointer-events-none absolute inset-0">
            {items
              .slice()
              .sort((a, b) => a.z - b.z)
              .map((it) => {
                // Item wrapper transform
                const sel = selectedId === it.id
                return (
                  <div
                    key={it.id}
                    className="absolute pointer-events-auto select-none"
                    style={{
                      left: `${(contentSize.w / 2 + it.x)}px`,
                      top: `${(contentSize.h / 2 + it.y)}px`,
                      transform: `translate(-50%, -50%) rotate(${it.rotation}deg) scale(${it.scale})`,
                      transformOrigin: "50% 50%",
                      willChange: "transform",
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      if (it.locked) return setSelectedId(it.id)
                      setSelectedId(it.id)
                      const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
                      // record starting positions in content coordinates
                      itemDragRef.current = {
                        id: it.id,
                        startX: e.clientX,
                        startY: e.clientY,
                        itemX: it.x,
                        itemY: it.y,
                      }
                      itemInteractionRef.current.type = 'drag'
                      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                    }}
                    onPointerMove={(e) => {
                      if (!itemDragRef.current || itemDragRef.current.id !== it.id) return
                      const dx = (e.clientX - itemDragRef.current.startX) / scale
                      const dy = (e.clientY - itemDragRef.current.startY) / scale
                      setItems((prev) =>
                        prev.map((p) =>
                          p.id === it.id ? { ...p, x: itemDragRef.current!.itemX + dx, y: itemDragRef.current!.itemY + dy } : p
                        )
                      )
                    }}
                    onPointerUp={(e) => {
                      if (itemDragRef.current?.id === it.id) {
                        itemDragRef.current = null
                        itemInteractionRef.current.type = null
                        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
                      }
                    }}
                    onPointerCancel={(e) => {
                      if (itemDragRef.current?.id === it.id) {
                        itemDragRef.current = null
                        itemInteractionRef.current.type = null
                        try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
                      }
                    }}
                  >
                    {/* Render item image */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {it.isBase ? (
                      <img
                        src={it.src}
                        alt="base"
                        style={{ width: `${contentSize.w}px`, height: "auto", display: "block" }}
                        className="rounded-md shadow"
                      />
                    ) : (
                      <img src={it.src} alt="item" className="block max-w-[40vw] max-h-[40vw] rounded-md shadow" />
                    )}
                    {/* Selection frame */}
                    {sel && !it.locked && (
                      <div className="pointer-events-none absolute inset-0 -m-1 rounded border-2 border-indigo-500"></div>
                    )}
                    {/* Resize handle (bottom-right) */}
                    {sel && !it.locked && (
                      <div
                        className="absolute right-[-10px] bottom-[-10px] h-5 w-5 cursor-se-resize rounded-full border bg-white shadow"
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          setSelectedId(it.id)
                          // distance from center to pointer sets scale baseline
                          const el = e.currentTarget.parentElement as HTMLElement
                          const parentRect = el.getBoundingClientRect()
                          itemResizeRef.current = {
                            id: it.id,
                            originScale: it.scale,
                            originSize: { w: parentRect.width, h: parentRect.height },
                            startX: e.clientX,
                            startY: e.clientY,
                          }
                          itemInteractionRef.current.type = 'resize'
                          ;(el as HTMLElement).setPointerCapture(e.pointerId)
                        }}
                        onPointerMove={(e) => {
                          const r = itemResizeRef.current
                          if (!r || r.id !== it.id) return
                          // Movement since resize start in screen space
                          const dxScreen = (e.clientX - r.startX) / Math.max(1, scale)
                          const dyScreen = (e.clientY - r.startY) / Math.max(1, scale)
                          // Project delta into the item's local axes to keep behavior intuitive when rotated
                          const theta = (it.rotation * Math.PI) / 180
                          const cosT = Math.cos(theta)
                          const sinT = Math.sin(theta)
                          // Apply inverse rotation (world -> local): R(-theta)
                          const dxLocal = dxScreen * cosT + dyScreen * sinT
                          const dyLocal = -dxScreen * sinT + dyScreen * cosT
                          const originW = r.originSize.w
                          const originH = r.originSize.h
                          // Project movement onto bottom-right diagonal in local space for intuitive resizing
                          const vnx = Math.SQRT1_2 // 1/√2
                          const vny = Math.SQRT1_2
                          const alongDiag = dxLocal * vnx + dyLocal * vny
                          const diag = Math.hypot(originW, originH)
                          const factor = Math.max(0.05, (diag + alongDiag) / Math.max(1, diag))
                          const nextScale = Math.max(0.1, Math.min(5, r.originScale * factor))
                          if (resizeRaf.current) cancelAnimationFrame(resizeRaf.current)
                          resizeRaf.current = requestAnimationFrame(() => {
                            setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, scale: nextScale } : p)))
                          })
                        }}
                        onPointerUp={(e) => {
                          if (itemResizeRef.current?.id === it.id) {
                            itemResizeRef.current = null
                            itemInteractionRef.current.type = null
                            const el = e.currentTarget.parentElement as HTMLElement
                            ;(el as HTMLElement).releasePointerCapture(e.pointerId)
                          }
                        }}
                        onPointerCancel={(e) => {
                          if (itemResizeRef.current?.id === it.id) {
                            itemResizeRef.current = null
                            itemInteractionRef.current.type = null
                            const el = e.currentTarget.parentElement as HTMLElement
                            try { (el as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
                          }
                        }}
                      />
                    )}
                    {/* Rotate handle (top-center) */}
                    {sel && !it.locked && (
                      <div
                        className="absolute left-1/2 top-[-28px] h-4 w-4 -translate-x-1/2 cursor-crosshair rounded-full border bg-white shadow"
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          setSelectedId(it.id)
                          const el = e.currentTarget.parentElement as HTMLElement
                          const rect = el.getBoundingClientRect()
                          const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
                          const startAngle = Math.atan2(e.clientY - center.y, e.clientX - center.x)
                          itemRotateRef.current = { id: it.id, center, originAngle: it.rotation, startAngle }
                          itemInteractionRef.current.type = 'rotate'
                          ;(el as HTMLElement).setPointerCapture(e.pointerId)
                        }}
                        onPointerMove={(e) => {
                          const r = itemRotateRef.current
                          if (!r || r.id !== it.id) return
                          const ang = Math.atan2(e.clientY - r.center.y, e.clientX - r.center.x)
                          const delta = ((ang - r.startAngle) * 180) / Math.PI
                          setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, rotation: r.originAngle + delta } : p)))
                        }}
                        onPointerUp={(e) => {
                          if (itemRotateRef.current?.id === it.id) {
                            itemRotateRef.current = null
                            itemInteractionRef.current.type = null
                            const el = e.currentTarget.parentElement as HTMLElement
                            ;(el as HTMLElement).releasePointerCapture(e.pointerId)
                          }
                        }}
                        onPointerCancel={(e) => {
                          if (itemRotateRef.current?.id === it.id) {
                            itemRotateRef.current = null
                            itemInteractionRef.current.type = null
                            const el = e.currentTarget.parentElement as HTMLElement
                            try { (el as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
                          }
                        }}
                      />
                    )}
                  </div>
                )
              })}
          </div>

          {/* Title overlay (moves with content) */}
          {formData.customName && (
            <div className="absolute left-3 top-3 rounded bg-white/80 px-2 py-1">
              <Text size="small" weight="plus" className="truncate max-w-[60vw]">
                {formData.customName}
              </Text>
            </div>
          )}

          {/* Hotspot markers (move/zoom with image) */}
          {hotspots.map((h) => (
            <button
              key={h.key}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setActiveHotspot(activeHotspot === h.key ? null : h.key)
              }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border bg-white/90 px-2 py-1 text-xs shadow hover:bg-white ${
                activeHotspot === h.key ? "ring-2 ring-indigo-500" : ""
              }`}
              style={{ left: `${h.x}%`, top: `${h.y}%` }}
              aria-label={`Edit ${h.label}`}
            >
              {h.label}
            </button>
          ))}
          </div>

          {/* Fixed Name Prompt Overlay (does not move/zoom) */}
          {!formData.customName && (
            <div className="pointer-events-auto absolute inset-0 z-30 grid place-items-center bg-white/60 backdrop-blur-sm">
              <div className="w-full max-w-md rounded-md border bg-white p-4 shadow-lg">
                <div className="mb-2">
                  <Text weight="plus">Name your design</Text>
                  <Text size="small" className="text-gray-600">Give your design a simple, clear name.</Text>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="designName">Design name</Label>
                  <Input
                    id="designName"
                    autoFocus
                    value={formData.customName}
                    onChange={(e) => setFormData({ ...formData, customName: e.target.value })}
                    placeholder="e.g., Summer Breeze Shirt"
                  />
                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setFormData({ ...formData, customName: "Untitled Design" })}
                    >
                      Skip
                    </Button>
                    <Button type="button" disabled={!formData.customName.trim()} onClick={() => void 0}>
                      Continue
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Fixed Inspector Panel (does not move/zoom) */}
          {activeHotspot && (
            <div className="pointer-events-auto absolute right-4 top-1/2 z-30 w-64 -translate-y-1/2 rounded-md border bg-white p-4 shadow-lg">
              {(() => {
                const h = hotspots.find((x) => x.key === activeHotspot)
                if (!h) return null
                return (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <Text weight="plus">{h.label}</Text>
                      <Button variant="secondary" size="small" type="button" onClick={() => setActiveHotspot(null)}>
                        Close
                      </Button>
                    </div>
                    {h.type === "select" && h.key === "buttonType" && (
                      <Select
                        value={formData.buttonType}
                        onValueChange={(v) => setFormData({ ...formData, buttonType: v })}
                      >
                        <Select.Trigger>
                          <Select.Value placeholder="Choose" />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="Standard">Standard</Select.Item>
                          <Select.Item value="Wooden">Wooden</Select.Item>
                          <Select.Item value="Metallic">Metallic</Select.Item>
                        </Select.Content>
                      </Select>
                    )}
                    {h.type === "select" && h.key === "material" && (
                      <Select
                        value={formData.material}
                        onValueChange={(v) => setFormData({ ...formData, material: v })}
                      >
                        <Select.Trigger>
                          <Select.Value placeholder="Choose" />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="Cotton">Cotton</Select.Item>
                          <Select.Item value="Linen">Linen</Select.Item>
                          <Select.Item value="Polyester">Polyester</Select.Item>
                        </Select.Content>
                      </Select>
                    )}
                    {h.type === "color" && (
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={formData.color}
                          onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                          className="h-8 w-12 cursor-pointer rounded border"
                        />
                        <Input readOnly value={formData.color} className="font-mono" />
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          )}

          {/* Fixed Toolbar (does not move/zoom) */}
          <div className="pointer-events-auto absolute left-4 top-4 z-30 flex gap-2 rounded-md border bg-white p-2 shadow">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onAddImageFile(f)
                e.currentTarget.value = ""
              }}
            />
            <Button size="small" onClick={() => fileInputRef.current?.click()}>Add Image</Button>
            <Button size="small" variant="secondary" onClick={bringForward} disabled={!selectedId}>
              Bring Forward
            </Button>
            <Button size="small" variant="secondary" onClick={sendBackward} disabled={!selectedId}>
              Send Backward
            </Button>
            <Button size="small" variant="secondary" onClick={toggleLock} disabled={!selectedId}>
              {(() => {
                const it = items.find((i) => i.id === selectedId)
                return it?.locked ? "Unlock" : "Lock"
              })()}
            </Button>
            <Button size="small" variant="danger" onClick={deleteItem} disabled={!selectedId}>
              Delete
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default DesignEditorForm
