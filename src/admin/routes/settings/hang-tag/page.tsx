import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Button,
  Container,
  Drawer,
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
  DEFAULT_HANG_TAG_CONFIG,
  HangTagConfig,
  useHangTagSettings,
  useUpdateHangTagSettings,
} from "../../../hooks/api/hang-tag-settings"

// ── Live SVG preview ──────────────────────────────────────────────────────────

const PREVIEW_SCALE = 3.2 // px per mm

function HangTagPreview({ cfg }: { cfg: HangTagConfig }) {
  const W = cfg.width_mm * PREVIEW_SCALE
  const H = cfg.height_mm * PREVIEW_SCALE
  const s = PREVIEW_SCALE
  const MARGIN = 4 * s
  const BAR_H = 8 * s
  const fontBase = s * 2.8

  const headerBg = cfg.header_color || "#111"
  const headerFg = cfg.header_text_color || "#fff"
  const accentBg = cfg.accent_color || "#eee"

  let y = BAR_H + 12 * s

  const rows: React.ReactNode[] = []

  // Title row (mock)
  rows.push(
    <text key="title" x={MARGIN} y={y} fontSize={9 * s / 3} fontWeight="bold" fill="#111" fontFamily="sans-serif">
      Sample Product Title
    </text>
  )
  y += 11 * s / 3

  // Status badge
  if (cfg.show_status_badge) {
    const bW = 38 * s / 3
    const bH = 3.5 * s / 1.05
    rows.push(
      <g key="status">
        <rect x={MARGIN} y={y} width={bW} height={bH} fill={accentBg} rx={2} />
        <text x={MARGIN + 4 * s / 3} y={y + bH * 0.68} fontSize={6.5 * s / 3} fill="#555" fontFamily="sans-serif">
          Published
        </text>
      </g>
    )
    y += bH + 3 * s
  } else {
    y += 2 * s
  }

  // Divider
  rows.push(
    <line key="div1" x1={MARGIN} y1={y} x2={W - MARGIN} y2={y} stroke={accentBg} strokeWidth={0.5} />
  )
  y += 3 * s

  // Design info
  if (cfg.show_design_info) {
    rows.push(
      <text key="dlabel" x={MARGIN} y={y} fontSize={6 * s / 3} fontWeight="bold" fill="#888" fontFamily="sans-serif" textAnchor="start">
        Design
      </text>
    )
    y += 3.5 * s
    rows.push(
      <text key="dname" x={MARGIN} y={y} fontSize={8 * s / 3} fontWeight="bold" fill="#111" fontFamily="sans-serif">
        Spring Collection 2026
      </text>
    )
    y += 10 * s / 3

    rows.push(
      <text key="dtype" x={MARGIN} y={y} fontSize={6.5 * s / 3} fill="#777" fontFamily="sans-serif" fontStyle="italic">
        Original
      </text>
    )
    y += 9 * s / 3
  }

  // Partner info
  if (cfg.show_partner_info) {
    rows.push(
      <text key="plabel" x={MARGIN} y={y} fontSize={6 * s / 3} fontWeight="bold" fill="#888" fontFamily="sans-serif">
        Made by
      </text>
    )
    y += 3.5 * s
    rows.push(
      <text key="pname" x={MARGIN} y={y} fontSize={7.5 * s / 3} fill="#111" fontFamily="sans-serif">
        Artisan Workshop Co.
      </text>
    )
    y += 9 * s / 3
  }

  // Color palette dots
  if (cfg.show_color_palette) {
    y += s
    const DOT = 2.5 * s
    const COLORS = ["#2c2c2c", "#c94a4a", "#4a7fc9", "#e8c84a", "#4ac971", "#c94ab4"]
    rows.push(
      <g key="palette">
        {COLORS.map((c, i) => (
          <circle key={i} cx={MARGIN + DOT / 2 + i * (DOT + s)} cy={y - DOT / 2} r={DOT / 2} fill={c} stroke="#ccc" strokeWidth={0.3} />
        ))}
      </g>
    )
    y += DOT + 2 * s
  }

  // Design tags
  if (cfg.show_design_tags) {
    rows.push(
      <text key="tags" x={MARGIN} y={y} fontSize={6 * s / 3} fill="#888" fontFamily="sans-serif" fontStyle="italic">
        sustainable  ·  linen  ·  natural
      </text>
    )
    y += 8 * s / 3
  }

  // Collaborators
  if (cfg.show_collaborators) {
    y += s
    rows.push(
      <text key="collabel" x={MARGIN} y={y} fontSize={6 * s / 3} fontWeight="bold" fill="#888" fontFamily="sans-serif">
        Collaborators
      </text>
    )
    y += 3.5 * s
    rows.push(
      <text key="colname" x={MARGIN} y={y} fontSize={7 * s / 3} fill="#222" fontFamily="sans-serif">
        Maria Silva
      </text>
    )
    y += 9 * s / 3
  }

  // Bottom divider
  const QR_SIZE = 18 * s
  const QR_Y = 5 * s
  const qrTop = QR_Y + QR_SIZE + 4 * s

  rows.push(
    <line key="div2" x1={MARGIN} y1={qrTop} x2={W - MARGIN} y2={qrTop} stroke={accentBg} strokeWidth={0.5} />
  )

  // QR placeholder
  if (cfg.show_qr_code) {
    rows.push(
      <g key="qr">
        <rect x={W - MARGIN - QR_SIZE} y={QR_Y} width={QR_SIZE} height={QR_SIZE} fill={accentBg} rx={2} />
        <text x={W - MARGIN - QR_SIZE + QR_SIZE / 2} y={QR_Y + QR_SIZE / 2 + 4} fontSize={5 * s / 3} fill="#aaa" fontFamily="sans-serif" textAnchor="middle">
          QR
        </text>
        <text x={W - MARGIN - QR_SIZE + QR_SIZE / 2} y={QR_Y - 2 * s} fontSize={5.5 * s / 3} fill="#aaa" fontFamily="sans-serif" textAnchor="middle" fontStyle="italic">
          {cfg.scan_label}
        </text>
        <text x={W - MARGIN - QR_SIZE + QR_SIZE / 2} y={QR_Y + QR_SIZE + 2.5 * s} fontSize={5 * s / 3} fill="#aaa" fontFamily="sans-serif" textAnchor="middle" fontStyle="italic">
          /sample-handle
        </text>
      </g>
    )
  }

  // Tagline
  if (cfg.show_tagline) {
    rows.push(
      <g key="tagline">
        <text x={MARGIN} y={QR_Y + QR_SIZE - s} fontSize={6.5 * s / 3} fill="#777" fontFamily="sans-serif" fontStyle="italic">
          {cfg.tagline.split(" ").slice(0, 2).join(" ")}
        </text>
        <text x={MARGIN} y={QR_Y + QR_SIZE + 7 * s / 3} fontSize={6.5 * s / 3} fill="#777" fontFamily="sans-serif" fontStyle="italic">
          {cfg.tagline.split(" ").slice(2).join(" ")}
        </text>
      </g>
    )
  }

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      style={{ border: "1px solid #e0e0e0", borderRadius: 4, boxShadow: "0 2px 8px rgba(0,0,0,0.08)", background: "#fff" }}
    >
      {/* Tag background */}
      <rect width={W} height={H} fill="#fff" />

      {/* Header bar */}
      <rect x={0} y={H - BAR_H} width={W} height={BAR_H} fill={headerBg} />
      <text
        x={W / 2}
        y={H - BAR_H + BAR_H / 2 + fontBase / 3}
        fontSize={fontBase * 1.2}
        fontWeight="bold"
        fill={headerFg}
        textAnchor="middle"
        fontFamily="sans-serif"
      >
        {cfg.brand_name || "BRAND"}
      </text>

      {/* Punch hole */}
      {cfg.show_punch_hole && (
        <circle cx={W / 2} cy={H - BAR_H - 5 * s} r={2 * s} fill="#e8e8e8" stroke="#bbb" strokeWidth={0.5} />
      )}

      {rows}
    </svg>
  )
}

