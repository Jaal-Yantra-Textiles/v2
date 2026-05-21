import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { generateObject } from "ai"
import { z } from "zod"

/**
 * Schema the LLM is asked to produce. Keep this small and concrete —
 * every field is something we know how to map onto a Medusa product
 * query (q-search, price range, category match, tag match). Adding
 * fields here without wiring them through to the query downstream
 * silently inflates token cost for no benefit.
 *
 * `keywords` is the most important field: a short list of nouns/
 * adjectives extracted from the query that we then OR-join into the
 * Medusa `q` parameter. Models are asked to NOT include filler words
 * (find, show, want, looking, for, the, etc.) so the q-search stays
 * focused on substantive terms.
 *
 * Price fields are optional — we only set them when the LLM finds a
 * "under X" / "below X" / "between X and Y" pattern.
 */
const SearchInterpretationSchema = z.object({
  keywords: z
    .array(z.string().min(1).max(40))
    .min(1)
    .max(8)
    .describe(
      "1-8 substantive search terms extracted from the query, excluding filler words"
    ),
  color: z
    .string()
    .min(1)
    .max(30)
    .optional()
    .describe("Color if mentioned, single word"),
  material: z
    .string()
    .min(1)
    .max(30)
    .optional()
    .describe("Fabric / material if mentioned (cotton, silk, linen, etc.)"),
  min_price: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Minimum price floor in major currency units"),
  max_price: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Maximum price ceiling in major currency units"),
})

export type SearchInterpretation = z.infer<typeof SearchInterpretationSchema>

const SYSTEM_PROMPT = `You convert a shopper's natural-language search for fashion / textile products into a small structured interpretation.

Rules:
- Extract 1-8 substantive keywords. Exclude filler verbs (find, show, want, looking, for, get, give, need), articles (the, a, an, some), and the word "product" itself.
- If a color is mentioned, return it as a single word.
- If a fabric or material is mentioned, return it as a single word (cotton, silk, linen, wool, etc.).
- If a price ceiling or floor is mentioned, extract it as an integer in major currency units. Ignore the currency symbol — just the number.
- Never fabricate fields. If something isn't in the query, omit it.`

let _model: ReturnType<ReturnType<typeof createOpenRouter>["chat"]> | null = null

const getModel = () => {
  if (_model) return _model
  const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
  })
  // Cheap, fast, free-tier — sufficient for a structured one-shot
  // extraction. Override via env if you want a different model.
  const id = process.env.STOREFRONT_SEARCH_MODEL || "google/gemini-2.5-flash"
  _model = openrouter.chat(id)
  return _model
}

/**
 * Convert a natural-language shopper query into a small structured
 * interpretation we can map onto a Medusa product query. Fails closed:
 * if the LLM call errors out, returns a minimal interpretation that
 * treats the raw query as a single keyword, so search degrades to a
 * normal text match rather than crashing.
 */
export const extractSearchInterpretation = async (
  query: string
): Promise<SearchInterpretation> => {
  try {
    const { object } = await generateObject({
      model: getModel(),
      schema: SearchInterpretationSchema,
      system: SYSTEM_PROMPT,
      prompt: query,
      // Low temperature: this is extraction, not creative writing.
      temperature: 0.1,
    })
    return object
  } catch {
    return { keywords: [query] }
  }
}
