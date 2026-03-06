/**
 * HangTagCanvasEditor
 *
 * SVG-based interactive canvas for hang tag design.
 * Supports both free-form elements and interactive template elements.
 * All coordinates are in mm matching the tag dimensions.
 */

import { useCallback, useRef, useState } from "react"
import { Button, Input, Label, Switch, Text } from "@medusajs/ui"
import { Trash } from "@medusajs/icons"
import { CanvasEl, CanvasElType, HangTagConfig, LayoutPos, makeEl } from "../../hooks/api/hang-tag-settings"
import ProductMediaModal from "../media/product-media-modal"

// ── Types ─────────────────────────────────────────────────────────────────────

type Tool = "select" | CanvasElType

export type TemplateEl = {
  id: string
  label: string
  x: number
  y: number
  w: number
  h: number
  r?: number
  /** Config keys to show in the template properties panel */
  configKeys: (keyof HangTagConfig)[]
  /** If set, element can be toggled visible/hidden via this config key */
  showKey?: keyof HangTagConfig
}

interface Props {
  cfg: HangTagConfig
  onCfgChange: (patch: Partial<HangTagConfig>) => void
  templateEls: TemplateEl[]
  onLayoutChange: (id: string, pos: { x?: number; y?: number }) => void
  onResetElementLayout: (id: string) => void
  elements: CanvasEl[]
  onChange: (elements: CanvasEl[]) => void
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

// ── Shared form primitives ─────────────────────────────────────────────────────

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

// ── Free-form element properties panel ────────────────────────────────────────

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

// ── Template element properties panel ─────────────────────────────────────────

const CONFIG_KEY_LABELS: Partial<Record<keyof HangTagConfig, string>> = {
  header_color: "Band color",
  header_text_color: "Text color",
  accent_color: "Accent color",
  brand_name: "Brand name",
  tagline: "Tagline text",
  scan_label: "QR caption",
  logo_url: "Logo image",
  show_punch_hole: "Show punch hole",
  show_status_badge: "Show status badge",
  show_design_info: "Show design info",
  show_partner_info: "Show partner info",
  show_color_palette: "Show color palette",
  show_design_tags: "Show design tags",
  show_collaborators: "Show collaborators",
  show_qr_code: "Show QR code",
  show_tagline: "Show tagline",
}

function TemplatePropertiesPanel({
  el,
  cfg,
  onCfgChange,
  onLayoutChange,
  onResetPosition,
}: {
  el: TemplateEl
  cfg: HangTagConfig
  onCfgChange: (patch: Partial<HangTagConfig>) => void
  onLayoutChange: (id: string, pos: { x?: number; y?: number }) => void
  onResetPosition: (id: string) => void
}) {
  const [mediaOpen, setMediaOpen] = useState(false)

  return (
    <div className="flex flex-col gap-y-2 border-t border-ui-border-base pt-3 mt-2">
      <div className="flex items-center justify-between">
        <Text size="xsmall" weight="plus">
          {el.label}
        </Text>
        <Button
          variant="transparent"
          size="small"
          onClick={() => onResetPosition(el.id)}
          className="text-ui-fg-subtle hover:text-ui-fg-base text-[11px] h-6 px-1"
        >
          Reset pos
        </Button>
      </div>

      {/* Position */}
      <PropRow label="X (mm)">
        <NumberInput value={Math.round(el.x * 10) / 10} onChange={(v) => onLayoutChange(el.id, { x: v })} />
      </PropRow>
      <PropRow label="Y (mm)">
        <NumberInput value={Math.round(el.y * 10) / 10} onChange={(v) => onLayoutChange(el.id, { y: v })} />
      </PropRow>

      {/* Config key controls */}
      {el.configKeys.map((key) => {
        const keyStr = key as string
        const label = CONFIG_KEY_LABELS[key] ?? keyStr

        if (keyStr.startsWith("show_")) {
          return (
            <PropRow key={keyStr} label={label}>
              <Switch
                checked={!!(cfg[key] as boolean)}
                onCheckedChange={(v) => onCfgChange({ [key]: v })}
              />
            </PropRow>
          )
        }

        if (keyStr.endsWith("_color")) {
          return (
            <PropRow key={keyStr} label={label}>
              <ColorInput
                value={(cfg[key] as string) || "#000000"}
                onChange={(v) => onCfgChange({ [key]: v })}
              />
            </PropRow>
          )
        }

        if (key === "logo_url") {
          return (
            <PropRow key={keyStr} label={label}>
              <Button
                variant="secondary"
                size="small"
                onClick={() => setMediaOpen(true)}
                className="w-full text-xs h-7"
              >
                {cfg.logo_url ? "Change logo" : "Choose logo"}
              </Button>
            </PropRow>
          )
        }

        // Default: text input
        return (
          <PropRow key={keyStr} label={label}>
            <Input
              value={(cfg[key] as string) ?? ""}
              onChange={(e) => onCfgChange({ [key]: e.target.value })}
              className="h-7 text-xs"
            />
          </PropRow>
        )
      })}

      {/* Logo media modal */}
      {el.configKeys.includes("logo_url") && (
        <>
          {cfg.logo_url && (
            <img src={cfg.logo_url} alt="" className="h-12 w-full object-contain rounded border border-ui-border-base" />
          )}
          <ProductMediaModal
            open={mediaOpen}
            onOpenChange={setMediaOpen}
            initialUrls={cfg.logo_url ? [cfg.logo_url] : []}
            onSave={(urls) => {
              if (urls[0]) onCfgChange({ logo_url: urls[0] })
              setMediaOpen(false)
            }}
          />
        </>
      )}
    </div>
  )
}

// ── Template element visual rendering ─────────────────────────────────────────

function renderTemplateEl(
  el: TemplateEl,
  cfg: HangTagConfig,
  isSelected: boolean,
  tool: Tool,
  onPointerDown: (e: React.PointerEvent<SVGElement>, el: TemplateEl) => void
): React.ReactNode {
  const isHidden = el.showKey ? !cfg[el.showKey as keyof HangTagConfig] : false
  const elOpacity = isHidden ? 0.3 : 1
  const cursor = tool === "select" ? ("move" as const) : ("default" as const)

  // Hit area bounds
  const isCircle = el.r !== undefined
  const hitX = isCircle ? el.x - (el.r ?? 0) - 0.5 : el.x - 0.5
  const hitY = isCircle ? el.y - (el.r ?? 0) - 0.5 : el.y - 0.5
  const hitW = isCircle ? (el.r ?? 0) * 2 + 1 : Math.max(el.w, 2) + 1
  const hitH = isCircle ? (el.r ?? 0) * 2 + 1 : Math.max(el.h, 2) + 1

  // Visual content
  let visual: React.ReactNode

  if (el.id === "punch-hole") {
    const r = el.r ?? 2.2
    visual = (
      <>
        <circle cx={el.x} cy={el.y} r={r + 0.25} fill={cfg.header_color || "#111"} style={{ pointerEvents: "none" }} />
        <circle cx={el.x} cy={el.y} r={r} fill="#e4e4e4" stroke="#bbb" strokeWidth={0.15} style={{ pointerEvents: "none" }} />
      </>
    )
  } else if (el.id === "band" || el.id === "strip") {
    visual = (
      <rect x={el.x} y={el.y} width={el.w} height={el.h} fill={cfg.header_color || "#111"} style={{ pointerEvents: "none" }} />
    )
  } else if (el.id === "logo") {
    visual = cfg.logo_url ? (
      <image href={cfg.logo_url} x={el.x} y={el.y} width={el.w} height={el.h} preserveAspectRatio="xMidYMid meet" style={{ pointerEvents: "none" }} />
    ) : (
      <text x={el.x + el.w / 2} y={el.y + el.h / 2 + 1.5} textAnchor="middle" fontSize={3} fontWeight="bold" fill={cfg.header_text_color || "#fff"} fontFamily="sans-serif" style={{ pointerEvents: "none" }}>
        {cfg.brand_name || "BRAND"}
      </text>
    )
  } else if (el.id === "brand-text") {
    visual = (
      <text x={el.x} y={el.y + el.h * 0.75} fontSize={2} fontWeight="bold" fill={cfg.header_text_color || "#fff"} fontFamily="sans-serif" style={{ pointerEvents: "none" }}>
        {cfg.brand_name || "BRAND"}
      </text>
    )
  } else if (el.id === "title") {
    visual = (
      <text x={el.x} y={el.y + el.h * 0.75} textAnchor="middle" fontSize={3} fontWeight="bold" fill="#111" fontFamily="sans-serif" style={{ pointerEvents: "none" }}>
        Product Title
      </text>
    )
  } else if (el.id === "status-badge") {
    visual = (
      <>
        <rect x={el.x} y={el.y} width={el.w} height={el.h} fill={cfg.accent_color || "#eee"} rx={0.5} style={{ pointerEvents: "none" }} />
        <text x={el.x + el.w / 2} y={el.y + el.h * 0.72} textAnchor="middle" fontSize={2} fill="#555" fontFamily="sans-serif" style={{ pointerEvents: "none" }}>Published</text>
      </>
    )
  } else if (el.id === "divider") {
    visual = (
      <line x1={el.x} y1={el.y} x2={el.x + el.w} y2={el.y} stroke={cfg.accent_color || "#eee"} strokeWidth={0.2} style={{ pointerEvents: "none" }} />
    )
  } else if (el.id === "tagline") {
    visual = (
      <text x={el.x} y={el.y + el.h * 0.75} textAnchor="middle" fontSize={2} fill="#aaa" fontFamily="sans-serif" fontStyle="italic" style={{ pointerEvents: "none" }}>
        {cfg.tagline || "(tagline)"}
      </text>
    )
  } else if (el.id === "scan-label") {
    visual = (
      <text x={el.x} y={el.y + el.h * 0.75} textAnchor="middle" fontSize={2} fill="#bbb" fontFamily="sans-serif" fontStyle="italic" style={{ pointerEvents: "none" }}>
        {cfg.scan_label || "scan me"}
      </text>
    )
  } else if (el.id === "qr-code") {
    visual = (
      <>
        <rect x={el.x} y={el.y} width={el.w} height={el.h} fill={cfg.accent_color || "#eee"} rx={0.5} style={{ pointerEvents: "none" }} />
        <text x={el.x + el.w / 2} y={el.y + el.h / 2 + 1.5} textAnchor="middle" fontSize={3} fill="#aaa" fontFamily="sans-serif" style={{ pointerEvents: "none" }}>QR</text>
      </>
    )
  } else {
    // Generic placeholder (design-info, partner-info, palette, design-tags, collaborators)
    visual = (
      <>
        <rect x={el.x} y={el.y} width={el.w} height={el.h} fill="none" stroke="#ddd" strokeWidth={0.2} strokeDasharray="1,1" rx={0.3} style={{ pointerEvents: "none" }} />
        <text x={el.x + 1} y={el.y + Math.min(el.h * 0.7, 3)} fontSize={2} fill="#ccc" fontFamily="sans-serif" style={{ pointerEvents: "none" }}>
          {el.label}
        </text>
      </>
    )
  }

  return (
    <g key={el.id} style={{ opacity: elOpacity }}>
      {visual}
      {/* Selection outline */}
      {isSelected && (
        <rect
          x={hitX} y={hitY}
          width={hitW} height={hitH}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={0.4}
          strokeDasharray="1.5,1"
          style={{ pointerEvents: "none" }}
        />
      )}
      {/* Transparent hit area */}
      <rect
        x={hitX} y={hitY}
        width={hitW} height={hitH}
        fill="transparent"
        style={{ cursor, opacity: 0 }}
        onPointerDown={(e) => onPointerDown(e, el)}
      />
    </g>
  )
}

// ── Main editor ───────────────────────────────────────────────────────────────

export function HangTagCanvasEditor({
  cfg,
  onCfgChange,
  templateEls,
  onLayoutChange,
  onResetElementLayout,
  elements,
  onChange,
}: Props) {
  const [tool, setTool] = useState<Tool>("select")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Drag state stored in a ref (no re-render on move)
  const drag = useRef<{
    id: string
    isTemplate: boolean
    startMx: number
    startMy: number
    elemX: number
    elemY: number
  } | null>(null)

  const selectedFreeEl = elements.find((e) => e.id === selectedId) ?? null
  const selectedTemplateEl = templateEls.find((e) => e.id === selectedId) ?? null

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
    if (tool === "image") return
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
    drag.current = { id, isTemplate: false, startMx: e.clientX, startMy: e.clientY, elemX, elemY }
  }

