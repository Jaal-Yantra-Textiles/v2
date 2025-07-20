import { z } from "zod"

export const AdminGetPartnersParamsSchema = z.object({
  fields: z.preprocess((val) => {
    if (typeof val === 'string') {
      return val.split(',')
    }
    return val
  }, z.array(z.string()).optional()),
  offset: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  q: z.string().optional(),
  name: z.string().optional(),
  handle: z.string().optional(),
  status: z.enum(['active', 'inactive', 'pending']).optional(),
  is_verified: z.enum(['true', 'false']).optional(),
})

export type AdminGetPartnersParamsType = z.infer<typeof AdminGetPartnersParamsSchema>

export const retrieveTransformQueryConfig = {
  defaults: ["*", "people.*"],
  isList: true,
}
