import { z } from "zod"

export const AdminPostPersonTypesReq = z.object({
  personTypeIds: z.array(z.string())
    .min(1, {
      message: "At least one personType ID must be provided",
    })
    .transform(ids => {
      // Remove duplicates by converting to Set and back to array
      return [...new Set(ids)]
    })
})

export type AdminPostPersonTypesReq = z.infer<typeof AdminPostPersonTypesReq>