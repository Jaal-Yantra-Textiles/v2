import { z } from "@medusajs/framework/zod"

/**
 * Query schema for GET /store/ai/search.
 *
 * `query` is the customer's natural-language search phrase (e.g.
 * "soft cotton dress under 2000 rupees"). Capped at 200 chars so the
 * URL stays well within browser/proxy limits AND the LLM token cost
 * stays predictable.
 *
 * `limit` is how many products to return after filtering. 6 is a good
 * default for an inline dropdown; up to 24 for a full results page.
 *
 * GET (rather than POST) because the operation is idempotent — same
 * query → same results — which lets us cache popular searches at the
 * CDN later. Matches the SDK's compliant `client.fetch(..., { query })`
 * convention.
 */
export const StoreAiSearchSchema = z.object({
  query: z.string().trim().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(24).optional().default(6),
})

export type StoreAiSearchReq = z.infer<typeof StoreAiSearchSchema>
