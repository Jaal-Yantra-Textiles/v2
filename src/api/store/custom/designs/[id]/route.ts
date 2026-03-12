import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import updateDesignWorkflow from "../../../../../workflows/designs/update-design"
import { linkDesignInventoryWorkflow } from "../../../../../workflows/designs/inventory/link-inventory"
import { linkDesignPartnerWorkflow } from "../../../../../workflows/designs/partner/link-design-to-partner"
import designCustomerLink from "../../../../../links/design-customer-link"

/**
 * GET /store/custom/designs/:id
 *
 * Returns full design detail for the authenticated customer who owns it.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  try {
    const customerId = req.auth_context?.actor_id
    const designId = req.params.id

    if (!customerId) {
      res.status(401).json({ message: "Customer authentication required" })
      return
    }

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    // Verify ownership
    const { data: links } = await query.graph({
      entity: designCustomerLink.entryPoint,
      filters: { customer_id: customerId, design_id: designId },
      fields: ["design_id"],
    })

    if (!links?.length) {
      res.status(404).json({ message: "Design not found" })
      return
    }

    const { data: designs } = await query.graph({
      entity: "design",
      filters: { id: designId },
      fields: [
        "*",
        "inventory_items.*",
        "partners.*",
        "specifications.*",
        "colors.*",
        "size_sets.*",
      ],
    })

    res.status(200).json({ design: designs?.[0] })
  } catch (error) {
    console.error("[Store] Error fetching design:", error)
    res.status(500).json({
      message: "Failed to fetch design",
      error: error instanceof Error ? error.message : "Unknown error",
    })
  }
}

interface StoreUpdateDesignBody {
  name?: string
  description?: string
  thumbnail_url?: string
  metadata?: Record<string, any>
  moodboard?: Record<string, any>
  color_palette?: Array<{ name: string; code: string }>
  custom_sizes?: Record<string, Record<string, number>>
  tags?: string[]
  // Inventory — replaces existing links if provided
  inventory_ids?: string[]
  inventory_items?: Array<{
    inventoryId: string
    plannedQuantity?: number
    locationId?: string
    metadata?: Record<string, any>
  }>
  // Partner — replaces existing link if provided
  partner_id?: string
}

/**
 * PUT /store/custom/designs/:id
 *
 * Updates an existing design owned by the authenticated customer.
 * Customers can only update their own designs.
 * Inventory/partner links are re-created if supplied.
 */
export async function PUT(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  try {
    const customerId = req.auth_context?.actor_id
    const designId = req.params.id

    if (!customerId) {
      res.status(401).json({ message: "Customer authentication required" })
      return
    }

    // Verify the design belongs to this customer
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: links } = await query.graph({
      entity: designCustomerLink.entryPoint,
      filters: { customer_id: customerId, design_id: designId },
      fields: ["design_id"],
    })

    if (!links?.length) {
      res.status(404).json({ message: "Design not found" })
      return
    }

    const body = req.body as StoreUpdateDesignBody

    // Update core design fields (only pass fields that were provided)
    const updateInput: Record<string, any> = { id: designId }
    if (typeof body.name !== "undefined") updateInput.name = body.name
    if (typeof body.description !== "undefined") updateInput.description = body.description
    if (typeof body.thumbnail_url !== "undefined") updateInput.thumbnail_url = body.thumbnail_url
    if (typeof body.metadata !== "undefined") updateInput.metadata = body.metadata
    if (typeof body.moodboard !== "undefined") updateInput.moodboard = body.moodboard
    if (typeof body.color_palette !== "undefined") updateInput.color_palette = body.color_palette
    if (typeof body.custom_sizes !== "undefined") updateInput.custom_sizes = body.custom_sizes
    if (typeof body.tags !== "undefined") updateInput.tags = body.tags

    const { errors: updateErrors } = await updateDesignWorkflow(req.scope).run({
      input: updateInput as any,
    })

    if (updateErrors?.length) {
      console.error("[Store] Error updating design:", updateErrors)
      res.status(500).json({ message: "Failed to update design", errors: updateErrors })
      return
    }

    // Re-link inventory if provided
    if (body.inventory_ids?.length || body.inventory_items?.length) {
      try {
        await linkDesignInventoryWorkflow(req.scope).run({
          input: {
            design_id: designId,
            inventory_ids: body.inventory_ids,
            inventory_items: body.inventory_items?.map((item) => ({
              inventory_id: item.inventoryId,
              planned_quantity: item.plannedQuantity,
              location_id: item.locationId,
              metadata: item.metadata,
            })),
          },
        })
      } catch (err) {
        console.warn("[Store] Warning: Failed to re-link inventory:", err)
      }
    }

    // Re-link partner if provided
    if (body.partner_id) {
      try {
        await linkDesignPartnerWorkflow(req.scope).run({
          input: {
            design_id: designId,
            partner_ids: [body.partner_id],
          },
        })
      } catch (err) {
        console.warn("[Store] Warning: Failed to re-link partner:", err)
      }
    }

    // Return the updated design with relations
    const { data: designs } = await query.graph({
      entity: "design",
      filters: { id: designId },
      fields: ["*", "inventory_items.*", "partners.*"],
    })

    res.status(200).json({ design: designs?.[0] })
  } catch (error) {
    console.error("[Store] Error updating design:", error)
    res.status(500).json({
      message: "Failed to update design",
      error: error instanceof Error ? error.message : "Unknown error",
    })
  }
}
