/**
 * Read what OUR records say a partner has made, as scan evidence (#2249).
 *
 * The strongest evidence we hold, and for most partners the only evidence — a
 * finished run is more common than a website, and it is ours, so nothing about
 * it is hearsay. Three sources:
 *
 *   1. COMPLETED production runs — the design they made, the tasks they did
 *      (stitching, embroidery, block printing…), how many, when. Photos only
 *      where the partner sent them FOR THAT RUN: a design's own reference
 *      images show what we wanted, not what they made.
 *   2. Inventory orders they SUPPLIED us, Shipped/Delivered/Partial — each line
 *      is cloth they delivered, with its material and colour.
 *   3. Products they list with us (the partner↔product ownership link), other
 *      than drafts and rejections.
 *
 * Every item carries `hints` — facts from our rows, which a model's grouping
 * may add to but never overrule.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import type { ScannedCatalogue, ScannedProduct } from "../../../lib/website-scan/types"
import { PARTNER_ONBOARDING_PROFILE_MODULE } from "../../../modules/partner-onboarding-profile"
import { MEDIA_MODULE } from "../../../modules/media"

export const RECORDS_ORIGIN = "records"

const MAX_RUNS = 200
const MAX_ORDERS = 100
const MAX_PRODUCTS = 200
const SUPPLIED_STATUSES = new Set(["Shipped", "Delivered", "Partial"])
const LISTED_STATUSES = new Set(["published", "proposed"])

/**
 * Task or role words → the fixed action vocabulary. Anything unmatched is
 * dropped: "QC" is real work but not a capability anyone sources for.
 */
const ACTION_WORDS: [RegExp, string][] = [
  [/stitch|sew|tailor|cut(ting)?\b|construct|assembl|lining/i, "stitch"],
  [/pattern|draft|design/i, "design"],
  [/embroider|aari|sozni|chikan|zari|kantha|applique/i, "embroider"],
  [/print|block/i, "print"],
  [/dye|dyeing|indigo/i, "dye"],
  [/weav|loom/i, "weave"],
  [/spin/i, "spin"],
  [/knit/i, "knit"],
  [/finish|wash|press|iron|fring/i, "finish"],
]

export const actionsFromWords = (words: (string | null | undefined)[]): string[] => {
  const found = new Set<string>()
  for (const w of words) {
    if (!w) continue
    for (const [re, action] of ACTION_WORDS) if (re.test(w)) found.add(action)
  }
  return [...found]
}

const day = (iso: string | Date | null | undefined) =>
  iso ? new Date(iso).toISOString().slice(0, 10) : null

/** `design.media_files` entries the partner sent for THIS run. */
export const runPhotos = (design: any, runId: string): { id: string | null; url: string }[] =>
  (Array.isArray(design?.media_files) ? design.media_files : [])
    .filter((m: any) => m && m.run_id === runId && typeof m.url === "string")
    .map((m: any) => ({ id: typeof m.id === "string" ? m.id : null, url: m.url }))

/** A completed run as evidence. Exported for tests. */
export const runToEvidence = (run: any, design: any): ScannedProduct => {
  const tasks = (run.tasks ?? []).map((t: any) => t?.title).filter(Boolean)
  const made = Number(run.produced_quantity ?? run.quantity ?? 0)
  const materials = (design?.inventory_items ?? [])
    .map((i: any) => i?.material || i?.title)
    .filter(Boolean)
  const when = run.completed_at ?? run.finished_at ?? null
  const photos = runPhotos(design, run.id)
  return {
    title: design?.name ?? `Production run ${run.id}`,
    product_type: design?.product_type ?? null,
    tags: [run.run_type, run.role].filter(Boolean),
    description: [
      `Completed ${run.run_type === "sample" ? "sample " : ""}run${made ? `: made ${made}` : ""}${when ? ` on ${day(when)}` : ""}.`,
      tasks.length ? `Tasks: ${tasks.join(", ")}.` : null,
      materials.length ? `Materials: ${[...new Set(materials)].join(", ")}.` : null,
      run.completion_notes ? `Notes: ${String(run.completion_notes).slice(0, 200)}` : null,
    ]
      .filter(Boolean)
      .join(" "),
    images: photos.filter((p) => !p.id).map((p) => p.url),
    url: null,
    published_at: when ? new Date(when).toISOString() : null,
    hints: {
      actions: actionsFromWords([...tasks, run.role]),
      material: materials[0] ?? null,
      media_file_ids: photos.map((p) => p.id).filter((id): id is string => !!id),
    },
  }
}

/**
 * One supplied order line as evidence. An order has no delivered-at column,
 * so a Delivered/Shipped order's last update stands in for "by this date the
 * cloth existed" — it is said so in the text.
 */
export const orderLineToEvidence = (
  order: any,
  line: any,
  opts: { weaves: boolean }
): ScannedProduct | null => {
  const material = (line.material_name ?? "").trim() || null
  if (!material) return null
  const when = order.status === "Delivered" || order.status === "Shipped" ? order.updated_at : order.order_date
  return {
    title: [material, line.color].filter(Boolean).join(" — "),
    product_type: "fabric",
    tags: [order.status],
    description: `Supplied ${line.quantity ?? "?"} to us on inventory order ${order.id} (${order.status}${when ? `, recorded ${day(when)}` : ""}).`,
    images: [],
    url: null,
    published_at: when ? new Date(when).toISOString() : null,
    hints: {
      // Supplying cloth is not proof of weaving it (a partner may buy from a
      // shop and resell); `weave` only when they told us they weave.
      actions: opts.weaves ? ["weave"] : [],
      material,
    },
  }
}

