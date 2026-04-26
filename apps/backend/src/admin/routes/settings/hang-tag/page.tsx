import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Button,
  Container,
  FocusModal,
  Heading,
  Input,
  Label,
  Switch,
  Text,
  toast,
} from "@medusajs/ui"
import { Tag } from "@medusajs/icons"
import { useEffect, useState } from "react"
import {
  CanvasEl,
  DEFAULT_HANG_TAG_CONFIG,
  HangTagConfig,
  computeFrontLayout,
  computeBackLayout,
  useHangTagSettings,
  useUpdateHangTagSettings,
} from "../../../hooks/api/hang-tag-settings"
import { HangTagCanvasEditor, TemplateEl } from "../../../components/hang-tag/canvas-editor"
import ProductMediaModal from "../../../components/media/product-media-modal"

// ── SVG hang tag components ───────────────────────────────────────────────────

const S = 3.2
const DISPLAY_W = 148

function tagDisplayH(cfg: HangTagConfig) {
  return Math.round(DISPLAY_W * (cfg.height_mm / cfg.width_mm))
}

const HOLE_R = 2.2 * S
const MARGIN = 4 * S

/** Render canvas elements as SVG in the preview (coordinates in mm, viewBox in S-space) */
function CanvasElsSvg({ elements }: { elements: CanvasEl[] }) {
  return (
    <>
      {elements.map((el) => {
        const op = el.opacity ?? 1
        switch (el.type) {
          case "text":
            return (
              <text
                key={el.id}
                x={el.x * S}
                y={el.y * S}
                fontSize={(el.fontSize ?? 8) * 0.352778 * S}
                fontWeight={el.bold ? "bold" : "normal"}
                fontStyle={el.italic ? "italic" : "normal"}
                fill={el.color ?? "#111111"}
                fontFamily="sans-serif"
                opacity={op}
              >
                {el.text ?? ""}
              </text>
            )
          case "rect":
            return (
              <rect
                key={el.id}
                x={el.x * S}
                y={el.y * S}
                width={el.w * S}
                height={el.h * S}
                fill={el.fill ?? "#eeeeee"}
                stroke={el.color ?? "none"}
                strokeWidth={el.strokeWidth ?? 0}
                rx={0.5 * S}
                opacity={op}
              />
            )
          case "circle":
            return (
              <circle
                key={el.id}
                cx={el.x * S}
                cy={el.y * S}
                r={(el.r ?? 5) * S}
                fill={el.fill ?? "#eeeeee"}
                stroke={el.color ?? "none"}
                strokeWidth={el.strokeWidth ?? 0}
                opacity={op}
              />
            )
          case "image":
            return el.url ? (
              <image
                key={el.id}
                href={el.url}
                x={el.x * S}
                y={el.y * S}
                width={el.w * S}
                height={el.h * S}
                preserveAspectRatio="xMidYMid meet"
                opacity={op}
              />
            ) : null
          default:
            return null
        }
      })}
    </>
  )
}

// ── Canvas elements in mm viewBox (for the editor background) ─────────────────

/** Same elements but viewBox is in mm units (for the canvas editor which uses mm directly) */
function CanvasElsMm({ elements }: { elements: CanvasEl[] }) {
  return (
    <>
      {elements.map((el) => {
        const op = el.opacity ?? 1
        switch (el.type) {
          case "text":
            return (
              <text
                key={el.id}
                x={el.x}
                y={el.y}
                fontSize={(el.fontSize ?? 8) * 0.352778}
                fontWeight={el.bold ? "bold" : "normal"}
                fontStyle={el.italic ? "italic" : "normal"}
                fill={el.color ?? "#111111"}
                fontFamily="sans-serif"
                opacity={op}
                style={{ pointerEvents: "none" }}
              >
                {el.text ?? ""}
              </text>
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
                stroke={el.color ?? "none"}
                strokeWidth={el.strokeWidth ?? 0}
                rx={0.5}
                opacity={op}
                style={{ pointerEvents: "none" }}
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
                stroke={el.color ?? "none"}
                strokeWidth={el.strokeWidth ?? 0}
                opacity={op}
                style={{ pointerEvents: "none" }}
              />
            )
          case "image":
            return el.url ? (
              <image
                key={el.id}
                href={el.url}
                x={el.x}
                y={el.y}
                width={el.w}
                height={el.h}
                preserveAspectRatio="xMidYMid meet"
                opacity={op}
                style={{ pointerEvents: "none" }}
              />
            ) : null
          default:
            return null
        }
      })}
    </>
  )
}

// ── Front side SVG ────────────────────────────────────────────────────────────

