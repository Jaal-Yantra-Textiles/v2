import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import designsPersonLink from "../../../../../links/designs-person-link"
import { buildProductionStory, ProductionStory } from "./build-story"

export type LoadedDesignStory = {
  design: { id: string; name?: string | null }
  production_story: ProductionStory
}

/**
 * Load a design and build its public-safe production story. Shared by the
 * public GET (the product page) and the email-gated share (the full story by
 * mail), so both tell exactly the same story. `null` when the design does not
 * exist.
 */
export async function loadDesignStory(
  scope: { resolve: (key: string) => any },
  designId: string
): Promise<LoadedDesignStory | null> {
  const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)

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
    return null
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

  return { design: { id: design.id, name: (design as any).name ?? null }, production_story }
}