export const productToEvidence = (product: any): ScannedProduct => ({
  title: product.title,
  product_type: product.type?.value ?? null,
  tags: [product.status, ...(product.tags ?? []).map((t: any) => t?.value)].filter(Boolean),
  description: [
    product.status === "proposed" ? "Proposed to us, not yet approved." : "Listed with us.",
    product.material ? `Material: ${product.material}.` : null,
    product.description ? String(product.description).slice(0, 300) : null,
  ]
    .filter(Boolean)
    .join(" "),
  images: [product.thumbnail, ...(product.images ?? []).map((i: any) => i?.url)]
    .filter((u): u is string => typeof u === "string" && !!u)
    .filter((u, i, all) => all.indexOf(u) === i)
    .slice(0, 3),
  url: null,
  // The listing date: the latest the thing can have been made, not when.
  published_at: product.created_at ? new Date(product.created_at).toISOString() : null,
  hints: { material: product.material ?? null },
})

/** Existing media rows for our own URLs, so a commit links rather than re-uploads. */
const mediaIdsByUrl = async (container: any, urls: string[]): Promise<Map<string, string>> => {
  const out = new Map<string, string>()
  if (!urls.length) return out
  try {
    const media: any = container.resolve(MEDIA_MODULE)
    const rows = await media.listMediaFiles({ file_path: [...new Set(urls)] }, { take: urls.length })
    for (const r of rows ?? []) if (r?.file_path) out.set(r.file_path, r.id)
  } catch {
    /* no match is fine — the commit copies the photo instead */
  }
  return out
}

export const readPartnerRecords = async (
  container: any,
  partnerId: string
): Promise<ScannedCatalogue> => {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const warnings: string[] = []

  const { data: runs } = await query.graph({
    entity: "production_runs",
    fields: [
      "id", "status", "run_type", "role", "quantity", "produced_quantity",
      "design_id", "completed_at", "finished_at", "completion_notes", "tasks.title",
    ],
    filters: { partner_id: partnerId, status: "completed" },
    pagination: { take: MAX_RUNS, order: { completed_at: "DESC" } },
  })

  const designIds = [...new Set((runs ?? []).map((r: any) => r.design_id).filter(Boolean))]
  const designs = new Map<string, any>()
  if (designIds.length) {
    const { data } = await query.graph({
      entity: "design",
      fields: ["id", "name", "product_type", "media_files", "inventory_items.title", "inventory_items.material"],
      filters: { id: designIds },
    })
    for (const d of data ?? []) designs.set(d.id, d)
  }

  const { data: partners } = await query.graph({
    entity: "partner",
    fields: [
      "id",
      "inventory_orders.id", "inventory_orders.status", "inventory_orders.order_date",
      "inventory_orders.updated_at", "inventory_orders.orderlines.*",
      "products.id", "products.title", "products.status", "products.material",
      "products.description", "products.thumbnail", "products.created_at",
      "products.type.value", "products.images.url", "products.tags.value",
    ],
    filters: { id: partnerId },
  })
  const partner = partners?.[0] ?? {}

  let weaves = false
  try {
    const onboarding: any = container.resolve(PARTNER_ONBOARDING_PROFILE_MODULE)
    const [profile] = await onboarding.listPartnerOnboardingProfiles({ partner_id: partnerId })
    weaves = profile?.does_weaving === true
  } catch {
    /* no profile: they have not told us they weave */
  }

  const evidence: ScannedProduct[] = []

  for (const run of runs ?? []) {
    evidence.push(runToEvidence(run, designs.get(run.design_id)))
  }
  const runsWithoutDesign = (runs ?? []).filter((r: any) => !r.design_id).length
  if (runsWithoutDesign) {
    warnings.push(`${runsWithoutDesign} completed run(s) have no design, so they say little about WHAT was made`)
  }

  const orders = (partner.inventory_orders ?? [])
    .filter((o: any) => o && SUPPLIED_STATUSES.has(o.status))
    .slice(0, MAX_ORDERS)
  for (const order of orders) {
    for (const line of order.orderlines ?? []) {
      const e = orderLineToEvidence(order, line, { weaves })
      if (e) evidence.push(e)
    }
  }

  const products = (partner.products ?? [])
    .filter((p: any) => p && LISTED_STATUSES.has(p.status))
    .slice(0, MAX_PRODUCTS)
  for (const p of products) evidence.push(productToEvidence(p))

  // Our own photo URLs (products, run photos without an id) → existing rows.
  const byUrl = await mediaIdsByUrl(container, evidence.flatMap((e) => e.images))
  for (const e of evidence) {
    const known = e.images.filter((u) => byUrl.has(u)).map((u) => byUrl.get(u)!)
    if (known.length) {
      e.hints = { ...e.hints, media_file_ids: [...new Set([...(e.hints?.media_file_ids ?? []), ...known])] }
      e.images = e.images.filter((u) => !byUrl.has(u))
    }
  }

  if (!evidence.length) {
    warnings.push("No completed runs, supplied inventory orders or listed products — our records hold no evidence for this partner")
  }

  return {
    platform: "records",
    origin: RECORDS_ORIGIN,
    products: evidence,
    page_text: "",
    warnings,
  }
}