function HangTagFrontSvg({ cfg, interactive = false }: { cfg: HangTagConfig; interactive?: boolean }) {
  const W = cfg.width_mm * S
  const H = cfg.height_mm * S

  const headerBg = cfg.header_color || "#111"
  const headerFg = cfg.header_text_color || "#fff"
  const accentBg = cfg.accent_color || "#eee"

  const HOLE_CY = HOLE_R + 2.5 * S
  const BAND_Y = HOLE_CY + HOLE_R + 4 * S
  const BAND_H = cfg.height_mm * 0.26 * S
  const BAND_MID = BAND_Y + BAND_H / 2
  const brandFontSize = Math.min(11 * S / 3, BAND_H * 0.38)
  const titleFontSize = 8.5 * S / 3

  let cy = BAND_Y + BAND_H + 10 * S / 3

  return (
    <>
      <rect width={W} height={H} fill="#fff" />

      {/* Brand band */}
      <rect x={0} y={BAND_Y} width={W} height={BAND_H} fill={headerBg} />

      {/* Logo or brand name */}
      {cfg.logo_url ? (
        <image
          href={cfg.logo_url}
          x={MARGIN}
          y={BAND_Y + BAND_H * 0.1}
          width={W - MARGIN * 2}
          height={BAND_H * 0.8}
          preserveAspectRatio="xMidYMid meet"
        />
      ) : (
        <text
          x={W / 2}
          y={BAND_MID + brandFontSize * 0.36}
          textAnchor="middle"
          fontSize={brandFontSize}
          fontWeight="bold"
          fill={headerFg}
          fontFamily="sans-serif"
          letterSpacing={1.5}
        >
          {cfg.brand_name || "BRAND"}
        </text>
      )}

      {/* Punch hole */}
      {cfg.show_punch_hole && (
        <>
          <circle cx={W / 2} cy={HOLE_CY} r={HOLE_R + 0.8} fill={headerBg} />
          <circle cx={W / 2} cy={HOLE_CY} r={HOLE_R} fill="#e4e4e4" stroke="#bbb" strokeWidth={0.5} />
        </>
      )}

      {/* Product title */}
      <text x={W / 2} y={cy} textAnchor="middle" fontSize={titleFontSize} fontWeight="bold" fill="#111" fontFamily="sans-serif">
        Sample Product
      </text>

      {/* Status badge */}
      {cfg.show_status_badge && (() => {
        const bH = 3.2 * S
        const bW = 38 * S / 3
        const bX = (W - bW) / 2
        cy += titleFontSize * 1.3 + 3 * S / 3
        return (
          <g>
            <rect x={bX} y={cy} width={bW} height={bH} fill={accentBg} rx={2} />
            <text x={W / 2} y={cy + bH * 0.68} textAnchor="middle" fontSize={6 * S / 3} fill="#555" fontFamily="sans-serif">
              Published
            </text>
          </g>
        )
      })()}

      {/* Divider */}
      <line x1={W * 0.2} y1={H * 0.72} x2={W * 0.8} y2={H * 0.72} stroke={accentBg} strokeWidth={0.6} />

      {/* Tagline */}
      {cfg.show_tagline && cfg.tagline && (
        <text x={W / 2} y={H - 6 * S / 3} textAnchor="middle" fontSize={6 * S / 3} fill="#aaa" fontFamily="sans-serif" fontStyle="italic">
          {cfg.tagline}
        </text>
      )}

      {/* Canvas elements overlay */}
      <CanvasElsSvg elements={cfg.front_canvas ?? []} />
    </>
  )
}

// ── Back side SVG ─────────────────────────────────────────────────────────────

