import { z } from "zod"

/**
 * #1531 — asking partners what they can make for a design.
 *
 * `categories` restricts the wizard to some spec categories; absent means every
 * category, which is the ordinary case. Kept `.optional()` rather than defaulted
 * so "not stated" and "explicitly none" stay distinguishable.
 */
export const AdminPostDesignInquiryReq = z.object({
  partner_ids: z.array(z.string().min(1)).min(1),
  title: z.string().min(1).optional(),
  brief_note: z.string().optional(),
  reference_media_ids: z.array(z.string().min(1)).optional(),
  categories: z.array(z.string().min(1)).optional(),
})
export type AdminPostDesignInquiryReq = z.infer<typeof AdminPostDesignInquiryReq>

/**
 * Preview needs no partners: its whole purpose is seeing the questions BEFORE
 * anyone is asked anything.
 */
export const AdminPostDesignInquiryPreviewReq = z.object({
  categories: z.array(z.string().min(1)).optional(),
})
export type AdminPostDesignInquiryPreviewReq = z.infer<
  typeof AdminPostDesignInquiryPreviewReq
>

export const AdminPostCloseDesignInquiryReq = z.object({
  chosen_partner_id: z.string().min(1).nullish(),
  chosen_role: z.string().min(1).optional(),
})
export type AdminPostCloseDesignInquiryReq = z.infer<
  typeof AdminPostCloseDesignInquiryReq
>
