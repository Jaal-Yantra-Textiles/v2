/**
 * Turn a scanned catalogue into capability PROPOSALS (#2249).
 *
 * The model groups products into capabilities and names technique, material,
 * actions and knowledge. It never supplies an image, a URL or a date: it
 * answers with product INDEXES, and those facts are copied from the products
 * it pointed at. A model that invents a photo URL or a publish date would put
 * fabricated evidence into a library whose whole job is to be evidence.
 *
 * When the model is unavailable or answers nothing usable, a mechanical
 * grouping by the site's own product_type stands in, marked `fallback` so an
 * operator knows technique and material were not read.
 */
import { z } from "zod"

import { normalizeCapabilityActions, CAPABILITY_ACTIONS } from "../../modules/partner_capability/lib/actions"
import type {
  ProposedKnowledge,
  ProposedSample,
  ScanProposal,
  ScannedCatalogue,
  ScannedProduct,
} from "./types"

export const MAX_PRODUCTS_FOR_MODEL = 120
export const MAX_SAMPLES = 25
export const MAX_KNOWLEDGE = 20
const MAX_IMAGES_PER_SAMPLE = 3

export const modelAnswerSchema = z.object({
  summary: z.string().nullable().optional(),
  product_types: z.array(z.string()).optional().default([]),
  capabilities: z
    .array(
      z.object({
        title: z.string(),
        product_type: z.string().nullable().optional(),
        technique: z.string().nullable().optional(),
        material: z.string().nullable().optional(),
        actions: z.array(z.string()).optional().default([]),
        notes: z.string().nullable().optional(),
        product_indexes: z.array(z.number().int()).optional().default([]),
      })
    )
    .optional()
    .default([]),
  knowledge: z
    .array(
      z.object({
        fact: z.string(),
        capability_index: z.number().int().nullable().optional(),
        product_index: z.number().int().nullable().optional(),
      })
    )
    .optional()
    .default([]),
})

export type ModelAnswer = z.infer<typeof modelAnswerSchema>

export const SCAN_SYSTEM_PROMPT = `You catalogue what a textile maker can make, from their own website.
You receive a numbered list of their products and some text from their site.
Group the products into CAPABILITIES: one per distinct kind of thing they make (product type x technique x material), not one per colourway or size.

Rules:
- Only state what the product text supports. If the technique or material is not stated, use null. Never guess a fibre from a colour or a price.
- "actions" must come ONLY from this list: ${CAPABILITY_ACTIONS.join(", ")}. "handwoven" => weave; "handspun" => spin; "block printed" => print; "embroidered"/"sozni"/"aari"/"chikankari" => embroider; a garment they sell => stitch ONLY if the text says they make it.
- A reseller of goods it does not make gets "source", not "weave".
- product_indexes: the [n] numbers of the products that evidence the capability. Every capability needs at least one.
- knowledge: short, durable facts useful when sourcing from them later (a count, a yarn count, a certification, a region, a lead time, a minimum order, a dye process). One fact per entry. Do not restate a capability title. Link it with capability_index (position in your capabilities array) or product_index when it is about one line; leave both null for a partner-wide fact.
- At most ${MAX_SAMPLES} capabilities and ${MAX_KNOWLEDGE} knowledge facts.
Answer with JSON only, matching: {"summary": string|null, "product_types": string[], "capabilities": [{"title","product_type","technique","material","actions":[],"notes","product_indexes":[]}], "knowledge": [{"fact","capability_index","product_index"}]}`

/** The compact, numbered product list the model sees. */
export const buildScanPrompt = (catalogue: ScannedCatalogue): string => {
  const lines = catalogue.products.slice(0, MAX_PRODUCTS_FOR_MODEL).map((p, i) =>
    [
      `[${i}] ${p.title}`,
      p.product_type ? `type: ${p.product_type}` : null,
      p.tags.length ? `tags: ${p.tags.slice(0, 12).join(", ")}` : null,
      p.description ? `about: ${p.description.slice(0, 300)}` : null,
      p.hints?.actions?.length ? `recorded actions: ${p.hints.actions.join(", ")}` : null,
      p.hints?.material ? `recorded material: ${p.hints.material}` : null,
    ]
      .filter(Boolean)
      .join(" | ")
  )
  return [
    catalogue.platform === "records"
      ? `Source: our own records of this partner's work (completed production runs, cloth they supplied us, products they list with us). Lines marked "recorded" are facts, not guesses.`
      : `Website: ${catalogue.origin} (${catalogue.platform})`,
    `Products (${catalogue.products.length}${catalogue.products.length > MAX_PRODUCTS_FOR_MODEL ? `, first ${MAX_PRODUCTS_FOR_MODEL} shown` : ""}):`,
    lines.join("\n") || "(none)",
    "",
    "Site text:",
    catalogue.page_text.slice(0, 4000) || "(none)",
  ].join("\n")
}

