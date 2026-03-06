/**
 * HangTagCanvasEditor
 *
 * SVG-based interactive canvas for free-form hang tag design.
 * Elements are stored in mm coordinates matching the tag dimensions.
 * Pointer events handle drag-to-move. Properties panel handles resize.
 */

import { useCallback, useRef, useState } from "react"
import { Button, Input, Label, Text } from "@medusajs/ui"
import { Plus, Trash, PencilSquare } from "@medusajs/icons"
import { CanvasEl, CanvasElType, HangTagConfig, makeEl } from "../../hooks/api/hang-tag-settings"
import ProductMediaModal from "../media/product-media-modal"

// ── Types ─────────────────────────────────────────────────────────────────────

type Tool = "select" | CanvasElType

interface Props {
  cfg: HangTagConfig
  /** All elements on this canvas side */
  elements: CanvasEl[]
  onChange: (elements: CanvasEl[]) => void
  /** Render the static tag template as SVG background */
  background: React.ReactNode
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

function svgMm(
  e: React.PointerEvent<SVGSVGElement>,
  svgEl: SVGSVGElement,
  W_mm: number,
  H_mm: number
): { x: number; y: number } {
  const rect = svgEl.getBoundingClientRect()
  return {
    x: clamp(((e.clientX - rect.left) / rect.width) * W_mm, 0, W_mm),
    y: clamp(((e.clientY - rect.top) / rect.height) * H_mm, 0, H_mm),
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ToolBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded text-xs transition-colors ${
        active
          ? "bg-ui-bg-interactive text-ui-fg-on-inverted"
          : "bg-ui-bg-base text-ui-fg-base border border-ui-border-base hover:bg-ui-bg-hover"
      }`}
    >
      {children}
    </button>
  )
}

// ── Properties panel ──────────────────────────────────────────────────────────

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-x-2">
      <span className="w-16 shrink-0 text-[11px] text-ui-fg-subtle">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

function NumberInput({
  value,
  onChange,
  min = 0,
  max = 9999,
  step = 0.5,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <Input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-7 text-xs"
    />
  )
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-x-1">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-7 cursor-pointer rounded border border-ui-border-base p-0.5"
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 font-mono text-[11px]"
      />
    </div>
  )
}

function PropertiesPanel({
  el,
  onUpdate,
  onDelete,
}: {
  el: CanvasEl
  onUpdate: (patch: Partial<CanvasEl>) => void
  onDelete: () => void
}) {
  const [mediaOpen, setMediaOpen] = useState(false)

  return (
    <div className="flex flex-col gap-y-2 border-t border-ui-border-base pt-3 mt-2">
      <div className="flex items-center justify-between">
        <Text size="xsmall" weight="plus" className="capitalize">
          {el.type} properties
        </Text>
        <Button variant="transparent" size="small" onClick={onDelete} className="text-ui-fg-error hover:text-ui-fg-error px-1">
          <Trash className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Position */}
      <PropRow label="X (mm)">
        <NumberInput value={Math.round(el.x * 10) / 10} onChange={(v) => onUpdate({ x: v })} />
      </PropRow>
      <PropRow label="Y (mm)">
        <NumberInput value={Math.round(el.y * 10) / 10} onChange={(v) => onUpdate({ y: v })} />
      </PropRow>

      {/* Size — rect / image */}
      {(el.type === "rect" || el.type === "image") && (
        <>
          <PropRow label="W (mm)">
            <NumberInput value={el.w} onChange={(v) => onUpdate({ w: v })} min={1} />
          </PropRow>
          <PropRow label="H (mm)">
            <NumberInput value={el.h} onChange={(v) => onUpdate({ h: v })} min={1} />
          </PropRow>
        </>
      )}

      {/* Radius — circle */}
      {el.type === "circle" && (
        <PropRow label="R (mm)">
          <NumberInput value={el.r ?? 5} onChange={(v) => onUpdate({ r: v })} min={0.5} />
        </PropRow>
      )}

      {/* Text fields */}
      {el.type === "text" && (
        <>
          <PropRow label="Text">
            <Input
              value={el.text ?? ""}
              onChange={(e) => onUpdate({ text: e.target.value })}
              className="h-7 text-xs"
            />
          </PropRow>
          <PropRow label="Size (pt)">
            <NumberInput value={el.fontSize ?? 8} onChange={(v) => onUpdate({ fontSize: v })} min={4} max={72} />
          </PropRow>
          <PropRow label="Color">
            <ColorInput value={el.color ?? "#111111"} onChange={(v) => onUpdate({ color: v })} />
          </PropRow>
          <div className="flex gap-x-2">
            <button
              onClick={() => onUpdate({ bold: !el.bold })}
              className={`px-2 py-0.5 rounded border text-xs font-bold transition-colors ${el.bold ? "bg-ui-bg-interactive text-ui-fg-on-inverted border-ui-border-interactive" : "bg-ui-bg-base border-ui-border-base hover:bg-ui-bg-hover"}`}
            >
              B
            </button>
            <button
              onClick={() => onUpdate({ italic: !el.italic })}
              className={`px-2 py-0.5 rounded border text-xs italic transition-colors ${el.italic ? "bg-ui-bg-interactive text-ui-fg-on-inverted border-ui-border-interactive" : "bg-ui-bg-base border-ui-border-base hover:bg-ui-bg-hover"}`}
            >
              I
            </button>
          </div>
        </>
      )}

      {/* Fill — rect / circle */}
      {(el.type === "rect" || el.type === "circle") && (
        <>
          <PropRow label="Fill">
            <ColorInput value={el.fill ?? "#eeeeee"} onChange={(v) => onUpdate({ fill: v })} />
          </PropRow>
          <PropRow label="Stroke">
            <ColorInput value={el.color ?? "#cccccc"} onChange={(v) => onUpdate({ color: v })} />
          </PropRow>
          <PropRow label="Stroke w">
            <NumberInput value={el.strokeWidth ?? 0.5} onChange={(v) => onUpdate({ strokeWidth: v })} min={0} max={5} step={0.1} />
          </PropRow>
        </>
      )}

      {/* Image URL */}
      {el.type === "image" && (
        <>
          <PropRow label="Image">
            <Button
              variant="secondary"
              size="small"
              onClick={() => setMediaOpen(true)}
              className="w-full text-xs h-7"
            >
              {el.url ? "Change image" : "Choose image"}
            </Button>
          </PropRow>
          {el.url && (
            <img src={el.url} alt="" className="h-16 w-full object-contain rounded border border-ui-border-base" />
          )}
          <ProductMediaModal
            open={mediaOpen}
            onOpenChange={setMediaOpen}
            initialUrls={el.url ? [el.url] : []}
            onSave={(urls) => {
              if (urls[0]) onUpdate({ url: urls[0] })
              setMediaOpen(false)
            }}
          />
        </>
      )}

      {/* Opacity */}
      <PropRow label="Opacity">
        <NumberInput value={Math.round((el.opacity ?? 1) * 100)} onChange={(v) => onUpdate({ opacity: v / 100 })} min={0} max={100} step={5} />
      </PropRow>
    </div>
  )
}

// ── Main editor ───────────────────────────────────────────────────────────────

export function HangTagCanvasEditor({ cfg, elements, onChange, background }: Props) {
  const [tool, setTool] = useState<Tool>("select")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Drag state stored in a ref (no re-render on move)
  const drag = useRef<{
    id: string
    startMx: number   // mouse X at drag start
    startMy: number   // mouse Y at drag start
    elemX: number     // element x at drag start (mm)
    elemY: number     // element y at drag start (mm)
  } | null>(null)

  const selected = elements.find((e) => e.id === selectedId) ?? null

  const update = useCallback(
    (id: string, patch: Partial<CanvasEl>) => {
      onChange(elements.map((e) => (e.id === id ? { ...e, ...patch } : e)))
    },
    [elements, onChange]
  )

  const deleteEl = useCallback(
    (id: string) => {
      onChange(elements.filter((e) => e.id !== id))
      setSelectedId(null)
    },
    [elements, onChange]
  )

  // ── Pointer handlers on SVG ────────────────────────────────────────────────

  const onSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (tool === "select") return
    if (!svgRef.current) return
    e.stopPropagation()
    const { x, y } = svgMm(e, svgRef.current, cfg.width_mm, cfg.height_mm)
    if (tool === "image") {
      // image needs media picker — handled by toolbar button directly
      return
    }
    const el = makeEl(tool, x, y)
    onChange([...elements, el])
    setSelectedId(el.id)
    setTool("select")
  }

  const onElemPointerDown = (
    e: React.PointerEvent<SVGElement>,
    id: string,
    elemX: number,
    elemY: number
  ) => {
    if (tool !== "select") return
    e.stopPropagation()
    setSelectedId(id)
    ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
    drag.current = { id, startMx: e.clientX, startMy: e.clientY, elemX, elemY }
  }

  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag.current || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const scaleX = cfg.width_mm / rect.width
    const scaleY = cfg.height_mm / rect.height
    const dx = (e.clientX - drag.current.startMx) * scaleX
    const dy = (e.clientY - drag.current.startMy) * scaleY
    const newX = clamp(drag.current.elemX + dx, 0, cfg.width_mm)
    const newY = clamp(drag.current.elemY + dy, 0, cfg.height_mm)
    update(drag.current.id, { x: Math.round(newX * 10) / 10, y: Math.round(newY * 10) / 10 })
  }

  const onSvgPointerUp = () => {
    drag.current = null
  }

  // ── Keyboard handler ───────────────────────────────────────────────────────

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
      e.preventDefault()
      deleteEl(selectedId)
    }
    if (e.key === "Escape") {
      setSelectedId(null)
      setTool("select")
    }
  }

  // ── Render element ─────────────────────────────────────────────────────────

  function renderEl(el: CanvasEl) {
    const isSelected = el.id === selectedId
    const W = cfg.width_mm
    const H = cfg.height_mm
    // Normalize coords to viewBox 0..W, 0..H (in mm, but SVG viewBox is also in mm units here)
    const sel = isSelected
      ? { outline: "2px solid #3b82f6", cursor: "move" as const }
      : { cursor: tool === "select" ? ("move" as const) : ("crosshair" as const) }

    const commonProps = {
      style: { cursor: sel.cursor, opacity: el.opacity ?? 1 },
      onPointerDown: (e: React.PointerEvent<SVGElement>) =>
        onElemPointerDown(e, el.id, el.x, el.y),
    }

    switch (el.type) {
      case "text":
        return (
          <g key={el.id}>
            {isSelected && (
              <rect
                x={el.x - 0.5}
                y={el.y - (el.fontSize ?? 8) * 0.352778 - 0.5}
                width={el.w + 1}
                height={(el.fontSize ?? 8) * 0.352778 * 1.4 + 1}
                fill="none"
                stroke="#3b82f6"
                strokeWidth={0.3}
                strokeDasharray="1,1"
              />
            )}
            <text
              x={el.x}
              y={el.y}
              fontSize={(el.fontSize ?? 8) * 0.352778} // pt → mm
              fontWeight={el.bold ? "bold" : "normal"}
              fontStyle={el.italic ? "italic" : "normal"}
              fill={el.color ?? "#111111"}
              fontFamily="sans-serif"
              {...commonProps}
            >
              {el.text ?? "Text"}
            </text>
          </g>
        )

      case "rect":
        return (
          <rect
            key={el.id}
            x={el.x}
            y={el.y}
            width={el.w}
            height={el.h}
            fill={el.fill ?? "#eeeeee"}
            stroke={isSelected ? "#3b82f6" : (el.color ?? "none")}
            strokeWidth={isSelected ? 0.4 : (el.strokeWidth ?? 0)}
            rx={0.5}
            {...commonProps}
          />
        )

      case "circle":
        return (
          <circle
            key={el.id}
            cx={el.x}
            cy={el.y}
            r={el.r ?? 5}
            fill={el.fill ?? "#eeeeee"}
            stroke={isSelected ? "#3b82f6" : (el.color ?? "none")}
            strokeWidth={isSelected ? 0.4 : (el.strokeWidth ?? 0)}
            {...commonProps}
          />
        )

      case "image":
        return (
          <g key={el.id}>
            {isSelected && (
              <rect
                x={el.x - 0.5}
                y={el.y - 0.5}
                width={el.w + 1}
                height={el.h + 1}
                fill="none"
                stroke="#3b82f6"
                strokeWidth={0.4}
                strokeDasharray="1.5,1"
              />
            )}
            {el.url ? (
              <image
                href={el.url}
                x={el.x}
                y={el.y}
                width={el.w}
                height={el.h}
                preserveAspectRatio="xMidYMid meet"
                {...commonProps}
              />
            ) : (
              <rect
                x={el.x}
                y={el.y}
                width={el.w}
                height={el.h}
                fill="#f3f4f6"
                stroke="#d1d5db"
                strokeWidth={0.3}
                {...commonProps}
              />
            )}
          </g>
        )
    }
  }

  // ── Image tool — opens media modal directly ────────────────────────────────

  const [imageModalOpen, setImageModalOpen] = useState(false)

  const addImageEl = (url: string) => {
    const el = makeEl("image", cfg.width_mm / 2 - 10, cfg.height_mm / 2 - 10)
    el.url = url
    onChange([...elements, el])
    setSelectedId(el.id)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col gap-y-2 outline-none"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-x-1 flex-wrap">
        <ToolBtn active={tool === "select"} onClick={() => setTool("select")} title="Select / move (V)">
          <svg viewBox="0 0 12 12" className="h-3 w-3 fill-current"><path d="M2 1l8 5-4.5 1L4 11 2 1z"/></svg>
        </ToolBtn>
        <ToolBtn active={tool === "text"} onClick={() => setTool("text")} title="Add text (T)">
          <span className="font-bold leading-none">T</span>
        </ToolBtn>
        <ToolBtn active={tool === "rect"} onClick={() => setTool("rect")} title="Add rectangle (R)">
          <svg viewBox="0 0 12 12" className="h-3 w-3"><rect x="1" y="2" width="10" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
        </ToolBtn>
        <ToolBtn active={tool === "circle"} onClick={() => setTool("circle")} title="Add circle (C)">
          <svg viewBox="0 0 12 12" className="h-3 w-3"><circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
        </ToolBtn>
        <ToolBtn active={false} onClick={() => setImageModalOpen(true)} title="Add image (I)">
          <svg viewBox="0 0 12 12" className="h-3 w-3"><rect x="1" y="1" width="10" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/><circle cx="4" cy="4.5" r="1" fill="currentColor"/><path d="M1 8.5l3-3 2.5 2.5 2-2 3 3" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
        </ToolBtn>

        {elements.length > 0 && (
          <>
            <div className="ml-auto flex items-center gap-x-1">
              <Text size="xsmall" className="text-ui-fg-subtle">{elements.length} element{elements.length !== 1 ? "s" : ""}</Text>
              <Button
                variant="transparent"
                size="small"
                onClick={() => { onChange([]); setSelectedId(null) }}
                className="text-ui-fg-subtle hover:text-ui-fg-error text-[11px] h-6 px-1"
              >
                Clear all
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Tool hint */}
      {tool !== "select" && (
        <Text size="xsmall" className="text-ui-fg-muted italic">
          {tool === "image" ? "Picking image from media…" : `Click on the canvas to place ${tool}`}
        </Text>
      )}

      {/* Canvas SVG */}
      <div className="relative rounded border border-ui-border-base overflow-hidden"
           style={{ cursor: tool !== "select" && tool !== "image" ? "crosshair" : "default" }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${cfg.width_mm} ${cfg.height_mm}`}
          style={{ display: "block", width: "100%", aspectRatio: `${cfg.width_mm} / ${cfg.height_mm}` }}
          onPointerDown={onSvgPointerDown}
          onPointerMove={onSvgPointerMove}
          onPointerUp={onSvgPointerUp}
        >
          {/* Tag template background — passed from parent */}
          {background}

          {/* Canvas elements */}
          {elements.map(renderEl)}
        </svg>
      </div>

      {/* Properties panel for selected element */}
      {selected && (
        <PropertiesPanel
          el={selected}
          onUpdate={(patch) => update(selected.id, patch)}
          onDelete={() => deleteEl(selected.id)}
        />
      )}

      {!selected && elements.length === 0 && (
        <Text size="xsmall" className="text-ui-fg-muted text-center py-2">
          Pick a tool above and click the canvas to add elements
        </Text>
      )}

      {/* Image media modal */}
      <ProductMediaModal
        open={imageModalOpen}
        onOpenChange={setImageModalOpen}
        initialUrls={[]}
        onSave={(urls) => {
          if (urls[0]) addImageEl(urls[0])
          setImageModalOpen(false)
          setTool("select")
        }}
      />
    </div>
  )
}

export default HangTagCanvasEditor
