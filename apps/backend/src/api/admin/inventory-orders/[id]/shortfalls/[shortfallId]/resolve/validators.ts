import { z } from "@medusajs/framework/zod"

/** #2289 S3 — what was done about a short delivery. */
export const resolveShortfallSchema = z.object({
  note: z.string().min(1, "Say what was done: re-sent, credited, written off…"),
})

export type ResolveShortfall = z.infer<typeof resolveShortfallSchema>