  const onTemplateElemPointerDown = (
    e: React.PointerEvent<SVGElement>,
    el: TemplateEl
  ) => {
    if (tool !== "select") return
    e.stopPropagation()
    setSelectedId(el.id)
    ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
    drag.current = { id: el.id, isTemplate: true, startMx: e.clientX, startMy: e.clientY, elemX: el.x, elemY: el.y }
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
    const pos = { x: Math.round(newX * 10) / 10, y: Math.round(newY * 10) / 10 }
    if (drag.current.isTemplate) {
      onLayoutChange(drag.current.id, pos)
    } else {
      update(drag.current.id, pos)
    }
  }

  const onSvgPointerUp = () => {
    drag.current = null
  }

  // ── Keyboard handler ───────────────────────────────────────────────────────

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === "Delete" || e.key === "Backspace") && selectedId && !selectedTemplateEl) {
      e.preventDefault()
      deleteEl(selectedId)
    }
    if (e.key === "Escape") {
      setSelectedId(null)
      setTool("select")
    }
  }

  // ── Render free-form element ────────────────────────────────────────────────

  function renderEl(el: CanvasEl) {
    const isSelected = el.id === selectedId
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
              fontSize={(el.fontSize ?? 8) * 0.352778}
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
          {/* White background */}
          <rect width={cfg.width_mm} height={cfg.height_mm} fill="#fff" style={{ pointerEvents: "none" }} />

          {/* Template elements — rendered below free-form elements */}
          {templateEls.map((el) =>
            renderTemplateEl(el, cfg, el.id === selectedId, tool, onTemplateElemPointerDown)
          )}

          {/* Free-form canvas elements */}
          {elements.map(renderEl)}
        </svg>
      </div>

      {/* Properties panel for selected free-form element */}
      {selectedFreeEl && (
        <PropertiesPanel
          el={selectedFreeEl}
          onUpdate={(patch) => update(selectedFreeEl.id, patch)}
          onDelete={() => deleteEl(selectedFreeEl.id)}
        />
      )}

      {/* Properties panel for selected template element */}
      {selectedTemplateEl && (
        <TemplatePropertiesPanel
          el={selectedTemplateEl}
          cfg={cfg}
          onCfgChange={onCfgChange}
          onLayoutChange={onLayoutChange}
          onResetPosition={onResetElementLayout}
        />
      )}

      {!selectedFreeEl && !selectedTemplateEl && (
        <Text size="xsmall" className="text-ui-fg-muted text-center py-2">
          Click a template element to configure it, or pick a tool to add new elements
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
