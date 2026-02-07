import { z } from "@medusajs/framework/zod"
import { EditProductMediaSchema, ProductCreateSchema } from "./constants"

export type ProductCreateSchemaType = z.infer<typeof ProductCreateSchema>

export type EditProductMediaSchemaType = z.infer<typeof EditProductMediaSchema>
