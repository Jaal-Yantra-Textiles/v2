/**
 * PURE: an extractor payload → a `textile_analysis` row.
 *
 * Lives here rather than in the service so it can be tested without a
 * container. It is the only place that decides which of the extractor's ~20
 * keys is a COLUMN and which is prose, and that decision is the whole point of
 * the module — so it gets tests.
 */

export type TextileAnalysisSource =
  | "internal_extraction"
  | "storefront_reference"
  | "partner_upload"
  | "manual"

export type NormalisedTextileAnalysis = {
  source: TextileAnalysisSource
  model_name: string | null
  confidence: number | null
  analyzed_at: Date | null
  cloth_type: string | null
  category: string | null
  pattern: string | null
  fabric_weight: string | null
  weave_or_knit: string | null
  primary_color: string | null
  title: string | null
  description: string | null
  colors: string[] | null
  season: string[] | null
  occasion: string[] | null
  seo_keywords: string[] | null
  suggested_price: Record<string, any> | null
  target_audience: string | null
  care_instructions: string[] | null
  visual_observations: Record<string, any> | null
  model_characteristics: Record<string, any> | null
  raw: Record<string, any> | null
}

/**
 * Filter/decide columns are normalised; prose is not.
 *
 * 🔑 Lowercased and trimmed so two spellings of the same garment compare equal
 * — the same discipline `product_type` and `ProductSpecField.key` already
 * apply. Without it "Top", "top" and " top" are three different fabrics to a
 * `WHERE cloth_type = ?`, and the "more like this" feature quietly returns a
 * third of what it should.
 */
const norm = (v: unknown): string | null => {
  if (typeof v !== "string") return null
  const s = v.trim().toLowerCase()
  return s.length ? s : null
}

const strArray = (v: unknown): string[] | null => {
  if (!Array.isArray(v)) return null
  const out = v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean)
  return out.length ? out : null
}

const asObject = (v: unknown): Record<string, any> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : null

/**
 * The keys this schema names as columns or typed JSON. Anything else the
 * extractor emits goes to `raw` rather than being dropped.
 */
const KNOWN_KEYS = new Set([
  "title",
  "description",
  "colors",
  "season",
  "occasion",
  "pattern",
  "category",
  "cloth_type",
  "fabric_weight",
  "confidence",
  "model_name",
  "seo_keywords",
  "suggested_price",
  "target_audience",
  "care_instructions",
  "visual_observations",
  "model_characteristics",
  "body_raw",
  "face_raw",
  "designer",
])

export function normaliseTextileAnalysis(
  payload: Record<string, any> | null | undefined,
  input: {
    source: TextileAnalysisSource
    analyzed_at?: Date | string | null
    model_name?: string | null
  }
): NormalisedTextileAnalysis {
  const p = payload ?? {}
  const observations = asObject(p.visual_observations)
  const fabric = asObject(observations?.fabric)
  const colors = strArray(p.colors) ?? strArray(observations?.visible_colors)

  const analyzedAt =
    input.analyzed_at instanceof Date
      ? input.analyzed_at
      : typeof input.analyzed_at === "string" && input.analyzed_at
        ? new Date(input.analyzed_at)
        : null

  /**
   * ⚠️ `confidence` is read RAW before coercion. `Number(null)` is `0` and
   * `Number.isFinite(0)` is true, so coercing first would turn "the extractor
   * did not say" into "the extractor was certain it was wrong" — and this
   * value orders suggestions.
   */
  const rawConfidence = p.confidence
  const confidence =
    typeof rawConfidence === "number" && Number.isFinite(rawConfidence)
      ? rawConfidence
      : null

  const unknown: Record<string, any> = {}
  for (const [k, v] of Object.entries(p)) {
    if (!KNOWN_KEYS.has(k)) unknown[k] = v
  }

  return {
    source: input.source,
    model_name: (typeof input.model_name === "string" && input.model_name) || (typeof p.model_name === "string" ? p.model_name : null),
    confidence,
    analyzed_at: analyzedAt,

    cloth_type: norm(p.cloth_type),
    category: norm(p.category),
    pattern: norm(p.pattern) ?? norm(observations?.visible_pattern),
    fabric_weight: norm(p.fabric_weight) ?? norm(fabric?.perceived_weight),
    weave_or_knit: norm(fabric?.weave_or_knit),
    // The FIRST named colour is the dominant one — extractors list them that
    // way, and "more fabrics like this" matches on one.
    primary_color: colors?.length ? norm(colors[0]) : null,

    title: typeof p.title === "string" && p.title.trim() ? p.title.trim() : null,
    description:
      typeof p.description === "string" && p.description.trim()
        ? p.description.trim()
        : null,
    colors,
    season: strArray(p.season),
    occasion: strArray(p.occasion),
    seo_keywords: strArray(p.seo_keywords),
    suggested_price: asObject(p.suggested_price),
    target_audience:
      typeof p.target_audience === "string" && p.target_audience.trim()
        ? p.target_audience.trim()
        : null,
    care_instructions: strArray(p.care_instructions),
    visual_observations: observations,
    model_characteristics: asObject(p.model_characteristics),
    raw: Object.keys(unknown).length ? unknown : null,
  }
}
