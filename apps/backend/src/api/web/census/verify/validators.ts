import { z } from "zod";

/**
 * POST /web/census/verify  (#1038)
 * Verify/lookup a weaver against the handloom census.
 *
 * `census_id` is required because the PUBLIC core is keyed by it and carries no
 * secondary index (a name-only scan of millions of masked records is not a public
 * endpoint). `name` is an optional confirmation factor. `aadhaar` is accepted +
 * hashed for audit/forward-compat, but Aadhaar matching is NOT yet backed by data
 * — Aadhaar (if collected at all) lives only in the encrypted sensitive core, not
 * the public core this endpoint reads (see issue #1038 open questions).
 */
export const VerifyWeaverSchema = z
  .object({
    census_id: z.string().min(1),
    name: z.string().min(1).optional(),
    // 12 digits, optional spaces — normalized before hashing; never stored/echoed.
    aadhaar: z
      .string()
      .regex(/^\d[\d\s]{10,20}\d$/u, "aadhaar must be a 12-digit number")
      .optional(),
  })
  .strict();

export type VerifyWeaverInput = z.infer<typeof VerifyWeaverSchema>;
