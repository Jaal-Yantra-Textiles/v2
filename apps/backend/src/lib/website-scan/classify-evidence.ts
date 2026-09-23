/**
 * Classify each piece of scan evidence with TypeSafe System One, then group in
 * CODE (#2249).
 *
 * The generative path asked one model to read everything and invent groups; on
 * prod the free GLMs either rate-limited (1 of 43 scans answered) or, on
 * Cloudflare, spent 84s and 3000 tokens reasoning and returned no answer. A
 * capability is really three closed choices per item — what KIND of thing,
 * which TECHNIQUE, what MATERIAL — and System One answers closed choices as
 * typed data with a confidence: 27 judgments over 9 real items came back in
 * 1.4s, and the two meaningless names were marked `unclear` instead of guessed.
 *
 * 🔴 Technique describes the ITEM, not the partner's work. Sharlho's
 * "Hand-Woven Wool Tweed Jacket" is correctly `handloom` — the CLOTH was
 * handwoven — but Sharlho stitched it. So a partner's actions come from what
 * our records say they DID (run tasks, onboarding); technique is turned into
 * actions only for website evidence, which carries no record of who did what.
 *
 * Egress: only an item's name, its recorded facts (minus free-text notes) and
 * its tags are sent — never a design brief, description or designer notes.
 * Neither provider trains on inputs; Codiv processes in memory and writes no
 * logs, TypeSafe retains "as long as reasonably necessary" (policies read
 * 2026-09-24). Which one answers is the AI platform row for this scope.
 */

/** The pre-classification scope a platform row names to serve capability scans. */
export const CAPABILITY_SCAN_SCOPE = "partner_capability_scan"
import { classify, type ResolvedClassifier } from "../ai/classify"
import { choice, type ChoiceAnswer, type OptionCriteria } from "../ai/typesafe"
import { normalizeCapabilityActions } from "../../modules/partner_capability/lib/actions"
import type { ProposedSample, ScanProposal, ScannedCatalogue, ScannedProduct } from "./types"

const ITEMS_PER_REQUEST = 12
const REQUEST_CONCURRENCY = 3
const REQUEST_TIMEOUT_MS = 15_000
const MAX_ITEMS = 120
const MAX_SAMPLES = 25
const MAX_IMAGES_PER_SAMPLE = 3
/** Below this a choice is treated as not known — the option list, not a guess. */
export const MIN_CONFIDENCE = 0.5

type Option = { label: string; criteria: OptionCriteria }

export const KINDS: Record<string, Option> = {
  jacket: { label: "jacket", criteria: "a jacket, coat or waistcoat" },
  dress: { label: "dress", criteria: "a dress, kaftan or gown" },
  skirt: { label: "skirt", criteria: "a skirt" },
  trousers: { label: "trousers", criteria: "trousers, pants or shorts" },
  shirt: { label: "shirt", criteria: "a shirt, top, tunic, kurta or blouse" },
  robe: { label: "robe", criteria: "a robe" },
  suit_piece: { label: "suit piece", criteria: "an unstitched suit piece or dress material sold as a set" },
  saree: { label: "saree", criteria: "a saree" },
  stole: { label: "stole", criteria: "a stole, scarf, muffler or dupatta" },
  shawl: { label: "shawl", criteria: "a shawl or wrap" },
  cap: { label: "cap", criteria: "a cap or hat" },
  fabric: { label: "fabric", criteria: "cloth sold by length or as yardage, not a finished item" },
  yarn: { label: "yarn", criteria: "yarn or thread" },
  towel: { label: "towel", criteria: "a towel" },
  rug: { label: "rug", criteria: "a rug, dari, durrie or carpet" },
  home_textile: { label: "home textile", criteria: "a cushion, throw, blanket, bedspread or table runner" },
  bag: { label: "bag", criteria: "a bag, tote or pouch" },
  pattern: { label: "pattern making", criteria: "a pattern or pattern-making service, not a finished item" },
  unclear: {
    label: "",
    criteria: {
      what: "the name and record do not say what kind of item this is",
      examples: ["a collection name", "a codename like 'Princess Highway'", "a tax or year label"],
    },
  },
}