// ── Toggle row helper ─────────────────────────────────────────────────────────

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
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
  const [previewOpen, setPreviewOpen] = useState(false)

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
      },
      onError: () => toast.error("Failed to save settings"),
    })
  }

  const handleReset = () => {
    setCfg({ ...DEFAULT_HANG_TAG_CONFIG, ...savedConfig })
    setDirty(false)
  }

  const activePreset = SIZE_PRESETS.find(
    (p) => p.width_mm === cfg.width_mm && p.height_mm === cfg.height_mm
  )

  return (
    <>
    <div className="flex flex-col gap-y-4">
      <div className="flex flex-col gap-y-4">

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
                <Input
                  type="number"
                  min={30}
                  max={120}
                  value={cfg.width_mm}
                  onChange={(e) => set("width_mm", Number(e.target.value))}
                />
              </div>
              <div className="flex flex-col gap-y-1">
                <Label className="text-xs">Height (mm)</Label>
                <Input
                  type="number"
                  min={30}
                  max={200}
                  value={cfg.height_mm}
                  onChange={(e) => set("height_mm", Number(e.target.value))}
                />
              </div>
            </div>
          </div>
        </Container>

        {/* Branding */}
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Branding</Heading>
          </div>
          <div className="px-6 py-4 grid grid-cols-1 gap-y-3">
            <div className="flex flex-col gap-y-1">
              <Label className="text-xs">Brand Name</Label>
              <Input
                value={cfg.brand_name}
                onChange={(e) => set("brand_name", e.target.value)}
                placeholder="JYT"
                maxLength={20}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-y-1">
                <Label className="text-xs">Header background</Label>
                <div className="flex items-center gap-x-2">
                  <input
                    type="color"
                    value={cfg.header_color}
                    onChange={(e) => set("header_color", e.target.value)}
                    className="h-8 w-10 cursor-pointer rounded border border-ui-border-base p-0.5"
                  />
                  <Input
                    value={cfg.header_color}
                    onChange={(e) => set("header_color", e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-y-1">
                <Label className="text-xs">Header text</Label>
                <div className="flex items-center gap-x-2">
                  <input
                    type="color"
                    value={cfg.header_text_color}
                    onChange={(e) => set("header_text_color", e.target.value)}
                    className="h-8 w-10 cursor-pointer rounded border border-ui-border-base p-0.5"
                  />
                  <Input
                    value={cfg.header_text_color}
                    onChange={(e) => set("header_text_color", e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-y-1">
                <Label className="text-xs">Accent / dividers</Label>
                <div className="flex items-center gap-x-2">
                  <input
                    type="color"
                    value={cfg.accent_color}
                    onChange={(e) => set("accent_color", e.target.value)}
                    className="h-8 w-10 cursor-pointer rounded border border-ui-border-base p-0.5"
                  />
                  <Input
                    value={cfg.accent_color}
                    onChange={(e) => set("accent_color", e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          </div>
        </Container>

        {/* Text */}
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Text</Heading>
          </div>
          <div className="px-6 py-4 grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-y-1">
              <Label className="text-xs">Tagline</Label>
              <Input
                value={cfg.tagline}
                onChange={(e) => set("tagline", e.target.value)}
                placeholder="Handcrafted with care"
              />
            </div>
            <div className="flex flex-col gap-y-1">
              <Label className="text-xs">QR caption</Label>
              <Input
                value={cfg.scan_label}
                onChange={(e) => set("scan_label", e.target.value)}
                placeholder="scan me"
              />
            </div>
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

        {/* Footer actions */}
        <div className="flex justify-between gap-x-2 pb-8">
          <Button variant="secondary" onClick={() => setPreviewOpen(true)}>
            Preview
          </Button>
          <div className="flex gap-x-2">
            {dirty && (
              <Button variant="secondary" onClick={handleReset} disabled={isSaving}>
                Reset
              </Button>
            )}
            <Button onClick={handleSave} disabled={isSaving || !dirty} isLoading={isSaving}>
              Save settings
            </Button>
          </div>
        </div>
      </div>
    </div>

    {/* ── Preview Drawer ── */}
    <Drawer open={previewOpen} onOpenChange={setPreviewOpen}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Hang Tag Preview</Drawer.Title>
          <Drawer.Description>
            Live preview — {cfg.width_mm} × {cfg.height_mm} mm
          </Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col items-center justify-start gap-y-4 overflow-y-auto py-6">
          <HangTagPreview cfg={cfg} />
          <Text size="xsmall" className="text-ui-fg-muted">
            {cfg.width_mm} × {cfg.height_mm} mm
          </Text>
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" onClick={() => setPreviewOpen(false)}>
            Close
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
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
