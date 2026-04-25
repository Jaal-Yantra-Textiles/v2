"use client"

import React from "react"
import clsx from "clsx"
import { DesignLayer, DesignState } from "../types"

const BLEND_MODES = [
  "source-over", "multiply", "screen", "overlay", "darken", "lighten",
  "color-dodge", "color-burn", "hard-light", "soft-light", "difference",
  "exclusion",
]

const BLEND_LABELS: Record<string, string> = {
  "source-over": "Normal", multiply: "Multiply", screen: "Screen",
  overlay: "Overlay", darken: "Darken", lighten: "Lighten",
  "color-dodge": "Color Dodge", "color-burn": "Color Burn",
  "hard-light": "Hard Light", "soft-light": "Soft Light",
  difference: "Difference", exclusion: "Exclusion",
}

const FONT_FAMILIES = [
  "Arial", "Helvetica", "Georgia", "Times New Roman", "Verdana",
  "Courier New", "Impact", "Trebuchet MS", "Palatino", "Garamond",
  "Bookman", "Comic Sans MS", "Tahoma", "Gill Sans",
]

const BG_SWATCHES = [
  { label: "White", value: "#ffffff" },
  { label: "Off White", value: "#faf7f2" },
  { label: "Beige", value: "#e8dcc8" },
  { label: "Light Grey", value: "#d1d5db" },
  { label: "Navy", value: "#1e3a5f" },
  { label: "Black", value: "#0f0f0f" },
  { label: "Blush", value: "#f5c6c6" },
  { label: "Sage", value: "#c1d4c0" },
]

type StyleTabProps = {
  design: DesignState
  updateLayer: (id: string, attrs: Partial<DesignLayer>) => void
  alignLayer: (direction: "left" | "centerH" | "right" | "top" | "centerV" | "bottom") => void
  flipLayerH: () => void
  flipLayerV: () => void
  onBackgroundColorChange: (color: string) => void
  showPrintZone: boolean
  onTogglePrintZone: () => void
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">{children}</p>
  )
}

function Row({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx("flex items-center gap-2", className)}>{children}</div>
}

function NumInput({
  label, value, onChange, min, max, step = 1, unit,
}: {
  label: string; value: number; onChange: (v: number) => void
  min?: number; max?: number; step?: number; unit?: string
}) {
  return (
    <div className="flex flex-1 flex-col gap-0.5">
      <span className="text-[9px] font-medium uppercase tracking-widest text-neutral-400">{label}</span>
      <div className="flex items-center overflow-hidden rounded-md border border-neutral-200 bg-white focus-within:border-neutral-400 focus-within:ring-1 focus-within:ring-neutral-200">
        <input
          type="number"
          value={Math.round(value * 100) / 100}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-full bg-transparent px-2 py-1.5 text-xs text-neutral-800 outline-none"
        />
        {unit && <span className="pr-2 text-[10px] text-neutral-400">{unit}</span>}
      </div>
    </div>
  )
}

