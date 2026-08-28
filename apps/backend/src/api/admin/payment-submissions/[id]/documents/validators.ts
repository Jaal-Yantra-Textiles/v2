import { z } from "zod"

/**
 * Attaching documents to a payout.
 *
 * `documents` is an APPEND — the route adds to what is already stored rather
 * than replacing it. A schema that accepted the full array would make "attach
 * one receipt" a read-modify-write the caller has to get right, and a caller
 * that got it wrong would silently drop every earlier attachment.
 */
export const AdminAttachSubmissionDocumentsReq = z.object({
  documents: z
    .array(
      z.object({
        /** The uploaded file's id, used to de-duplicate a re-attached file. */
        id: z.string().optional(),
        url: z.string().min(1),
        filename: z.string().optional(),
        mimeType: z.string().optional(),
        size: z.number().nonnegative().optional(),
      })
    )
    .min(1, "At least one document is required"),
})

export type AdminAttachSubmissionDocumentsReq = z.infer<
  typeof AdminAttachSubmissionDocumentsReq
>