export const TECHNIQUES: Record<string, Option & { action: string | null }> = {
  handloom: { label: "handloom", criteria: "woven on a handloom (handwoven)", action: "weave" },
  powerloom: { label: "power loom", criteria: "woven on a power loom", action: "weave" },
  handspun: { label: "handspun", criteria: "made from hand-spun yarn", action: "spin" },
  jamdani: { label: "jamdani", criteria: "jamdani weave", action: "weave" },
  ikat: { label: "ikat", criteria: "ikat / ikkat", action: "weave" },
  tangaliya: { label: "tangaliya", criteria: "tangaliya weave", action: "weave" },
  kani: { label: "kani", criteria: "kani weave", action: "weave" },
  block_print: { label: "block printed", criteria: "hand block printed", action: "print" },
  screen_print: { label: "screen printed", criteria: "screen or digitally printed", action: "print" },
  embroidery: { label: "embroidered", criteria: "embroidered by hand or machine (incl. aari, chikankari)", action: "embroider" },
  sozni: { label: "sozni", criteria: "sozni embroidery", action: "embroider" },
  zari: { label: "zari", criteria: "zari work", action: "embroider" },
  kantha: { label: "kantha", criteria: "kantha stitch", action: "embroider" },
  natural_dye: { label: "naturally dyed", criteria: "naturally or vegetable dyed", action: "dye" },
  knit: { label: "knitted", criteria: "knitted or crocheted", action: "knit" },
  stitched: { label: "", criteria: "cut and sewn into a garment, with no textile technique named", action: null },
  unclear: { label: "", criteria: "the technique is not stated", action: null },
}

export const MATERIALS: Record<string, Option> = {
  cotton: { label: "cotton", criteria: "cotton, not kala cotton or khadi" },
  kala_cotton: { label: "kala cotton", criteria: "kala cotton" },
  organic_cotton: { label: "organic cotton", criteria: "organic cotton" },
  khadi: { label: "khadi", criteria: "khadi" },
  muslin: { label: "muslin", criteria: "cotton muslin / mulmul" },
  denim: { label: "denim", criteria: "denim" },
  linen: { label: "linen", criteria: "linen" },
  hemp: { label: "hemp", criteria: "hemp" },
  nettle: { label: "nettle", criteria: "nettle fibre" },
  jute: { label: "jute", criteria: "jute" },
  wool: { label: "wool", criteria: "wool, merino or tweed" },
  pashmina: { label: "pashmina", criteria: "pashmina or cashmere" },
  mulberry_silk: { label: "mulberry silk", criteria: "mulberry or unspecified silk" },
  tussar: { label: "tussar silk", criteria: "tussar / tasar silk" },
  matka: { label: "matka silk", criteria: "matka silk" },
  eri: { label: "eri silk", criteria: "eri silk" },
  ahimsa_silk: { label: "ahimsa silk", criteria: "ahimsa / peace silk" },
  terry: { label: "terry", criteria: "terry cotton" },
  blend: { label: "blend", criteria: "a blend of fibres, or a synthetic" },
  unclear: { label: "", criteria: "the material is not stated" },
}

const criteriaOf = (options: Record<string, Option>) =>
  Object.fromEntries(Object.entries(options).map(([k, v]) => [k, v.criteria]))

/** What leaves the building for one item: name, recorded facts minus free text, tags. */
export const itemState = (p: ScannedProduct) => ({
  name: p.title,
  recorded: p.description.replace(/\s*Notes:.*$/s, "").slice(0, 300),
  tags: p.tags.slice(0, 8),
})

export type ItemClass = { kind: string; technique: string; material: string }

const picked = (answer: ChoiceAnswer | null | undefined, options: Record<string, unknown>) =>
  answer && answer.choice in options && answer.confidence >= MIN_CONFIDENCE ? answer.choice : "unclear"

/** One request's worth. Null when the service did not answer — never a guess. */
const classifyChunk = async (
  container: any,
  classifier: ResolvedClassifier,
  chunk: ScannedProduct[]
): Promise<ItemClass[] | null> => {
  const questions: Record<string, any> = {}
  chunk.forEach((_, i) => {
    questions[`kind_${i}`] = choice(`What kind of textile item is \`items[${i}]\`? Use its name, recorded facts and tags.`, criteriaOf(KINDS))
    questions[`tech_${i}`] = choice(`Which textile technique does \`items[${i}]\` evidence? Only what its name, facts or tags state.`, criteriaOf(TECHNIQUES))
    questions[`mat_${i}`] = choice(`What is \`items[${i}]\` made of? Only what its name, facts or tags state.`, criteriaOf(MATERIALS))
  })
  const result = await classify(container, {
    scope: CAPABILITY_SCAN_SCOPE,
    classifier,
    state: { items: chunk.map(itemState) },
    questions,
    timeoutMs: REQUEST_TIMEOUT_MS,
  })
  if (!result) return null
  return chunk.map((_, i) => ({
    kind: picked(result.answers[`kind_${i}`] as ChoiceAnswer, KINDS),
    technique: picked(result.answers[`tech_${i}`] as ChoiceAnswer, TECHNIQUES),
    material: picked(result.answers[`mat_${i}`] as ChoiceAnswer, MATERIALS),
  }))
}

