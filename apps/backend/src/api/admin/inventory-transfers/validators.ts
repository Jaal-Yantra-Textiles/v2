import { z } from "@medusajs/framework/zod"

/**
 * #2144 — moving material we already own between two locations.
 *
 * Every field that decides where stock ends up is required. The receipt route's
 * body is optional by contrast, because "all of it turned up" is the ordinary
 * case and making someone retype the quantity to say so is how a count step
 * ends up skipped.
 */
export const createMaterialTransferSchema = z.object({
  inventory_item_id: z.string().min(1),
  from_location_id: z.string().min(1),
  to_location_id: z.string().min(1),
  /** Cloth is metres. `.positive()` rather than `.int()` — 26.5 is a real hop. */
  quantity: z.number().positive(),
  reason: z.enum(["finishing", "qc", "packaging", "stock", "other"]).optional(),
  /** The inventory order this material arrived on, kept for the trail. */
  source_inventory_order_id: z.string().min(1).optional(),
  notes: z.string().optional(),
})

export const receiveMaterialTransferSchema = z.object({
  /**
   * What was counted at the far end. Omit to accept what was sent.
   *
   * `.nonnegative()`, not `.positive()`: 0 is a legitimate answer — "the box
   * came and was empty" is a fact worth recording, and the transfer is still
   * closed by it.
   */
  received_quantity: z.number().nonnegative().optional(),
  notes: z.string().optional(),
})

export type CreateMaterialTransferReq = z.infer<typeof createMaterialTransferSchema>
export type ReceiveMaterialTransferReq = z.infer<typeof receiveMaterialTransferSchema>
