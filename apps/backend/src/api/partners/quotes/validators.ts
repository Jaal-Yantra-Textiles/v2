import { z } from "@medusajs/framework/zod"

const QuoteLine = z.object({
  variant_id: z.string().min(1),
  quantity: z.number().int().positive(),
  position: z.number().int().nonnegative().optional(),
  note: z.string().nullish(),
})

export const PartnerMintQuoteReq = z.object({
  buyer_email: z.string().email(),
  recipient_name: z.string().nullish(),
  recipient_company: z.string().nullish(),
  partner_note: z.string().nullish(),

  /** A quote is a basket. A single-product quote is a one-line quote. */
  lines: z.array(QuoteLine).min(1),

  destination_country_code: z.string().min(2),
  destination_postal_code: z.string().nullish(),
  destination_city: z.string().nullish(),

  currency_code: z.string().min(3),
  region_id: z.string().nullish(),
  carrier: z.string().optional(),

  /** Drives `price_list.ends_at`, so expiry is native rather than swept. */
  ttl_days: z.number().int().positive().max(365).optional(),
})
