import { z } from "@medusajs/framework/zod";

const inventoryLinkItemSchema = z.object({
  inventoryId: z.string(),
  plannedQuantity: z.number().int().optional(),
  locationId: z.string().optional(),
  metadata: z.record(z.any()).optional(),
})

export const AdminPostDesignInventoryReq = z
  .object({
    inventoryIds: z.array(z.string()).optional(),
    inventoryItems: z.array(inventoryLinkItemSchema).optional(),
  })
  .refine(
    (body) => {
      return (
        (body.inventoryIds && body.inventoryIds.length > 0) ||
        (body.inventoryItems && body.inventoryItems.length > 0)
      )
    },
    { message: "Provide at least one inventory id or inventory item payload." }
  )

export type AdminPostDesignInventoryReq = z.infer<typeof AdminPostDesignInventoryReq>

export const AdminDeleteDesignInventoryReq = z.object({
  inventoryIds: z.array(z.string()),
})

export type AdminDeleteDesignInventoryReq = z.infer<typeof AdminDeleteDesignInventoryReq>

export const AdminPatchDesignInventoryLinkReq = z
  .object({
    plannedQuantity: z.number().int().nullable().optional(),
    locationId: z.string().nullable().optional(),
    metadata: z.record(z.any()).nullable().optional(),
  })
  .refine(
    (body) =>
      body.plannedQuantity !== undefined ||
      body.locationId !== undefined ||
      body.metadata !== undefined,
    { message: "Provide at least one field to update." }
  )

export type AdminPatchDesignInventoryLinkReq = z.infer<typeof AdminPatchDesignInventoryLinkReq>