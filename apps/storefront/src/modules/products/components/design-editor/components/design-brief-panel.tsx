"use client"

import React from "react"
import { DesignDetail } from "@lib/data/designs"

type Specification = NonNullable<DesignDetail["specifications"]>[number]
type ColorEntry = NonNullable<DesignDetail["colors"]>[number]
type ColorPaletteEntry = { name: string; code: string }

interface DesignBriefPanelProps {
  designSpecs: Specification[]
  colorPalette?: ColorPaletteEntry[]
  colors?: ColorEntry[]
  designerNotes?: string
}

export function DesignBriefPanel({
  designSpecs,
  colorPalette,
  colors,
  designerNotes,
}: DesignBriefPanelProps) {
  const hasColors = (colors && colors.length > 0) || (colorPalette && colorPalette.length > 0)
  const hasSpecs = designSpecs.length > 0
  const hasNotes = !!designerNotes

  if (!hasColors && !hasSpecs && !hasNotes) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <p className="text-xs text-neutral-400">No brief set by the designer yet.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-y-5 overflow-y-auto h-full p-4">
      {/* Color palette */}
      {hasColors && (
        <section>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-2">
            Colors
          </p>
          <div className="flex flex-wrap gap-2">
            {/* Colors from design.colors (rich model) */}
            {colors?.map((c) => (
              <div key={c.id} className="flex items-center gap-x-1.5">
                <span
                  className="w-5 h-5 rounded-full border border-neutral-200 flex-shrink-0"
                  style={{ backgroundColor: c.hex_code }}
                  title={c.name}
                />
                <span className="text-xs text-neutral-600">{c.name}</span>
              </div>
            ))}
            {/* Colors from design.color_palette (simple array) */}
            {!colors?.length && colorPalette?.map((c, i) => (
              <div key={i} className="flex items-center gap-x-1.5">
                <span
                  className="w-5 h-5 rounded-full border border-neutral-200 flex-shrink-0"
                  style={{ backgroundColor: c.code }}
                  title={c.name}
                />
                <span className="text-xs text-neutral-600">{c.name}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Specifications */}
      {hasSpecs && (
        <section>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-2">
            Specifications
          </p>
          <div className="flex flex-col gap-y-3">
            {designSpecs.map((spec) => (
              <div
                key={spec.id}
                className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2.5"
              >
                {spec.category && (
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 mb-0.5">
                    {spec.category}
                  </p>
                )}
                {spec.title && (
                  <p className="text-sm font-medium text-neutral-800">{spec.title}</p>
                )}
                {spec.details && (
                  <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">{spec.details}</p>
                )}
                {spec.measurements && Object.keys(spec.measurements).length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                    {Object.entries(spec.measurements).map(([key, val]) => (
                      <span key={key} className="text-[11px] text-neutral-500">
                        <span className="font-medium text-neutral-700">{key}:</span> {String(val)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Designer notes */}
      {hasNotes && (
        <section>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-2">
            Notes
          </p>
          <p className="text-xs text-neutral-600 leading-relaxed whitespace-pre-wrap">
            {designerNotes}
          </p>
        </section>
      )}
    </div>
  )
}