export function StyleTab({
  design,
  updateLayer,
  alignLayer,
  flipLayerH,
  flipLayerV,
  onBackgroundColorChange,
  showPrintZone,
  onTogglePrintZone,
}: StyleTabProps) {
  const layer = design.selectedId
    ? design.layers.find((l) => l.id === design.selectedId) ?? null
    : null

  const update = (attrs: Partial<DesignLayer>) => {
    if (!layer) return
    updateLayer(layer.id, attrs)
  }

  // ── CANVAS SETTINGS (nothing selected) ──────────────────────────────────
  if (!layer) {
    return (
      <div className="space-y-5 p-4">
        <div>
          <SectionLabel>Canvas background</SectionLabel>
          <div className="grid grid-cols-4 gap-2">
            {BG_SWATCHES.map((s) => (
              <button
                key={s.value}
                title={s.label}
                onClick={() => onBackgroundColorChange(s.value)}
                className={clsx(
                  "aspect-square rounded-md border-2 transition-all",
                  design.backgroundColor === s.value
                    ? "border-neutral-900 ring-2 ring-neutral-300"
                    : "border-transparent hover:border-neutral-300"
                )}
                style={{ backgroundColor: s.value }}
              />
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-neutral-500">Custom:</span>
            <input
              type="color"
              value={design.backgroundColor ?? "#ffffff"}
              onChange={(e) => onBackgroundColorChange(e.target.value)}
              className="h-7 w-10 cursor-pointer rounded border border-neutral-200"
            />
            <span className="text-xs font-mono text-neutral-500">{design.backgroundColor ?? "#ffffff"}</span>
          </div>
        </div>

        <div>
          <SectionLabel>Print zone</SectionLabel>
          <button
            onClick={onTogglePrintZone}
            className={clsx(
              "flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-xs font-medium transition-all",
              showPrintZone
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-100"
            )}
          >
            <span>{showPrintZone ? "Print zone visible" : "Show print zone"}</span>
            <div className={clsx("h-4 w-8 rounded-full transition-colors", showPrintZone ? "bg-white/30" : "bg-neutral-300")}>
              <div className={clsx("mt-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform", showPrintZone ? "ml-4.5 translate-x-4" : "ml-0.5")} />
            </div>
          </button>
        </div>

        <div className="rounded-md border border-dashed border-neutral-200 p-4 text-center">
          <p className="text-xs text-neutral-400">Select a layer on the canvas to edit its properties.</p>
        </div>
      </div>
    )
  }

  // ── LAYER PROPERTIES ─────────────────────────────────────────────────────
  const layerW = (layer.width ?? 100) * Math.abs(layer.scaleX)
  const layerH = (layer.height ?? 100) * Math.abs(layer.scaleY)

  const AlignBtn = ({ dir, title, children }: { dir: "left" | "centerH" | "right" | "top" | "centerV" | "bottom"; title: string; children: React.ReactNode }) => (
    <button
      onClick={() => alignLayer(dir)}
      title={title}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 text-neutral-500 transition-all hover:border-neutral-400 hover:bg-neutral-50 hover:text-neutral-800"
    >
      {children}
    </button>
  )

  return (
    <div className="space-y-4 p-4" data-lenis-prevent>

      {/* Position & Size */}
      <div>
        <SectionLabel>Position</SectionLabel>
        <Row>
          <NumInput label="X" value={layer.x} onChange={(v) => update({ x: v })} />
          <NumInput label="Y" value={layer.y} onChange={(v) => update({ y: v })} />
        </Row>
        <Row className="mt-2">
          <NumInput
            label="W"
            value={layerW}
            min={1}
            onChange={(v) => update({ scaleX: (v / (layer.width ?? 100)) * Math.sign(layer.scaleX || 1) })}
          />
          <NumInput
            label="H"
            value={layerH}
            min={1}
            onChange={(v) => update({ scaleY: (v / (layer.height ?? 100)) * Math.sign(layer.scaleY || 1) })}
          />
        </Row>
      </div>

      {/* Rotation & Opacity */}
      <div>
        <SectionLabel>Transform</SectionLabel>
        <Row>
          <NumInput label="Rotation" value={layer.rotation} min={-180} max={180} onChange={(v) => update({ rotation: v })} unit="°" />
          <NumInput label="Opacity" value={Math.round(layer.opacity * 100)} min={0} max={100} onChange={(v) => update({ opacity: v / 100 })} unit="%" />
        </Row>
      </div>

      {/* Alignment */}
      <div>
        <SectionLabel>Align to canvas</SectionLabel>
        <div className="flex items-center gap-1">
          <AlignBtn dir="left" title="Align left">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor"><path d="M1 1h1v14H1V1zm3 3h8v2H4V4zm0 6h6v2H4v-2z"/></svg>
          </AlignBtn>
          <AlignBtn dir="centerH" title="Center horizontally">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor"><path d="M7.5 1h1v14h-1V1zM3 4h10v2H3V4zm2 6h6v2H5v-2z"/></svg>
          </AlignBtn>
          <AlignBtn dir="right" title="Align right">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor"><path d="M14 1h1v14h-1V1zM4 4h8v2H4V4zm2 6h6v2H6v-2z"/></svg>
          </AlignBtn>
          <div className="w-px h-5 bg-neutral-200 mx-0.5" />
          <AlignBtn dir="top" title="Align top">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor"><path d="M1 1h14v1H1V1zm3 3v8h2V4H4zm6 0v6h2V4h-2z"/></svg>
          </AlignBtn>
          <AlignBtn dir="centerV" title="Center vertically">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor"><path d="M1 7.5v1h14v-1H1zM4 3v10h2V3H4zm6 2v6h2V5h-2z"/></svg>
          </AlignBtn>
          <AlignBtn dir="bottom" title="Align bottom">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor"><path d="M1 14h14v1H1v-1zm3-10v8h2V4H4zm6 2v6h2V6h-2z"/></svg>
          </AlignBtn>
        </div>
      </div>

      {/* Flip */}
      <div>
        <SectionLabel>Flip</SectionLabel>
        <Row>
          <button
            onClick={flipLayerH}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-neutral-200 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor"><path d="M8 1v14M3 3l5 5-5 5M13 3l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
            Flip H
          </button>
          <button
            onClick={flipLayerV}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-neutral-200 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor"><path d="M1 8h14M3 3l5 5-5 5M3 13l5-5 5 5" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
            Flip V
          </button>
        </Row>
      </div>

      {/* Blend mode */}
      <div>
        <SectionLabel>Blend mode</SectionLabel>
        <select
          value={layer.blendMode ?? "source-over"}
          onChange={(e) => update({ blendMode: e.target.value })}
          className="w-full rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-800 outline-none focus:border-neutral-400"
        >
          {BLEND_MODES.map((m) => (
            <option key={m} value={m}>{BLEND_LABELS[m] ?? m}</option>
          ))}
        </select>
      </div>

      {/* ── TEXT properties ─── */}
      {layer.type === "text" && (
        <>
          <div className="border-t border-neutral-100 pt-4">
            <SectionLabel>Typography</SectionLabel>
            <div className="space-y-2">
              {/* Font family */}
              <select
                value={layer.fontFamily ?? "Arial"}
                onChange={(e) => update({ fontFamily: e.target.value })}
                className="w-full rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-800 outline-none focus:border-neutral-400"
              >
                {FONT_FAMILIES.map((f) => (
                  <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
                ))}
              </select>

              {/* Size + color */}
              <Row>
                <NumInput label="Size" value={layer.fontSize ?? 24} min={6} max={400} onChange={(v) => update({ fontSize: v })} unit="px" />
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-medium uppercase tracking-wider text-neutral-400">Color</span>
                  <input
                    type="color"
                    value={layer.fill ?? "#000000"}
                    onChange={(e) => update({ fill: e.target.value })}
                    className="h-[34px] w-10 cursor-pointer rounded-md border border-neutral-200"
                  />
                </div>
              </Row>

              {/* Bold / Italic / Underline + text align */}
              <Row>
                {(["bold", "italic", "underline"] as const).map((style) => {
                  const isActive =
                    style === "underline"
                      ? layer.textDecoration === "underline"
                      : (layer.fontStyle ?? "").includes(style)
                  return (
                    <button
                      key={style}
                      onClick={() => {
                        if (style === "underline") {
                          update({ textDecoration: isActive ? "" : "underline" })
                        } else {
                          const current = layer.fontStyle ?? "normal"
                          const has = current.includes(style)
                          const next = has
                            ? current.replace(style, "").trim().replace(/\s+/g, " ") || "normal"
                            : `${current === "normal" ? "" : current + " "}${style}`.trim()
                          update({ fontStyle: next })
                        }
                      }}
                      className={clsx(
                        "flex h-8 w-8 items-center justify-center rounded-md border text-xs transition-all",
                        style === "bold" && "font-bold",
                        style === "italic" && "italic",
                        style === "underline" && "underline",
                        isActive
                          ? "border-neutral-900 bg-neutral-900 text-white"
                          : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                      )}
                    >
                      {style === "bold" ? "B" : style === "italic" ? "I" : "U"}
                    </button>
                  )
                })}
                <div className="w-px h-5 bg-neutral-200" />
                {(["left", "center", "right"] as const).map((align) => (
                  <button
                    key={align}
                    onClick={() => update({ textAlign: align })}
                    title={`Align ${align}`}
                    className={clsx(
                      "flex h-8 w-8 items-center justify-center rounded-md border text-xs transition-all",
                      (layer.textAlign ?? "left") === align
                        ? "border-neutral-900 bg-neutral-900 text-white"
                        : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                    )}
                  >
                    {align === "left" ? "⬅" : align === "center" ? "☰" : "➡"}
                  </button>
                ))}
              </Row>

              {/* Letter spacing + line height */}
              <Row>
                <NumInput label="Letter spacing" value={layer.letterSpacing ?? 0} min={-10} max={50} step={0.5} onChange={(v) => update({ letterSpacing: v })} unit="px" />
                <NumInput label="Line height" value={layer.lineHeight ?? 1.2} min={0.5} max={4} step={0.05} onChange={(v) => update({ lineHeight: v })} />
              </Row>
            </div>
          </div>
        </>
      )}

      {/* ── SHAPE properties ─── */}
      {(layer.type === "rect" || layer.type === "circle") && (
        <div className="border-t border-neutral-100 pt-4">
          <SectionLabel>Shape</SectionLabel>
          <div className="space-y-2">
            <Row>
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-medium uppercase tracking-wider text-neutral-400">Fill</span>
                <input
                  type="color"
                  value={layer.fill ?? "#e2e8f0"}
                  onChange={(e) => update({ fill: e.target.value })}
                  className="h-[34px] w-10 cursor-pointer rounded-md border border-neutral-200"
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-medium uppercase tracking-wider text-neutral-400">Stroke</span>
                <input
                  type="color"
                  value={layer.strokeColor ?? "#000000"}
                  onChange={(e) => update({ strokeColor: e.target.value })}
                  className="h-[34px] w-10 cursor-pointer rounded-md border border-neutral-200"
                />
              </div>
              <NumInput label="Stroke W" value={layer.strokeWidth ?? 0} min={0} max={40} onChange={(v) => update({ strokeWidth: v })} />
            </Row>
            {layer.type === "rect" && (
              <NumInput label="Corner radius" value={layer.cornerRadius ?? 0} min={0} max={200} onChange={(v) => update({ cornerRadius: v })} unit="px" />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
