import zod, { z } from "zod"

export const LinkPersonValidator = zod.object({
  personId: z.string(),
})

export const UnlinkPersonValidator = zod.object({
  personId: z.string(),
})

export type LinkPersonValidator = z.infer<typeof LinkPersonValidator>
export type UnlinkPersonValidator = z.infer<typeof UnlinkPersonValidator>
