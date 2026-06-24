import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import designsPersonLink from "../../../../../../links/designs-person-link"
import { buildProductionStory } from "./build-story"

/**
 * GET /store/custom/designs/:id/production-story
 *
 * PUBLIC, read-only "how this was made" story for a design. Mirrors the
 * public exposure already granted to product → designs.* on /store/products,
 * so no customer auth is required. Returns a money-free, public-safe subset:
 * production runs (status/activity) + energy/consumption summary + people +
 * raw materials. See build-story.ts for the shape + the public-safe contract.
 *
 * Production runs link to a design by the flat `production_run.design_id`
 * column (NOT a module link), so they're fetched by design_id directly rather
 * than via a `designs.*` relation field path.
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const designId = req.params.id
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    // 1. Design must exist + carry its people / partners / materials story bits.
    const { data: designs } = await query.graph({
      entity: "design",
      filters: { id: designId },
      fields: [
        "id",
        "name",
        "status",
        "partners.id",
        "partners.name",
        "inventory_items.id",
        "inventory_items.raw_materials.id",
        "inventory_items.raw_materials.name",
        "inventory_items.raw_materials.composition",
        "inventory_items.raw_materials.color",
        "inventory_items.raw_materials.media",
        "inventory_items.raw_materials.material_type.id",
        "inventory_items.raw_materials.material_type.name",
      ],
    })

    const design = designs?.[0]
    if (!design) {
      res.status(404).json({ message: "Design not found" })
      return
    }

    // 2. People — via the designs-person link (carries the `role` extra column).
    const { data: personLinks } = await query.graph({
      entity: designsPersonLink.entryPoint,
      filters: { design_id: designId },
      fields: [
        "role",
        "person.id",
        "person.first_name",
        "person.last_name",
      ],
    })

    // 3. Production runs by design_id (flat field, not a relation).
    const { data: runs } = await query.graph({
      entity: "production_runs",
      filters: { design_id: designId },
      fields: [
        "id",
        "status",
        "run_type",
        "quantity",
        "produced_quantity",
        "rejected_quantity",
        "started_at",
        "finished_at",
        "completed_at",
        "created_at",
      ],
    })

    // 4. Lifecycle activity for those runs (public timeline).
    const runIds = (runs || []).map((r: any) => r.id)
    const activitiesByRun: Record<string, any[]> = {}
    if (runIds.length) {
      const { data: activities } = await query.graph({
        entity: "production_run_activity",
        filters: { production_run_id: runIds },
        fields: [
          "id",
          "production_run_id",
          "activity_type",
          "kind",
          "summary",
          "created_at",
        ],
      })
      for (const a of activities || []) {
        const key = (a as any).production_run_id
        if (!activitiesByRun[key]) activitiesByRun[key] = []
        activitiesByRun[key].push(a)
      }
    }

    // 5. Consumption logs by design_id (energy / labor / materials). No money.
    const { data: logs } = await query.graph({
      entity: "consumption_log",
      filters: { design_id: designId },
      fields: [
        "id",
        "consumption_type",
        "quantity",
        "unit_of_measure",
        "raw_material_id",
      ],
    })

    const production_story = buildProductionStory({
      designId,
      runs: runs || [],
      activitiesByRun,
      logs: logs || [],
      personLinks: personLinks || [],
      partners: (design as any).partners || [],
      inventoryItems: (design as any).inventory_items || [],
    })

    res.status(200).json({ production_story })
  } catch (error) {
    logger.error("[Store] Error building production story:", error as Error)
    res.status(500).json({
      message: "Failed to build production story",
      error: error instanceof Error ? error.message : "Unknown error",
    })
  }
}
