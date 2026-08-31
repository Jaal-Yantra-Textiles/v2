import { model } from "@medusajs/framework/utils"

/**
 * What a vision model saw in a textile image.
 *
 * ## Why this is a module and not `media_file.metadata`
 *
 * The extraction has been written to `MediaFile.metadata.textile_extraction`
 * since it shipped. Measured on production: of the 37 media files carrying it,
 * **37 have a `title` and a `description` inside the blob and 0 have the TYPED
 * `MediaFile.title` / `description` / `alt_text` / `tags` columns set** —
 * columns that already exist for exactly that, and `title` is one of the two
 * `.searchable()` fields. A good title was computed 37 times and the media
 * library, SEO and alt text all read the empty column instead.
 *
 * 🔴 The decisive argument is not tidiness, it is QUERYABILITY. "Show me more
 * fabrics like this" filters on pattern, weight and cloth type, and
 * `query.graph` cannot filter or sort into JSON subkeys the way it does
 * columns. The feature is near-impossible while this is a blob and trivial
 * once it is not.
 *
 * And `metadata` on a media file is a shared bag with at least five writers —
 * partner upload, WhatsApp (`wa_media_id`), this extraction, raw-material
 * binding, captions — one of which updates it WHOLESALE. Living there means
 * every producer is one careless write away from erasing the others.
 *
 * ## Why a module rather than columns on MediaFile
 *
 * Three reasons, in order of weight:
 *
 * 1. **The same analysis belongs on more than one thing.** A raw material is
 *    as analysable as a media file (121 raw materials, 89 with media). Columns
 *    on `MediaFile` could never be reused; a linked row can.
 * 2. **One image can be analysed more than once** — by the internal extractor
 *    and by the storefront reference path, or by a newer model later. That is
 *    a row per analysis, not a column set that the second run overwrites.
 * 3. `MediaFile` is a generic asset record. Every textile attribute added to
 *    it is a field that means nothing for a PDF or an invoice scan.
 *
 * ## The typed/untyped line
 *
 * Typed = what you FILTER and DECIDE on. JSON = prose nobody branches on.
 * Drawing it anywhere else is how `metadata` became a contract elsewhere in
 * this codebase.
 */
const TextileAnalysis = model.define("textile_analysis", {
  id: model.id({ prefix: "txan" }).primaryKey(),

  /**
   * WHO produced this, and therefore how far to trust it.
   *
   * 🔑 The distinction that was previously implicit in which metadata key
   * someone happened to write. `internal_extraction` is first-party, run over
   * stock we hold. `storefront_reference` is a photo a stranger uploaded to
   * the design chat as inspiration — same schema, very different standing, and
   * nothing downstream could tell them apart before.
   */
  source: model
    .enum(["internal_extraction", "storefront_reference", "partner_upload", "manual"])
    .default("internal_extraction"),

  /** The model that produced it. Null when a human entered the values. */
  model_name: model.text().nullable(),

  /**
   * The extractor's own confidence, 0–1.
   *
   * ⚠️ Advisory, never a gate on its own — the sample that prompted this module
   * scored 0.62 while describing the garment accurately. Use it to ORDER
   * suggestions, not to hide them.
   */
  confidence: model.float().nullable(),

  analyzed_at: model.dateTime().nullable(),

  // ── Typed because these are what a search filters on ──────────────────
  /** "top", "saree", "trousers" — the garment. Normalised lowercase. */
  cloth_type: model.text().searchable().nullable(),
  /** Coarser bucket: "tops", "bottoms", "outerwear". */
  category: model.text().nullable(),
  /** "floral", "stripe", "solid", "geometric". */
  pattern: model.text().nullable(),
  /** "light-weight" | "medium-weight" | "heavy-weight" as the extractor says. */
  fabric_weight: model.text().nullable(),
  /** "woven" | "knit" | null when the image cannot show it. */
  weave_or_knit: model.text().nullable(),
  /**
   * The dominant colour, normalised to a family ("red", "beige").
   *
   * 🔑 Typed separately from the full `colors` list because "more fabrics like
   * this" matches on ONE colour, and a JSON array cannot be indexed or joined
   * on. The full list stays below.
   */
  primary_color: model.text().nullable(),

  // ── The prose. Nobody branches on these; they render. ──────────────────
  /** The extractor's title — ALSO mirrored onto MediaFile.title, which is searchable. */
  title: model.text().nullable(),
  description: model.text().nullable(),
  /** Every colour named, not just the dominant one. */
  colors: model.json().nullable(),
  season: model.json().nullable(),
  occasion: model.json().nullable(),
  seo_keywords: model.json().nullable(),
  suggested_price: model.json().nullable(),
  target_audience: model.text().nullable(),
  care_instructions: model.json().nullable(),
  /** The full `visual_observations` block, verbatim. Evidence, not contract. */
  visual_observations: model.json().nullable(),
  model_characteristics: model.json().nullable(),

  /**
   * Whatever the extractor returned that this schema does not name.
   *
   * ⚠️ NOT a second home for anything above. It exists so a model that starts
   * emitting a new field does not lose it before someone types it — and so
   * nobody is tempted to reach for `metadata` again.
   */
  raw: model.json().nullable(),
})

export default TextileAnalysis