const clean = (s: unknown): string | null => {
  if (typeof s !== "string") return null
  const t = s.trim()
  return t && !/^(null|none|n\/a|unknown)$/i.test(t) ? t : null
}

/** Earliest publish date among the evidence — the most conservative claim. */
const earliestDate = (products: ScannedProduct[]): string | null => {
  const times = products
    .map((p) => (p.published_at ? Date.parse(p.published_at) : NaN))
    .filter((t) => Number.isFinite(t))
  return times.length ? new Date(Math.min(...times)).toISOString() : null
}

/** The most common known material across the evidence, if any was recorded. */
const hintedMaterial = (products: ScannedProduct[]): string | null => {
  const counts = new Map<string, number>()
  for (const m of products.map((p) => p.hints?.material?.trim()).filter((m): m is string => !!m)) {
    counts.set(m, (counts.get(m) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

const evidenceFacts = (products: ScannedProduct[]) => {
  const mediaIds = [...new Set(products.flatMap((p) => p.hints?.media_file_ids ?? []))].slice(0, MAX_IMAGES_PER_SAMPLE)
  return {
    // Rows we already hold take the photo slots first; URLs fill the rest.
    image_urls: [...new Set(products.flatMap((p) => p.images))].slice(0, Math.max(0, MAX_IMAGES_PER_SAMPLE - mediaIds.length)),
    media_file_ids: mediaIds,
    source_url: products.find((p) => p.url)?.url ?? null,
    captured_at: earliestDate(products),
    evidence: products.map((p) => p.title).slice(0, 10),
  }
}

/** Actions our own rows recorded, unioned with whatever was proposed. */
const withHintedActions = (proposed: string[], products: ScannedProduct[]) =>
  normalizeCapabilityActions([...proposed, ...products.flatMap((p) => p.hints?.actions ?? [])])

/**
 * Build proposals from a model answer. Indexes outside the list are dropped;
 * a capability left with no valid evidence is dropped with it.
 */
export const proposalFromModel = (
  catalogue: ScannedCatalogue,
  answer: ModelAnswer
): ScanProposal => {
  const visible = catalogue.products.slice(0, MAX_PRODUCTS_FOR_MODEL)
  const warnings = [...catalogue.warnings]
  const samples: ProposedSample[] = []
  const indexToKey = new Map<number, string>()

  answer.capabilities.slice(0, MAX_SAMPLES).forEach((cap, ci) => {
    const evidence = [...new Set(cap.product_indexes)]
      .filter((i) => i >= 0 && i < visible.length)
      .map((i) => visible[i])
    const title = clean(cap.title)
    if (!title || !evidence.length) {
      warnings.push(`Dropped "${cap.title}": no product on the site evidences it`)
      return
    }
    const key = `s${samples.length + 1}`
    indexToKey.set(ci, key)
    samples.push({
      key,
      title,
      product_type: clean(cap.product_type),
      technique: clean(cap.technique),
      material: clean(cap.material) ?? hintedMaterial(evidence),
      actions: withHintedActions(cap.actions, evidence),
      notes: clean(cap.notes),
      ...evidenceFacts(evidence),
    })
  })

  const productToKey = (pi: number | null | undefined): string | null => {
    if (pi == null) return null
    const cap = answer.capabilities.findIndex((c) => c.product_indexes.includes(pi))
    return cap >= 0 ? (indexToKey.get(cap) ?? null) : null
  }

  const knowledge: ProposedKnowledge[] = []
  const seenFacts = new Set<string>()
  for (const k of answer.knowledge.slice(0, MAX_KNOWLEDGE)) {
    const fact = clean(k.fact)
    if (!fact || seenFacts.has(fact.toLowerCase())) continue
    seenFacts.add(fact.toLowerCase())
    const sampleKey =
      (k.capability_index != null ? indexToKey.get(k.capability_index) : null) ??
      productToKey(k.product_index)
    const productUrl =
      k.product_index != null && visible[k.product_index] ? visible[k.product_index].url : null
    knowledge.push({
      key: `k${knowledge.length + 1}`,
      fact,
      sample_key: sampleKey ?? null,
      source_url:
        productUrl ??
        (sampleKey ? samples.find((s) => s.key === sampleKey)?.source_url : null) ??
        // A records scan has no page to point at; its origin is a label, not a URL.
        (catalogue.platform === "records" ? null : catalogue.origin),
    })
  }

  return {
    summary: clean(answer.summary),
    product_types: [...new Set(answer.product_types.map(clean).filter((t): t is string => !!t))],
    samples,
    knowledge,
    grouped_by: "model",
    product_count: catalogue.products.length,
    warnings,
  }
}

/**
 * A shop's own "type" is often a merchandising label, not a kind of product —
 * Bhuttico files shawls under "New Arrival". Such a label groups nothing.
 */
const MERCHANDISING_LABEL = /\b(new|arrivals?|sale|featured|best ?sellers?|trending|collection|offers?|default|all)\b/i

/** Kinds of product, singular. Order does not matter; the LAST one in a title wins. */
const PRODUCT_NOUNS = [
  "shawl", "stole", "muffler", "scarf", "cap", "hat", "saree", "sari", "dupatta",
  "kurta", "tunic", "jacket", "coat", "waistcoat", "shirt", "blouse", "dress",
  "skirt", "trouser", "pant", "suit", "lehenga", "poncho", "robe", "shrug",
  "rug", "dari", "durrie", "carpet", "cushion", "towel", "blanket", "throw",
  "bag", "tote", "pouch", "fabric", "yardage", "yarn", "pattu", "runner", "mat",
]
const NOUN_RE = new RegExp(`\\b(${PRODUCT_NOUNS.join("|")})(e?s)?\\b`, "gi")

/**
 * The kind of product a title names — its head noun, i.e. the LAST product
 * noun before any " - colourway" / "(note)" suffix: "Hand Woven Pure Merino
 * Wool Kullu Stole-Magenta" → "stole", "Himachali cap with flower border" → "cap".
 */
export const productNounFromTitle = (title: string): string | null => {
  const head = title.split(/\s[-–(]|\(|-\s?[A-Z][a-z]+$/)[0]
  const matches = [...head.matchAll(NOUN_RE)]
  const last = matches[matches.length - 1]?.[1]?.toLowerCase()
  return last ? (last === "sari" ? "saree" : last) : null
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * No model: group by what the product IS — the site's type when it is a real
 * kind, else the head noun of the title — so 25 colourways of a shawl become
 * one "Shawl" proposal, not 25. Technique/material stay null: they were not read.
 */
export const fallbackProposal = (
  catalogue: ScannedCatalogue,
  reason: string
): ScanProposal => {
  const kindOf = (p: ScannedProduct): string => {
    const type = p.product_type && !MERCHANDISING_LABEL.test(p.product_type) ? p.product_type.trim() : null
    return type ?? (productNounFromTitle(p.title) ? titleCase(productNounFromTitle(p.title)!) : "Other products")
  }
  const groups = new Map<string, ScannedProduct[]>()
  for (const p of catalogue.products) {
    const k = kindOf(p)
    groups.set(k, [...(groups.get(k) ?? []), p])
  }
  // Biggest groups first, "Other products" last — the cap keeps what matters.
  const ordered = [...groups.entries()].sort(
    ([a, x], [b, y]) => Number(a === "Other products") - Number(b === "Other products") || y.length - x.length
  )
  const samples: ProposedSample[] = ordered.slice(0, MAX_SAMPLES).map(([kind, products], i) => ({
    key: `s${i + 1}`,
    title: kind,
    product_type: kind === "Other products" ? null : kind.toLowerCase(),
    technique: null,
    material: hintedMaterial(products),
    actions: withHintedActions([], products),
    notes: products.length > 1 ? `${products.length} pieces of evidence` : null,
    ...evidenceFacts(products),
  }))
  return {
    summary: null,
    product_types: samples.map((s) => s.product_type).filter((t): t is string => !!t),
    samples,
    knowledge: [],
    grouped_by: "fallback",
    product_count: catalogue.products.length,
    warnings: [
      ...catalogue.warnings,
      `Grouped mechanically (${reason}) — technique was NOT read; material and actions come only from what our records state; review before committing`,
    ],
  }
}
