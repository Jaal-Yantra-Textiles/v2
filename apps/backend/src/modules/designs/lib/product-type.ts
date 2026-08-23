/**
 * Normalising a design's garment type (#938).
 *
 * The type is free text because a textile catalogue's vocabulary is always one
 * word ahead of any enum a migration could hold. Free text only stays
 * comparable if it is normalised on the way in — otherwise "Kurta", "kurta "
 * and "Kurta Set" are three types to every query that groups by it, and the
 * production spec keyed on the type quietly stops matching.
 */

/** Longest type we will store. Guards a model returning a sentence. */
export const MAX_PRODUCT_TYPE_LENGTH = 60

/**
 * PURE. Lowercase, collapse whitespace, and join words with underscores.
 *
 * Returns null for anything that is not a usable type — empty, whitespace, or
 * longer than a garment name plausibly is. Null means "we do not know", which
 * is a true statement; a truncated guess is not.
 */
export function normalizeProductType(value: unknown): string | null {
  if (typeof value !== "string") return null

  const cleaned = value
    .trim()
    .toLowerCase()
    // Keep letters, digits and separators; a garment name needs nothing else,
    // and punctuation is how a model's prose leaks into a key.
    .replace(/[^a-z0-9\s_-]/g, " ")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")

  if (!cleaned) return null
  if (cleaned.length > MAX_PRODUCT_TYPE_LENGTH) return null

  return cleaned
}

/**
 * PURE. May we overwrite the stored type with an inferred one?
 *
 * 🔴 A human's correction outranks the model, always. Re-inferring over a typed
 * value is how a designer fixes "trousers" to "palazzo" on Monday and finds it
 * back to "trousers" on Tuesday — with the production spec, and therefore the
 * cost, having moved underneath them and nothing in the record saying why.
 *
 * `force` exists for an explicit "re-infer this" action, where the human is the
 * one asking. That is a person choosing, not a model overruling one.
 */
export function mayInferOver(
  currentSource: string | null | undefined,
  force = false
): boolean {
  if (force) return true
  return currentSource !== "manual"
}

import { readModelJson } from "../../../lib/ai/model-json"

export type InferredProductType = {
  product_type: string
  confidence: number
  reasoning: string | null
}

/**
 * PURE. Pull a type + confidence out of whatever the model actually returned.
 *
 * 🔴 Why this exists, found by running the real thing locally rather than the
 * test mock: the agent runs on `dynamicFreeTextModel`, which picks a FREE
 * OpenRouter model, and several of those do not support structured output. On
 * `stealth/ox-alpha` the answer was perfectly good — "trousers", confidence
 * 0.97, sound reasoning — but it arrived as **markdown prose in `response.text`
 * with `response.object` undefined**. Reading `.object` alone threw on every
 * single call. The integration tests could not have caught it: they short-
 * circuit the model entirely.
 *
 * So three routes are tried, most to least structured:
 *   1. `object` — a model that honoured the schema.
 *   2. JSON in the text, with or without code fences.
 *   3. `**product_type:** trousers` style labelled prose.
 *
 * Returns null when none of them yields a usable answer, which the caller
 * treats as "no type" rather than as a failure worth throwing over.
 */
export function parseInferredProductType(raw: {
  object?: unknown
  text?: unknown
}): InferredProductType | null {
  const fromObject = coerce(raw?.object)
  if (fromObject) return fromObject

  const text = typeof raw?.text === "string" ? raw.text : ""
  if (!text.trim()) return null

  const fromJson = coerce(readModelJson({ text }))
  if (fromJson) return fromJson

  return coerce(extractLabelled(text))
}

/** Validate and narrow a candidate into the shape the caller needs. */
function coerce(value: unknown): InferredProductType | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>

  const productType = normalizeProductType(v.product_type)
  if (!productType) return null

  const confidence = Number(v.confidence)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null

  const reasoning = typeof v.reasoning === "string" ? v.reasoning.trim() : ""

  return { product_type: productType, confidence, reasoning: reasoning || null }
}

/**
 * `**product_type:** trousers` / `product_type: trousers` — what a model that
 * cannot emit JSON produces when asked for named fields.
 */
function extractLabelled(text: string): unknown {
  const field = (name: string): string | null => {
    const re = new RegExp(`\\*{0,2}${name}\\*{0,2}\\s*[:=]\\s*\\*{0,2}\\s*([^\\n*]+)`, "i")
    const match = text.match(re)
    return match?.[1]?.trim() ?? null
  }

  const productType = field("product_type")
  if (!productType) return null

  return {
    product_type: productType,
    // A model that answered in prose but omitted a confidence has still named a
    // garment. Default to the floor rather than discarding a real answer — but
    // NOT above it, so an unstated confidence never outranks a stated low one.
    confidence: Number(field("confidence") ?? "0.6"),
    reasoning: field("reasoning"),
  }
}
