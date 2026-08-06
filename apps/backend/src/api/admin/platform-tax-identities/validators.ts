import { z } from "zod"

/**
 * Export LUT payloads (#1216).
 *
 * The validity window is the load-bearing part: an LUT covers ONE financial year
 * and `valid_to` is what makes an expired one stop justifying `"B"`. So both
 * bounds are required (an open-ended LUT would never expire, which is the exact
 * silent over-claim this model prevents) and the order is enforced.
 */

const isoDate = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(new Date(v).getTime()), {
    message: "must be a valid date",
  })

/** e.g. "2026-27" — the Indian financial year as filed on the GST portal. */
const financialYear = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}$/, "must look like \"2026-27\"")

export const CreateExportLutSchema = z
  .object({
    arn: z.string().trim().min(1, "ARN is required"),
    financial_year: financialYear,
    valid_from: isoDate,
    valid_to: isoDate,
    filed_on: isoDate.optional(),
    notes: z.string().trim().max(2000).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => new Date(v.valid_to) > new Date(v.valid_from), {
    message: "valid_to must be after valid_from",
    path: ["valid_to"],
  })

export const UpdateExportLutSchema = z
  .object({
    arn: z.string().trim().min(1).optional(),
    financial_year: financialYear.optional(),
    valid_from: isoDate.optional(),
    valid_to: isoDate.optional(),
    filed_on: isoDate.nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .refine(
    (v) =>
      // Only checkable when both bounds are in the same patch; a one-sided edit
      // is validated against the stored row by the handler.
      !v.valid_from ||
      !v.valid_to ||
      new Date(v.valid_to) > new Date(v.valid_from),
    { message: "valid_to must be after valid_from", path: ["valid_to"] }
  )
