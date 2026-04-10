import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export async function buildContextSnapshot(
  container: any,
  contextType: string,
  contextId: string
): Promise<{ snapshot: Record<string, any>; formattedText: string }> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

  switch (contextType) {
    case "production_run": {
      const { data: runs } = await query.graph({
        entity: "production_runs",
        fields: ["id", "status", "run_type", "quantity", "design_id", "partner_id", "started_at", "finished_at", "produced_quantity", "rejected_quantity"],
        filters: { id: contextId },
      })
      const run = runs?.[0]
      if (!run) throw new Error(`Production run ${contextId} not found`)

      let designName = "Unknown Design"
      if (run.design_id) {
        try {
          const designService = container.resolve("design") as any
          const design = await designService.retrieveDesign(run.design_id)
          designName = design?.name || design?.title || run.design_id
        } catch { /* fallback */ }
      }

      const snapshot = {
        id: run.id,
        status: run.status,
        design_name: designName,
        run_type: run.run_type,
        quantity: run.quantity,
        started_at: run.started_at,
        finished_at: run.finished_at,
        produced_quantity: run.produced_quantity,
        rejected_quantity: run.rejected_quantity,
      }

      const lines = [
        `📋 *Production Run*`,
        `*Run ID:* ${run.id}`,
        `*Design:* ${designName}`,
        `*Status:* ${run.status}`,
        `*Type:* ${run.run_type || "production"}`,
      ]
      if (run.quantity) lines.push(`*Quantity:* ${run.quantity}`)
      if (run.produced_quantity != null) lines.push(`*Produced:* ${run.produced_quantity}`)

      return { snapshot, formattedText: lines.join("\n") }
    }

    case "inventory_item": {
      const { data: items } = await query.graph({
        entity: "inventory_items",
        fields: ["id", "title", "sku", "metadata"],
        filters: { id: contextId },
      })
      const item = items?.[0]
      if (!item) throw new Error(`Inventory item ${contextId} not found`)

      const snapshot = {
        id: item.id,
        title: item.title,
        sku: item.sku,
      }

      const lines = [
        `📦 *Inventory Item*`,
        `*Title:* ${item.title || "N/A"}`,
        `*SKU:* ${item.sku || "N/A"}`,
      ]

      return { snapshot, formattedText: lines.join("\n") }
    }

    default:
      throw new Error(`Unsupported context type: ${contextType}`)
  }
}
