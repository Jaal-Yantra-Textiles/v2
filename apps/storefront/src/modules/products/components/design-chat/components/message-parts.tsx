"use client"

import React from "react"
import clsx from "clsx"
import { Text } from "@medusajs/ui"
import {
  CheckCircleSolid,
  ExclamationCircleSolid,
  Spinner,
} from "@medusajs/icons"
import { listDesignConversations } from "../lib/design-conversations"

/**
 * Tool-part renderers for the design chat.
 *
 * Each renderer drives off the AI-SDK tool-part state machine
 * (input-streaming → input-available → output-available | output-error) so
 * SKELETON loading states render while the tool runs — fabric chip grids while
 * materials load, partner cards while partners load, A/B canvas shimmer while
 * the two takes generate (~20s per image, the long op), text-line skeletons
 * while analysis runs.
 */

// ── Shared primitives ──────────────────────────────────────────────────

/** Status chip ("Choosing fabrics…") — the tool lifecycle signal. */
export const ToolStatusChip = ({
  label,
  tone = "pending",
}: {
  label: string
  tone?: "pending" | "done" | "error"
}) => (
  <p
    className={clsx(
      "mt-2 inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs",
      tone === "pending" && "bg-ui-bg-base-pressed text-ui-fg-subtle",
      tone === "done" && "bg-ui-tag-green-bg text-ui-tag-green-text",
      tone === "error" && "bg-ui-tag-red-bg text-ui-tag-red-text"
    )}
  >
    {tone === "pending" ? (
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ui-fg-muted" />
    ) : tone === "done" ? (
      <CheckCircleSolid className="h-3.5 w-3.5" />
    ) : (
      <ExclamationCircleSolid className="h-3.5 w-3.5" />
    )}
    {label}
  </p>
)

/** Shimmering text-line skeleton — assistant text pending. */
export const TextLineSkeleton = () => (
  <div className="flex flex-col gap-1.5 py-1">
    {[90, 75, 55].map((w, i) => (
      <div
        key={i}
        style={{ width: `${w}%` }}
        className="h-3 animate-pulse rounded bg-ui-bg-base-pressed"
      />
    ))}
  </div>
)

// ── list_raw_materials ─────────────────────────────────────────────────

export type MaterialHit = {
  id: string
  name: string | null
  color: string | null
  composition: string | null
  thumbnail: string | null
  category: string | null
  inventory_item_id: string | null
}

export const MaterialsCall = ({ part }: { part: any }) => {
  const state = part?.state as string | undefined

  if (state === "input-streaming" || state === "input-available") {
    return <ToolStatusChip label="Choosing fabrics…" />
  }
  if (state === "output-error") {
    return <ToolStatusChip label="Couldn't reach the fabric library." tone="error" />
  }
  if (state === "output-available") {
    const materials: MaterialHit[] = part.output?.materials ?? []
    if (!materials.length) {
      return <ToolStatusChip label="No fabrics matched that." tone="error" />
    }
    return (
      <div className="mt-3 grid grid-cols-4 gap-2">
        {materials.map((m) => (
          <div
            key={m.id}
            title={[m.name, m.composition].filter(Boolean).join(" · ")}
            className="flex flex-col items-center gap-1 rounded-lg border border-ui-border-base bg-ui-bg-base p-2"
          >
            {m.thumbnail ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={m.thumbnail}
                alt={m.name ?? "Fabric"}
                className="aspect-square w-full rounded-md object-cover"
              />
            ) : (
              <div
                className="aspect-square w-full rounded-md"
                style={{ backgroundColor: m.color || "#eceff1" }}
              />
            )}
            <p className="w-full truncate text-center text-[10px] font-medium">
              {m.name ?? m.category ?? "Fabric"}
            </p>
          </div>
        ))}
      </div>
    )
  }
  return null
}

// ── list_partners ──────────────────────────────────────────────────────

export type PartnerHit = {
  id: string
  name: string | null
  company_name: string | null
  logo: string | null
  description: string | null
  /** Friendly role along the production path (Fabric Seller, Manufacturer, …). */
  path: string | null
  workspace_type: string | null
}

