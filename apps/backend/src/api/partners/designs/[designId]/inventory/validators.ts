import { z } from "@medusajs/framework/zod"

// Legacy consumption-report shape (kept for the deprecated path's
// type; the BOM-link POST below supersedes it).
export const PartnerDesignInventorySchema = z.object({
  inventory_used: z.preprocess((val) => {
    if (typeof val === "string") {
      const num = Number(val)
      return Number.isNaN(num) ? val : num
    }
    return val
  }, z.number().finite()),
})

export type PartnerDesignInventoryReq = z.infer<typeof PartnerDesignInventorySchema>

// Roadmap #6 Phase 2 — partner links GLOBAL inventory items to their
// own design (the bill-of-materials). Mirrors the admin
// `AdminPostDesignInventoryReq` wire shape. Location scoping to the
// partner's own warehouse is enforced in the handler.

const inventoryLinkItemSchema = z.object({
  inventoryId: z.string(),
  plannedQuantity: z.number().int().optional(),
  locationId: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

export const PartnerPostDesignInventoryReq = z
  .object({
    inventoryIds: z.array(z.string()).optional(),
    inventoryItems: z.array(inventoryLinkItemSchema).optional(),
  })
  .refine(
    (body) =>
      (body.inventoryIds && body.inventoryIds.length > 0) ||
      (body.inventoryItems && body.inventoryItems.length > 0),
    { message: "Provide at least one inventory id or inventory item payload." }
  )

export type PartnerPostDesignInventoryReq = z.infer<
  typeof PartnerPostDesignInventoryReq
>

export const PartnerPatchDesignInventoryLinkReq = z
  .object({
    plannedQuantity: z.number().int().nullable().optional(),
    locationId: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.any()).nullable().optional(),
  })
  .refine(
    (body) =>
      body.plannedQuantity !== undefined ||
      body.locationId !== undefined ||
      body.metadata !== undefined,
    { message: "Provide at least one field to update." }
  )

export type PartnerPatchDesignInventoryLinkReq = z.infer<
  typeof PartnerPatchDesignInventoryLinkReq
>

export const PartnerDeleteDesignInventoryReq = z.object({
  inventoryIds: z.array(z.string()).min(1),
})

export type PartnerDeleteDesignInventoryReq = z.infer<
  typeof PartnerDeleteDesignInventoryReq
>