function HangTagBackSvg({ cfg }: { cfg: HangTagConfig }) {
  const W = cfg.width_mm * S
  const H = cfg.height_mm * S

  const headerBg = cfg.header_color || "#111"
  const headerFg = cfg.header_text_color || "#fff"
  const accentBg = cfg.accent_color || "#eee"

  const STRIP_H = 7 * S
  const HOLE_CY = HOLE_R + 2.5 * S

  let y = STRIP_H + 9 * S / 3

  const rows: React.ReactNode[] = []

  if (cfg.show_design_info) {
    rows.push(<text key="dlabel" x={MARGIN} y={y} fontSize={5.5 * S / 3} fontWeight="bold" fill="#999" fontFamily="sans-serif">DESIGN</text>)
    y += 3 * S
    rows.push(<text key="dname" x={MARGIN} y={y} fontSize={7.5 * S / 3} fontWeight="bold" fill="#111" fontFamily="sans-serif">Spring Collection 2026</text>)
    y += 9 * S / 3
    rows.push(<text key="dtype" x={MARGIN} y={y} fontSize={6 * S / 3} fill="#888" fontFamily="sans-serif" fontStyle="italic">Original</text>)
    y += 9 * S / 3
  }

  if (cfg.show_partner_info) {
    y += S
    rows.push(<text key="plabel" x={MARGIN} y={y} fontSize={5.5 * S / 3} fontWeight="bold" fill="#999" fontFamily="sans-serif">MADE BY</text>)
    y += 3 * S
    rows.push(<text key="pname" x={MARGIN} y={y} fontSize={7 * S / 3} fill="#111" fontFamily="sans-serif">Artisan Workshop Co.</text>)
    y += 9 * S / 3
  }

  if (cfg.show_color_palette) {
    y += S
    const DOT = 2.4 * S
    const COLORS = ["#2c2c2c", "#c94a4a", "#4a7fc9", "#e8c84a", "#4ac971", "#c94ab4"]
    rows.push(
      <g key="palette">
        {COLORS.map((c, i) => <circle key={i} cx={MARGIN + DOT / 2 + i * (DOT + 0.9 * S)} cy={y - DOT / 2} r={DOT / 2} fill={c} stroke="#ccc" strokeWidth={0.3} />)}
      </g>
    )
    y += DOT + 2 * S
  }

  if (cfg.show_design_tags) {
    rows.push(<text key="tags" x={MARGIN} y={y} fontSize={5.5 * S / 3} fill="#aaa" fontFamily="sans-serif" fontStyle="italic">sustainable  ·  linen  ·  natural</text>)
    y += 8 * S / 3
  }

  if (cfg.show_collaborators) {
    y += S
    rows.push(<text key="collabel" x={MARGIN} y={y} fontSize={5.5 * S / 3} fontWeight="bold" fill="#999" fontFamily="sans-serif">COLLABORATORS</text>)
    y += 3 * S
    rows.push(<text key="colname" x={MARGIN} y={y} fontSize={6.5 * S / 3} fill="#222" fontFamily="sans-serif">Maria Silva</text>)
    y += 9 * S / 3
  }

  const QR_SIZE = 15 * S
  const QR_BOTTOM_PAD = 5 * S
  const QR_Y = H - QR_BOTTOM_PAD - QR_SIZE
  const DIV_Y = QR_Y - 4 * S

  return (
    <>
      <rect width={W} height={H} fill="#fff" />
      <rect x={0} y={0} width={W} height={STRIP_H} fill={headerBg} />
      <text x={MARGIN} y={STRIP_H / 2 + 5.5 * S / 3 * 0.36} fontSize={5.5 * S / 3} fontWeight="bold" fill={headerFg} fontFamily="sans-serif" letterSpacing={1}>
        {cfg.brand_name || "BRAND"}
      </text>
      <line x1={MARGIN + 20 * S / 3} y1={STRIP_H / 2} x2={W - MARGIN} y2={STRIP_H / 2} stroke={headerFg} strokeWidth={0.4} strokeOpacity={0.4} />

      {cfg.show_punch_hole && (
        <>
          <circle cx={W / 2} cy={HOLE_CY} r={HOLE_R + 0.8} fill={headerBg} />
          <circle cx={W / 2} cy={HOLE_CY} r={HOLE_R} fill="#e4e4e4" stroke="#bbb" strokeWidth={0.5} />
        </>
      )}

      {rows}

      <line x1={MARGIN} y1={DIV_Y} x2={W - MARGIN} y2={DIV_Y} stroke={accentBg} strokeWidth={0.5} />

      {cfg.show_qr_code && (
        <g>
          <rect x={W / 2 - QR_SIZE / 2} y={QR_Y} width={QR_SIZE} height={QR_SIZE} fill={accentBg} rx={2} />
          <text x={W / 2} y={QR_Y + QR_SIZE / 2 + 3.5} textAnchor="middle" fontSize={5 * S / 3} fill="#aaa" fontFamily="sans-serif">QR</text>
          <text x={W / 2} y={QR_Y - 2.5 * S / 3} textAnchor="middle" fontSize={5 * S / 3} fill="#bbb" fontFamily="sans-serif" fontStyle="italic">{cfg.scan_label}</text>
        </g>
      )}

      {cfg.show_tagline && cfg.tagline && (
        <text x={W / 2} y={H - 1.5 * S / 3} textAnchor="middle" fontSize={5.5 * S / 3} fill="#aaa" fontFamily="sans-serif" fontStyle="italic">
          {cfg.tagline}
        </text>
      )}

      {/* Canvas elements overlay */}
      <CanvasElsSvg elements={cfg.back_canvas ?? []} />
    </>
  )
}

