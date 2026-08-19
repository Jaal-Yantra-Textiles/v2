import { z } from "zod"

/**
 * #1349 — the made-to-spec add-to-cart body.
 *
 * Shape only. WHICH colour is orderable is decided in `lib.ts` against the
 * partner's published palette — zod cannot know a palette that lives in the
 * database, and a schema that pretended to would be a second, weaker copy of
 * the rule.
 */
export const StoreMadeToSpecReq = z.object({
  variant_id: z.string().min(1),
  quantity: z.number().int().positive().max(100).optional(),
  color: z.string().min(1).max(200).nullish(),
  note: z.string().max(500).nullish(),
  // Keyed by the option's `key`, valued by the chosen value's label — both as
  // published by GET /store/products/:id/spec. WHICH values are orderable is
  // decided in `lib.ts` against the stored option groups, for the same reason
  // the palette is: zod cannot see the database.
  options: z.record(z.string().min(1).max(60), z.string().min(1).max(160)).nullish(),
})

export type StoreMadeToSpecReqType = z.infer<typeof StoreMadeToSpecReq>
