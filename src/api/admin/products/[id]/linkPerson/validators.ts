import { z } from "@medusajs/framework/zod"

export const LinkPersonValidator = z.object({
  personId: z.string(),
})

export const UnlinkPersonValidator = z.object({
  personId: z.string(),
})

export type LinkPersonValidator = z.infer<typeof LinkPersonValidator>
export type UnlinkPersonValidator = z.infer<typeof UnlinkPersonValidator>