// ── Static preview wrappers ───────────────────────────────────────────────────

function HangTagFront({ cfg }: { cfg: HangTagConfig }) {
  return (
    <svg
      width={DISPLAY_W}
      height={tagDisplayH(cfg)}
      viewBox={`0 0 ${cfg.width_mm * S} ${cfg.height_mm * S}`}
      style={{ border: "1px solid #e0e0e0", borderRadius: 4, boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}
    >
      <HangTagFrontSvg cfg={cfg} />
    </svg>
  )
}

function HangTagBack({ cfg }: { cfg: HangTagConfig }) {
  return (
    <svg
      width={DISPLAY_W}
      height={tagDisplayH(cfg)}
      viewBox={`0 0 ${cfg.width_mm * S} ${cfg.height_mm * S}`}
      style={{ border: "1px solid #e0e0e0", borderRadius: 4, boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}
    >
      <HangTagBackSvg cfg={cfg} />
    </svg>
  )
}

// ── Template element builders ─────────────────────────────────────────────────

function buildFrontTemplateEls(cfg: HangTagConfig): TemplateEl[] {
  const L = computeFrontLayout(cfg)
  return [
    { id: "band",         label: "Brand Band",    ...L["band"],         configKeys: ["header_color", "header_text_color"] },
    { id: "punch-hole",   label: "Punch Hole",    ...L["punch-hole"],   showKey: "show_punch_hole",   configKeys: ["show_punch_hole"] },
    { id: "logo",         label: "Logo / Brand",  ...L["logo"],         configKeys: ["logo_url", "brand_name", "header_text_color"] },
    { id: "title",        label: "Product Title", ...L["title"],        configKeys: [] },
    { id: "status-badge", label: "Status Badge",  ...L["status-badge"], showKey: "show_status_badge", configKeys: ["show_status_badge", "accent_color"] },
    { id: "divider",      label: "Divider",       ...L["divider"],      configKeys: ["accent_color"] },
    { id: "tagline",      label: "Tagline",       ...L["tagline"],      showKey: "show_tagline",      configKeys: ["show_tagline", "tagline"] },
  ]
}

function buildBackTemplateEls(cfg: HangTagConfig): TemplateEl[] {
  const L = computeBackLayout(cfg)
  return [
    { id: "strip",        label: "Brand Strip",   ...L["strip"],        configKeys: ["header_color", "header_text_color"] },
    { id: "brand-text",   label: "Brand Text",    ...L["brand-text"],   configKeys: ["brand_name", "header_text_color"] },
    { id: "punch-hole",   label: "Punch Hole",    ...L["punch-hole"],   showKey: "show_punch_hole",   configKeys: ["show_punch_hole"] },
    { id: "design-info",  label: "Design Info",   ...L["design-info"],  showKey: "show_design_info",  configKeys: ["show_design_info"] },
    { id: "partner-info", label: "Partner Info",  ...L["partner-info"], showKey: "show_partner_info", configKeys: ["show_partner_info"] },
    { id: "palette",      label: "Color Palette", ...L["palette"],      showKey: "show_color_palette",configKeys: ["show_color_palette"] },
    { id: "design-tags",  label: "Design Tags",   ...L["design-tags"],  showKey: "show_design_tags",  configKeys: ["show_design_tags"] },
    { id: "collaborators",label: "Collaborators", ...L["collaborators"],showKey: "show_collaborators",configKeys: ["show_collaborators"] },
    { id: "divider",      label: "Divider",       ...L["divider"],      configKeys: ["accent_color"] },
    { id: "qr-code",      label: "QR Code",       ...L["qr-code"],      showKey: "show_qr_code",      configKeys: ["show_qr_code", "scan_label", "accent_color"] },
    { id: "scan-label",   label: "QR Caption",    ...L["scan-label"],   configKeys: ["scan_label"] },
    { id: "tagline",      label: "Tagline",       ...L["tagline"],      showKey: "show_tagline",      configKeys: ["show_tagline", "tagline"] },
  ]
}

// ── Toggle row helper ─────────────────────────────────────────────────────────

function ToggleRow({ label, description, checked, onChange }: {
  label: string; description?: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-ui-border-base last:border-0">
      <div>
        <Text size="small" weight="plus">{label}</Text>
        {description && <Text size="xsmall" className="text-ui-fg-subtle">{description}</Text>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type PreviewTab = "preview" | "front-canvas" | "back-canvas"

const SIZE_PRESETS = [
  { label: "Standard (55×90mm)", width_mm: 55, height_mm: 90 },
  { label: "Small (50×85mm)", width_mm: 50, height_mm: 85 },
  { label: "Large (60×95mm)", width_mm: 60, height_mm: 95 },
  { label: "Square (60×60mm)", width_mm: 60, height_mm: 60 },
]

const HangTagSettingsPage = () => {
  const { config: savedConfig, isLoading } = useHangTagSettings()
  const { mutate: updateSettings, isPending: isSaving } = useUpdateHangTagSettings()

  const [cfg, setCfg] = useState<HangTagConfig>(DEFAULT_HANG_TAG_CONFIG)
  const [dirty, setDirty] = useState(false)
  const [open, setOpen] = useState(false)
  const [previewTab, setPreviewTab] = useState<PreviewTab>("preview")
  const [logoModalOpen, setLogoModalOpen] = useState(false)

  useEffect(() => {
    if (!isLoading && savedConfig) {
      setCfg(savedConfig)
      setDirty(false)
    }
  }, [isLoading, savedConfig])

  const set = <K extends keyof HangTagConfig>(key: K, value: HangTagConfig[K]) => {
    setCfg((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  const handleSave = () => {
    updateSettings(cfg, {
      onSuccess: () => {
        toast.success("Hang tag settings saved")
        setDirty(false)
        setOpen(false)
      },
      onError: () => toast.error("Failed to save settings"),
    })
  }

  const handleCancel = () => {
    setCfg({ ...DEFAULT_HANG_TAG_CONFIG, ...savedConfig })
    setDirty(false)
    setOpen(false)
    setPreviewTab("preview")
  }

  const activePreset = SIZE_PRESETS.find(
    (p) => p.width_mm === cfg.width_mm && p.height_mm === cfg.height_mm
  )

  const frontElements = cfg.front_canvas ?? []
  const backElements = cfg.back_canvas ?? []
  const totalElements = frontElements.length + backElements.length

  return (
    <>
      {/* ── Page summary card ── */}
      <Container className="divide-y p-0">
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <Heading level="h2">Hang Tag Design</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Configure layout, branding, logo, and canvas elements for printed hang tags
            </Text>
          </div>
          <Button variant="secondary" onClick={() => setOpen(true)} disabled={isLoading}>
            Edit layout
          </Button>
        </div>
        <div className="px-6 py-4 grid grid-cols-4 gap-4">
          <div>
            <Text size="xsmall" className="text-ui-fg-subtle">Size</Text>
            <Text size="small" weight="plus">{cfg.width_mm} × {cfg.height_mm} mm</Text>
          </div>
          <div>
            <Text size="xsmall" className="text-ui-fg-subtle">Brand</Text>
            <Text size="small" weight="plus">{cfg.brand_name || "—"}</Text>
          </div>
          <div>
            <Text size="xsmall" className="text-ui-fg-subtle">Logo</Text>
            {cfg.logo_url
              ? <img src={cfg.logo_url} alt="logo" className="h-5 max-w-[80px] object-contain" />
              : <Text size="small" className="text-ui-fg-subtle">None</Text>
            }
          </div>
          <div>
            <Text size="xsmall" className="text-ui-fg-subtle">Canvas elements</Text>
            <Text size="small" weight="plus">{totalElements} element{totalElements !== 1 ? "s" : ""}</Text>
          </div>
        </div>
      </Container>

      {/* ── FocusModal: split editor ── */}
      <FocusModal open={open} onOpenChange={(v) => { if (!v) handleCancel() }}>
        <FocusModal.Content className="flex flex-col">
          <FocusModal.Header className="flex items-center justify-between">
            <div>
              <Heading>Hang Tag Design</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                {cfg.width_mm} × {cfg.height_mm} mm
              </Text>
            </div>
            <div className="flex items-center gap-x-2">
              <Button variant="secondary" onClick={handleCancel} disabled={isSaving}>Cancel</Button>
              <Button onClick={handleSave} isLoading={isSaving} disabled={isSaving || !dirty}>Save</Button>
            </div>
          </FocusModal.Header>

          <FocusModal.Body className="flex flex-1 overflow-hidden p-0">

            {/* Left: scrollable form */}
            <div className="flex-1 overflow-y-auto px-8 py-8 flex flex-col gap-y-4">

              {/* Size */}
              <Container className="divide-y p-0">
                <div className="px-6 py-4">
                  <Heading level="h2">Tag Size</Heading>
                  <Text className="text-ui-fg-subtle" size="small">Choose a preset or set custom dimensions</Text>
                </div>
                <div className="px-6 py-4 flex flex-col gap-y-3">
                  <div className="flex flex-wrap gap-2">
                    {SIZE_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        onClick={() => { set("width_mm", preset.width_mm); set("height_mm", preset.height_mm) }}
                        className={`px-3 py-1.5 rounded border text-sm transition-colors ${
                          activePreset?.label === preset.label
                            ? "border-ui-border-interactive bg-ui-bg-interactive text-ui-fg-on-inverted"
                            : "border-ui-border-base bg-ui-bg-base text-ui-fg-base hover:bg-ui-bg-hover"
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-y-1">
                      <Label className="text-xs">Width (mm)</Label>
                      <Input type="number" min={30} max={120} value={cfg.width_mm} onChange={(e) => set("width_mm", Number(e.target.value))} />
                    </div>
                    <div className="flex flex-col gap-y-1">
                      <Label className="text-xs">Height (mm)</Label>
                      <Input type="number" min={30} max={200} value={cfg.height_mm} onChange={(e) => set("height_mm", Number(e.target.value))} />
                    </div>
                  </div>
                </div>
              </Container>

              {/* Branding + Logo */}
              <Container className="divide-y p-0">
                <div className="px-6 py-4">
                  <Heading level="h2">Branding</Heading>
                </div>
                <div className="px-6 py-4 grid grid-cols-1 gap-y-3">

                  {/* Logo picker */}
                  <div className="flex flex-col gap-y-2">
                    <Label className="text-xs">Logo image</Label>
                    <div className="flex items-center gap-x-3">
                      {cfg.logo_url ? (
                        <div className="flex items-center gap-x-3 p-2 rounded border border-ui-border-base bg-ui-bg-subtle">
                          <img src={cfg.logo_url} alt="logo" className="h-10 max-w-[100px] object-contain" />
                          <Button
                            variant="transparent"
                            size="small"
                            onClick={() => set("logo_url", undefined)}
                            className="text-ui-fg-subtle hover:text-ui-fg-error text-xs"
                          >
                            Remove
                          </Button>
                        </div>
                      ) : (
                        <Text size="xsmall" className="text-ui-fg-subtle">No logo — brand name text will be used</Text>
                      )}
                      <Button variant="secondary" size="small" onClick={() => setLogoModalOpen(true)}>
                        {cfg.logo_url ? "Change logo" : "Choose logo"}
                      </Button>
                    </div>
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Logo appears in the brand band on the front. Use a transparent PNG or SVG for best results.
                    </Text>
                  </div>

                  <div className="flex flex-col gap-y-1">
                    <Label className="text-xs">Brand Name (shown when no logo)</Label>
                    <Input value={cfg.brand_name} onChange={(e) => set("brand_name", e.target.value)} placeholder="JYT" maxLength={20} />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="flex flex-col gap-y-1">
                      <Label className="text-xs">Header background</Label>
                      <div className="flex items-center gap-x-2">
                        <input type="color" value={cfg.header_color} onChange={(e) => set("header_color", e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-ui-border-base p-0.5" />
                        <Input value={cfg.header_color} onChange={(e) => set("header_color", e.target.value)} className="font-mono text-xs" />
                      </div>
                    </div>
                    <div className="flex flex-col gap-y-1">
                      <Label className="text-xs">Header text</Label>
                      <div className="flex items-center gap-x-2">
                        <input type="color" value={cfg.header_text_color} onChange={(e) => set("header_text_color", e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-ui-border-base p-0.5" />
                        <Input value={cfg.header_text_color} onChange={(e) => set("header_text_color", e.target.value)} className="font-mono text-xs" />
                      </div>
                    </div>
                    <div className="flex flex-col gap-y-1">
                      <Label className="text-xs">Accent / dividers</Label>
                      <div className="flex items-center gap-x-2">
                        <input type="color" value={cfg.accent_color} onChange={(e) => set("accent_color", e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-ui-border-base p-0.5" />
                        <Input value={cfg.accent_color} onChange={(e) => set("accent_color", e.target.value)} className="font-mono text-xs" />
                      </div>
                    </div>
                  </div>
                </div>
              </Container>

              {/* Text */}
              <Container className="divide-y p-0">
                <div className="px-6 py-4"><Heading level="h2">Text</Heading></div>
                <div className="px-6 py-4 grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-y-1">
                    <Label className="text-xs">Tagline</Label>
                    <Input value={cfg.tagline} onChange={(e) => set("tagline", e.target.value)} placeholder="Handcrafted with care" />
                  </div>
                  <div className="flex flex-col gap-y-1">
                    <Label className="text-xs">QR caption</Label>
                    <Input value={cfg.scan_label} onChange={(e) => set("scan_label", e.target.value)} placeholder="scan me" />
                  </div>
                </div>
              </Container>

              {/* QR Tracking Parameters */}
              <Container className="divide-y p-0">
                <div className="px-6 py-4">
                  <Heading level="h2">QR Tracking Parameters</Heading>
                  <Text className="text-ui-fg-subtle" size="small">
                    Default query params appended to all QR code URLs (e.g. <span className="font-mono">source=hangtag</span>). You can override these per generation.
                  </Text>
                </div>
                <div className="px-6 py-4 flex flex-col gap-y-2">
                  {(cfg.qr_params ?? []).map((param, idx) => (
                    <div key={idx} className="flex items-center gap-x-2">
                      <Input
                        placeholder="key"
                        value={param.key}
                        onChange={(e) => {
                          const updated = [...(cfg.qr_params ?? [])]
                          updated[idx] = { ...updated[idx], key: e.target.value }
                          set("qr_params", updated)
                        }}
                        className="font-mono text-xs flex-1"
                      />
                      <span className="text-ui-fg-muted text-xs">=</span>
                      <Input
                        placeholder="value"
                        value={param.value}
                        onChange={(e) => {
                          const updated = [...(cfg.qr_params ?? [])]
                          updated[idx] = { ...updated[idx], value: e.target.value }
                          set("qr_params", updated)
                        }}
                        className="font-mono text-xs flex-1"
                      />
                      <button
                        onClick={() => {
                          const updated = (cfg.qr_params ?? []).filter((_, i) => i !== idx)
                          set("qr_params", updated)
                        }}
                        className="text-ui-fg-muted hover:text-ui-fg-error text-xs px-1"
                        title="Remove"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <Button
                    variant="transparent"
                    size="small"
                    onClick={() => set("qr_params", [...(cfg.qr_params ?? []), { key: "", value: "" }])}
                    className="self-start text-ui-fg-subtle hover:text-ui-fg-base mt-1"
                  >
                    + Add parameter
                  </Button>
                </div>
              </Container>

              {/* Sections */}
              <Container className="divide-y p-0">
                <div className="px-6 py-4">
                  <Heading level="h2">Sections</Heading>
                  <Text className="text-ui-fg-subtle" size="small">Toggle which elements appear on the tag</Text>
                </div>
                <div className="px-6">
                  <ToggleRow label="Punch hole" checked={cfg.show_punch_hole} onChange={(v) => set("show_punch_hole", v)} />
                  <ToggleRow label="Status badge" description="e.g. Published" checked={cfg.show_status_badge} onChange={(v) => set("show_status_badge", v)} />
                  <ToggleRow label="Design info" description="Design name and type" checked={cfg.show_design_info} onChange={(v) => set("show_design_info", v)} />
                  <ToggleRow label="Partner / made by" description="Who produced the item" checked={cfg.show_partner_info} onChange={(v) => set("show_partner_info", v)} />
                  <ToggleRow label="Color palette" description="Linked design color dots" checked={cfg.show_color_palette} onChange={(v) => set("show_color_palette", v)} />
                  <ToggleRow label="Design tags" checked={cfg.show_design_tags} onChange={(v) => set("show_design_tags", v)} />
                  <ToggleRow label="Collaborators" description="People directly linked to the product" checked={cfg.show_collaborators} onChange={(v) => set("show_collaborators", v)} />
                  <ToggleRow label="QR code" description="Storefront URL QR" checked={cfg.show_qr_code} onChange={(v) => set("show_qr_code", v)} />
                  <ToggleRow label="Tagline" checked={cfg.show_tagline} onChange={(v) => set("show_tagline", v)} />
                </div>
              </Container>

              <div className="pb-4" />
            </div>

            {/* Right: preview + canvas editor */}
            <div className="w-[420px] shrink-0 border-l border-ui-border-base bg-ui-bg-subtle flex flex-col overflow-hidden">

              {/* Tabs */}
              <div className="flex border-b border-ui-border-base bg-ui-bg-base shrink-0">
                {(["preview", "front-canvas", "back-canvas"] as PreviewTab[]).map((tab) => {
                  const labels: Record<PreviewTab, string> = {
                    "preview": "Preview",
                    "front-canvas": `Front Canvas${frontElements.length ? ` (${frontElements.length})` : ""}`,
                    "back-canvas": `Back Canvas${backElements.length ? ` (${backElements.length})` : ""}`,
                  }
                  return (
                    <button
                      key={tab}
                      onClick={() => setPreviewTab(tab)}
                      className={`px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
                        previewTab === tab
                          ? "border-ui-border-interactive text-ui-fg-base"
                          : "border-transparent text-ui-fg-subtle hover:text-ui-fg-base"
                      }`}
                    >
                      {labels[tab]}
                    </button>
                  )
                })}
              </div>

              {/* Panel content */}
              <div className="flex-1 overflow-y-auto">

                {/* Preview tab */}
                {previewTab === "preview" && (
                  <div className="flex flex-col items-center gap-y-6 py-8 px-6">
                    <div className="flex items-start gap-x-6">
                      <div className="flex flex-col items-center gap-y-2">
                        <Text size="xsmall" className="text-ui-fg-subtle uppercase tracking-widest font-medium">Front</Text>
                        <HangTagFront cfg={cfg} />
                      </div>
                      <div className="flex flex-col items-center gap-y-2">
                        <Text size="xsmall" className="text-ui-fg-subtle uppercase tracking-widest font-medium">Back</Text>
                        <HangTagBack cfg={cfg} />
                      </div>
                    </div>
                    <Text size="xsmall" className="text-center text-ui-fg-muted">
                      {cfg.width_mm} × {cfg.height_mm} mm · both sides
                    </Text>
                  </div>
                )}

                {/* Front canvas editor */}
                {previewTab === "front-canvas" && (
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        Click template elements to configure. Drag to reposition. Add new elements with the toolbar.
                      </Text>
                      <Button
                        variant="transparent"
                        size="small"
                        onClick={() => set("front_layout", {})}
                        className="text-ui-fg-subtle hover:text-ui-fg-base text-[11px] h-6 px-1 shrink-0 ml-2"
                      >
                        Reset layout
                      </Button>
                    </div>
                    <HangTagCanvasEditor
                      cfg={cfg}
                      onCfgChange={(patch) => { setCfg(p => ({ ...p, ...patch })); setDirty(true) }}
                      templateEls={buildFrontTemplateEls(cfg)}
                      onLayoutChange={(id, pos) => {
                        setCfg(p => ({
                          ...p,
                          front_layout: {
                            ...(p.front_layout ?? {}),
                            [id]: { ...(p.front_layout?.[id] ?? {}), ...pos },
                          },
                        }))
                        setDirty(true)
                      }}
                      onResetElementLayout={(id) => {
                        setCfg(p => {
                          const { [id]: _, ...rest } = p.front_layout ?? {}
                          return { ...p, front_layout: rest }
                        })
                        setDirty(true)
                      }}
                      elements={frontElements}
                      onChange={(els) => set("front_canvas", els)}
                    />
                  </div>
                )}

                {/* Back canvas editor */}
                {previewTab === "back-canvas" && (
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        Click template elements to configure. Drag to reposition. Add new elements with the toolbar.
                      </Text>
                      <Button
                        variant="transparent"
                        size="small"
                        onClick={() => set("back_layout", {})}
                        className="text-ui-fg-subtle hover:text-ui-fg-base text-[11px] h-6 px-1 shrink-0 ml-2"
                      >
                        Reset layout
                      </Button>
                    </div>
                    <HangTagCanvasEditor
                      cfg={cfg}
                      onCfgChange={(patch) => { setCfg(p => ({ ...p, ...patch })); setDirty(true) }}
                      templateEls={buildBackTemplateEls(cfg)}
                      onLayoutChange={(id, pos) => {
                        setCfg(p => ({
                          ...p,
                          back_layout: {
                            ...(p.back_layout ?? {}),
                            [id]: { ...(p.back_layout?.[id] ?? {}), ...pos },
                          },
                        }))
                        setDirty(true)
                      }}
                      onResetElementLayout={(id) => {
                        setCfg(p => {
                          const { [id]: _, ...rest } = p.back_layout ?? {}
                          return { ...p, back_layout: rest }
                        })
                        setDirty(true)
                      }}
                      elements={backElements}
                      onChange={(els) => set("back_canvas", els)}
                    />
                  </div>
                )}

              </div>
            </div>

          </FocusModal.Body>
        </FocusModal.Content>
      </FocusModal>

      {/* Logo media modal (outside FocusModal to avoid nesting issues) */}
      <ProductMediaModal
        open={logoModalOpen}
        onOpenChange={setLogoModalOpen}
        initialUrls={cfg.logo_url ? [cfg.logo_url] : []}
        onSave={(urls) => {
          if (urls[0]) set("logo_url", urls[0])
          setLogoModalOpen(false)
        }}
      />
    </>
  )
}

export default HangTagSettingsPage

export const config = defineRouteConfig({
  label: "Hang Tag Design",
  icon: Tag,
})

export const handle = {
  breadcrumb: () => "Hang Tag Design",
}