/**
 * Classify every item (capped), a few requests at a time. Null if ANY chunk
 * failed: a partial classification would silently drop the unanswered items'
 * evidence from the proposal, which reads as "they don't make that".
 */
export const classifyEvidence = async (
  container: any,
  classifier: ResolvedClassifier,
  products: ScannedProduct[]
): Promise<ItemClass[] | null> => {
  const items = products.slice(0, MAX_ITEMS)
  const chunks: ScannedProduct[][] = []
  for (let i = 0; i < items.length; i += ITEMS_PER_REQUEST) chunks.push(items.slice(i, i + ITEMS_PER_REQUEST))
  const out: (ItemClass[] | null)[] = new Array(chunks.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(REQUEST_CONCURRENCY, chunks.length) }, async () => {
      while (next < chunks.length) {
        const i = next++
        out[i] = await classifyChunk(container, classifier, chunks[i])
      }
    })
  )
  return out.some((c) => c === null) ? null : (out as ItemClass[][]).flat()
}

const earliest = (products: ScannedProduct[]) => {
  const t = products.map((p) => (p.published_at ? Date.parse(p.published_at) : NaN)).filter(Number.isFinite)
  return t.length ? new Date(Math.min(...t)).toISOString() : null
}

const capitalise = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/**
 * PURE. Group classified evidence into proposals. Exported for tests.
 *
 * A capability = kind × technique, and for cloth × material too (linen and
 * tussar are different capabilities; a jacket in cotton or wool is one).
 */
export const proposalFromClasses = (
  catalogue: ScannedCatalogue,
  classes: ItemClass[]
): ScanProposal => {
  const items = catalogue.products.slice(0, classes.length)
  const groups = new Map<string, { cls: ItemClass; products: ScannedProduct[] }>()
  let unclassified = 0

  items.forEach((p, i) => {
    const cls = classes[i]
    if (cls.kind === "unclear") {
      unclassified++
      return
    }
    const clothLike = cls.kind === "fabric" || cls.kind === "yarn"
    const key = [cls.kind, cls.technique, clothLike ? cls.material : ""].join("|")
    const g = groups.get(key) ?? { cls, products: [] }
    g.products.push(p)
    groups.set(key, g)
  })

  const samples: ProposedSample[] = [...groups.values()]
    .sort((a, b) => b.products.length - a.products.length)
    .slice(0, MAX_SAMPLES)
    .map(({ cls, products }, i) => {
      const kind = KINDS[cls.kind]
      const technique = TECHNIQUES[cls.technique]
      // One material only when the evidence agrees; mixed jackets say nothing.
      const materials = new Set(
        products.map((_, j) => classes[items.indexOf(products[j])]?.material).filter((m) => m && m !== "unclear")
      )
      const material = materials.size === 1 ? MATERIALS[[...materials][0]].label : null
      const hinted = products.map((p) => p.hints?.material).find(Boolean) ?? null
      // Our records say what the partner DID; technique speaks only where no record exists.
      const recorded = products.flatMap((p) => p.hints?.actions ?? [])
      const hasRecords = products.some((p) => p.hints !== undefined)
      const actions = normalizeCapabilityActions(
        hasRecords ? recorded : [technique.action].filter(Boolean)
      )
      const mediaIds = [...new Set(products.flatMap((p) => p.hints?.media_file_ids ?? []))].slice(0, MAX_IMAGES_PER_SAMPLE)
      const title = capitalise([technique.label, material ?? "", kind.label].filter(Boolean).join(" "))
      return {
        key: `s${i + 1}`,
        title,
        product_type: cls.kind === "pattern" ? null : kind.label,
        technique: technique.label || null,
        material: material ?? hinted,
        actions,
        notes: products.length > 1 ? `${products.length} pieces of evidence` : null,
        image_urls: [...new Set(products.flatMap((p) => p.images))].slice(0, Math.max(0, MAX_IMAGES_PER_SAMPLE - mediaIds.length)),
        media_file_ids: mediaIds,
        source_url: products.find((p) => p.url)?.url ?? null,
        captured_at: earliest(products),
        evidence: products.map((p) => p.title).slice(0, 10),
      }
    })

  const warnings = [...catalogue.warnings]
  if (unclassified) {
    warnings.push(`${unclassified} item(s) could not be classified (a codename or collection name says nothing about what was made) and were left out`)
  }
  if (catalogue.products.length > MAX_ITEMS) {
    warnings.push(`Only the first ${MAX_ITEMS} of ${catalogue.products.length} items were classified`)
  }
  return {
    summary: null,
    product_types: [...new Set(samples.map((s) => s.product_type).filter((t): t is string => !!t))],
    samples,
    knowledge: [],
    grouped_by: "typesafe",
    product_count: catalogue.products.length,
    warnings,
  }
}