export const PartnersCall = ({ part }: { part: any }) => {
  const state = part?.state as string | undefined

  if (state === "input-streaming" || state === "input-available") {
    return <ToolStatusChip label="Finding who makes this…" />
  }
  if (state === "output-error") {
    return <ToolStatusChip label="Couldn't reach partners." tone="error" />
  }
  if (state === "output-available") {
    const partners: PartnerHit[] = part.output?.partners ?? []
    if (!partners.length) {
      return <ToolStatusChip label="No verified partners yet." tone="error" />
    }
    return (
      <div className="mt-3 flex flex-col gap-2">
        {partners.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-3 rounded-lg bg-ui-bg-base p-2"
          >
            {p.logo ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={p.logo}
                alt=""
                className="h-11 w-11 shrink-0 rounded-md object-cover"
              />
            ) : (
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-ui-bg-base-pressed text-sm">
                🧶
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {p.company_name ?? p.name}
              </p>
              {p.path && (
                <p className="truncate text-xs text-ui-fg-subtle">{p.path}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    )
  }
  return null
}

// ── analyze_product_image ──────────────────────────────────────────────

export const AnalyzeCall = ({ part }: { part: any }) => {
  const state = part?.state as string | undefined

  if (state === "input-streaming" || state === "input-available") {
    return (
      <div className="mt-2">
        <ToolStatusChip label="Reading the garment…" />
        <TextLineSkeleton />
      </div>
    )
  }
  if (state === "output-error") {
    return <ToolStatusChip label="Couldn't analyse the image." tone="error" />
  }
  if (state === "output-available") {
    const analysis = part.output ?? {}
    const suggestions: string[] = analysis.suggestions ?? []
    if (!suggestions.length) return null
    return (
      <ul className="mt-2 flex flex-col gap-1">
        {suggestions.map((s, i) => (
          <li
            key={i}
            className="flex items-start gap-2 rounded-lg bg-ui-bg-base p-2 text-xs text-ui-fg-base"
          >
            <span className="mt-0.5 shrink-0 text-ui-fg-muted">◆</span>
            {s}
          </li>
        ))}
      </ul>
    )
  }
  return null
}

// ── generate_design_image (the long op) ────────────────────────────────

export type CanvasCandidate = {
  canvas_id: string
  letter: "A" | "B"
  image_url: string
  prompt_used: string
}

export const GenerateCall = ({ part }: { part: any }) => {
  const state = part?.state as string | undefined

  if (state === "input-streaming" || state === "input-available") {
    return (
      <div className="mt-3 flex flex-col gap-2">
        <ToolStatusChip label="Generating two takes… (~20 seconds)" />
        <div className="grid grid-cols-2 gap-2">
          {["A", "B"].map((letter) => (
            <div
              key={letter}
              className="relative aspect-[3/4] animate-pulse overflow-hidden rounded-xl border border-ui-border-base bg-ui-bg-base-pressed"
            >
              <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                {letter}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (state === "output-error") {
    return (
      <div className="mt-2">
        <ToolStatusChip label="Generation failed — try again." tone="error" />
      </div>
    )
  }
  if (state === "output-available") {
    const result = part.output ?? {}
    const candidates: CanvasCandidate[] = result.candidates ?? []
    const created = result.created_design
    return (
      <div className="mt-3 flex flex-col gap-2">
        {created && (
          <ToolStatusChip label="Design saved to your account" tone="done" />
        )}
        <div className="grid grid-cols-2 gap-2">
          {candidates.map((c) => (
            <div
              key={c.canvas_id}
              className="relative aspect-[3/4] overflow-hidden rounded-xl border border-ui-border-base bg-ui-bg-base"
            >
              {c.image_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={c.image_url}
                  alt={c.prompt_used || "Design take"}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="h-full w-full animate-pulse bg-ui-bg-base-pressed" />
              )}
              <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                {c.letter}
              </span>
            </div>
          ))}
        </div>
        <p className="text-center text-[10px] text-ui-fg-muted">
          Pick a take on the board — iterations build on it
        </p>
      </div>
    )
  }
  return null
}

// ── save_brief / set_active_canvas / save_moodboard / get_design_state ─

export const SaveBriefCall = ({ part }: { part: any }) => {
  const state = part?.state as string | undefined
  if (state === "input-streaming" || state === "input-available") {
    return <ToolStatusChip label="Locking in the brief…" />
  }
  if (state === "output-error") {
    return <ToolStatusChip label="Tell Cici what garment to design first." tone="error" />
  }
  if (state === "output-available") {
    const brief = part.output?.brief ?? {}
    return (
      <div className="mt-2 flex flex-wrap gap-1">
        {brief.product_type && (
          <span className="rounded-full bg-ui-tag-green-bg px-2 py-0.5 text-[10px] font-medium uppercase text-ui-tag-green-text">
            {brief.product_type.replace(/_/g, " ")}
          </span>
        )}
        {(brief.aesthetic_keywords ?? []).slice(0, 5).map((k: string) => (
          <span
            key={k}
            className="rounded-full bg-ui-bg-base-pressed px-2 py-0.5 text-[10px] text-ui-fg-subtle"
          >
            {k}
          </span>
        ))}
      </div>
    )
  }
  return null
}

export const SetActiveCall = ({ part }: { part: any }) => {
  const state = part?.state as string | undefined
  if (state === "input-streaming" || state === "input-available") {
    return <ToolStatusChip label="Setting your take…" />
  }
  if (state === "output-error") {
    return <ToolStatusChip label="Couldn't set that take." tone="error" />
  }
  if (state === "output-available") {
    return <ToolStatusChip label="Active take set — iterations build on it" tone="done" />
  }
  return null
}

export const QuietCall = ({ part, running, done }: { part: any; running: string; done: string | null }) => {
  const state = part?.state as string | undefined
  if (state === "input-streaming" || state === "input-available") {
    return <ToolStatusChip label={running} />
  }
  if (state === "output-error") {
    return <ToolStatusChip label="Something went wrong." tone="error" />
  }
  if (state === "output-available" && done) {
    return <ToolStatusChip label={done} tone="done" />
  }
  return null
}

// ── conversation thread tool (quiet) ───────────────────────────────────

export const ConversationCall = ({ part }: { part: any }) => {
  const state = part?.state as string | undefined
  if (state === "input-streaming" || state === "input-available") {
    return <ToolStatusChip label="Saving the thread…" />
  }
  if (state === "output-error") {
    return <ToolStatusChip label="Thread not saved." tone="error" />
  }
  if (state === "output-available") {
    const saved = part.output?.saved ?? part.output?.conversations
    return saved ? (
      <ToolStatusChip label="Thread saved" tone="done" />
    ) : null
  }
  return null
}

// ── dispatch map ───────────────────────────────────────────────────────

export const DESIGN_TOOL_PARTS: Record<string, React.ComponentType<any>> = {
  "tool-list_raw_materials": MaterialsCall,
  "tool-list_partners": PartnersCall,
  "tool-analyze_product_image": AnalyzeCall,
  "tool-generate_design_image": GenerateCall,
  "tool-save_brief": SaveBriefCall,
  "tool-set_active_canvas": SetActiveCall,
  "tool-save_moodboard": (part) => (
    <QuietCall part={part} running="Pinning inspirations…" done="Inspirations pinned" />
  ),
  "tool-create_design": (part) => (
    <QuietCall part={part} running="Saving your design…" done="Design saved to your account" />
  ),
  "tool-get_design_state": (part) => (
    <QuietCall part={part} running="Loading your board…" done={null} />
  ),
}

/** Product tools (concierge, shared with the concierge chat) render rows. */
export const PRODUCT_TOOL_PARTS = new Set([
  "tool-search_products",
  "tool-get_category_products",
  "tool-get_product_details",
])
