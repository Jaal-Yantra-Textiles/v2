import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { coreScene } from "../modules/designs/lib/moodboard-ownership"
import { findWorkOrder } from "./work-orders/read-work-orders"

/**
 * Design preview links (#2500): what a link covers and what its page shows.
 *
 * Shared by the admin mint route (which refuses a scope that covers no design)
 * and the public page route (which renders it), so the two cannot disagree
 * about which designs a link holds.
 */

export const PARTNER_PORTAL_URL =
  process.env.PARTNER_PORTAL_URL || "https://partner.jaalyantra.com"

export const previewLinkUrl = (rawToken: string): string =>
  `${PARTNER_PORTAL_URL.replace(/\/$/, "")}/design-preview/${rawToken}`

/**
 * PURE: may this link be viewed right now? Not revoked and, if dated, not yet
 * expired. Callers pass `now` so it stays deterministic.
 */
export const isPreviewLinkUsable = (
  link: { revoked_at?: Date | string | null; expires_at?: Date | string | null },
  now: Date
): boolean => {
  if (link.revoked_at) return false
  if (link.expires_at && new Date(link.expires_at).getTime() <= now.getTime()) {
    return false
  }
  return true
}

/** Public fields for a link — never `token_hash`. */
export function presentPreviewLink(link: any) {
  return {
    id: link.id,
    scope: link.scope,
    scope_id: link.scope_id,
    partner_id: link.partner_id,
    label: link.label,
    expires_at: link.expires_at,
    revoked_at: link.revoked_at,
    usable: isPreviewLinkUsable(link, new Date()),
    created_by: link.created_by,
    created_at: link.created_at,
  }
}

export type PreviewLinkScope = "order" | "design"

export type PreviewScopeLine = { design_id: string; quantity: number | null }

export type PreviewScope = {
  /** The designs, in work-order line order, each once. */
  lines: PreviewScopeLine[]
  /** "Bundle #152" for an order; null for a single design. */
  label: string | null
  /** The order's partner, when it has one. */
  partner_id: string | null
}

const toNumber = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * PURE: an order's lines → the designs it holds, each once (a design on two
 * lines is listed once, quantities added), lines with no design dropped.
 */
export const designLinesFromItems = (
  items: Array<{ design_id?: string | null; quantity?: unknown; metadata?: any }> | null | undefined
): PreviewScopeLine[] => {
  const byDesign = new Map<string, PreviewScopeLine>()
  for (const item of Array.isArray(items) ? items : []) {
    const designId = item?.design_id ?? item?.metadata?.design_id
    if (!designId || typeof designId !== "string") continue
    const qty = toNumber(item?.quantity)
    const prev = byDesign.get(designId)
    if (prev) {
      prev.quantity = prev.quantity == null || qty == null ? prev.quantity ?? qty : prev.quantity + qty
    } else {
      byDesign.set(designId, { design_id: designId, quantity: qty })
    }
  }
  return [...byDesign.values()]
}

/**
 * The designs a link's scope covers.
 *
 * An order is read from `work_order` first — work orders left the core order
 * (#2261) and keep their `order_` ids — and from the core order only when no
 * work order row exists, so a pre-migration or retail design order still
 * resolves.
 */
export const resolvePreviewScope = async (
  container: any,
  scope: PreviewLinkScope,
  scopeId: string
): Promise<PreviewScope | null> => {
  if (scope === "design") {
    return { lines: [{ design_id: scopeId, quantity: null }], label: null, partner_id: null }
  }

  const wo = await findWorkOrder(container, scopeId)
  if (wo) {
    return {
      lines: designLinesFromItems(wo.items),
      label: `Bundle #${wo.display_id}`,
      partner_id: wo.partner_id ?? null,
    }
  }

  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "display_id", "items.quantity", "items.metadata"],
    filters: { id: scopeId },
  })
  const order = data?.[0]
  if (!order) return null
  return {
    lines: designLinesFromItems(order.items),
    label: `Order #${order.display_id}`,
    partner_id: null,
  }
}

const DESIGN_FIELDS = [
  "id",
  "name",
  "description",
  "design_type",
  "thumbnail_url",
  "moodboard",
  "moodboards.id",
  "moodboards.owner_type",
  "moodboards.partner_id",
  "moodboards.scene",
  "moodboards.thumbnail_url",
]

export type PreviewDesign = {
  id: string
  name: string | null
  description: string | null
  design_type: string | null
  thumbnail_url: string | null
  quantity: number | null
  /** The CORE board's scene — our board, never a partner's. Null when empty. */
  moodboard: unknown
}

/**
 * The designs for a page, with each one's CORE board.
 *
 * 🔴 Read through `coreScene`, not `design.moodboard`. Boards moved to
 * `design_moodboard` rows (#2017) and the seed/editor write only there, so the
 * old column is empty for any design edited since — reading it is how the
 * designer-invite landing came to show "No moodboard yet" on a full board.
 */
export const loadPreviewDesigns = async (
  container: any,
  lines: PreviewScopeLine[]
): Promise<PreviewDesign[]> => {
  if (!lines.length) return []
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "design",
    fields: DESIGN_FIELDS,
    filters: { id: lines.map((l) => l.design_id) },
  })
  const byId = new Map<string, any>((data ?? []).map((d: any) => [d.id, d]))

  const out: PreviewDesign[] = []
  for (const line of lines) {
    const d = byId.get(line.design_id)
    if (!d) continue
    out.push({
      id: d.id,
      name: d.name ?? null,
      description: d.description ?? null,
      design_type: d.design_type ?? null,
      thumbnail_url: d.thumbnail_url ?? null,
      quantity: line.quantity,
      moodboard: coreScene(d.moodboards, d.moodboard) ?? null,
    })
  }
  return out
}
