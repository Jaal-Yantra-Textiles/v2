/**
 * Pure helpers that shape a public-safe "production story" for a design.
 *
 * The v1 storefront told a design's story through its task list
 * (`designs.tasks.*`). Work is now tracked as PRODUCTION RUNS, so the story
 * adapts to: production runs (status/activity) + energy/consumption + people
 * + raw materials.
 *
 * PUBLIC-SAFE: this shape intentionally OMITS all money (per-unit cost,
 * partner cost estimates, cost_breakdown amounts). It surfaces only the
 * STORY facts — run status, energy used (kWh / L / m³), labor hours,
 * materials consumed, and who made it. Keep it money-free; the admin/partner
 * surfaces own the cost view.
 */

export type ProductionStoryActivity = {
  id: string
  activity_type: string
  kind: string
  summary: string | null
  created_at: string | null
}

export type ProductionStoryRun = {
  id: string
  status: string
  run_type: string
  quantity: number | null
  produced_quantity: number | null
  rejected_quantity: number | null
  started_at: string | null
  finished_at: string | null
  completed_at: string | null
  created_at: string | null
  activity: ProductionStoryActivity[]
}

export type EnergySummary = {
  electricity_kwh: number
  water_liters: number
  gas_cubic_meters: number
}

export type MaterialConsumed = {
  raw_material_id: string | null
  name: string | null
  unit_of_measure: string
  quantity: number
}

export type ConsumptionSummary = {
  energy: EnergySummary
  labor_hours: number
  materials_consumed: MaterialConsumed[]
  total_logs: number
}

export type StoryPerson = { id: string; name: string | null; role: string | null }
export type StoryPartner = { id: string; name: string | null }
export type StoryMaterial = {
  id: string
  name: string | null
  composition: string | null
  color: string | null
  media: unknown
  material_type: string | null
}

export type ProductionStory = {
  design_id: string
  runs: ProductionStoryRun[]
  consumption: ConsumptionSummary
  people: StoryPerson[]
  partners: StoryPartner[]
  materials: StoryMaterial[]
}

// consumption_type buckets — mirror src/modules/production_runs/cost-summary.ts
const MATERIAL_TYPES = ["sample", "production", "wastage"]
const ENERGY_ELECTRICITY = "energy_electricity"
const ENERGY_WATER = "energy_water"
const ENERGY_GAS = "energy_gas"
const LABOR = "labor"

type RawLog = {
  consumption_type?: string | null
  quantity?: number | null
  unit_of_measure?: string | null
  raw_material_id?: string | null
}

/**
 * Aggregate consumption logs into a public-safe summary (no money).
 * - energy_* → energy totals (kWh / L / m³, by the row's own quantity)
 * - labor    → labor_hours
 * - sample/production/wastage → materials_consumed, grouped by
 *   (raw_material_id + unit_of_measure)
 */
export function summarizeConsumption(
  logs: RawLog[],
  rawMaterialNames: Record<string, string | null> = {}
): ConsumptionSummary {
  const energy: EnergySummary = {
    electricity_kwh: 0,
    water_liters: 0,
    gas_cubic_meters: 0,
  }
  let labor_hours = 0
  const materialGroups = new Map<string, MaterialConsumed>()

  for (const log of logs || []) {
    const type = log.consumption_type ?? ""
    const qty = typeof log.quantity === "number" ? log.quantity : 0

    if (type === ENERGY_ELECTRICITY) {
      energy.electricity_kwh += qty
    } else if (type === ENERGY_WATER) {
      energy.water_liters += qty
    } else if (type === ENERGY_GAS) {
      energy.gas_cubic_meters += qty
    } else if (type === LABOR) {
      labor_hours += qty
    } else if (MATERIAL_TYPES.includes(type)) {
      const rmId = log.raw_material_id ?? null
      const uom = log.unit_of_measure ?? "Other"
      const key = `${rmId ?? "unknown"}::${uom}`
      const existing = materialGroups.get(key)
      if (existing) {
        existing.quantity += qty
      } else {
        materialGroups.set(key, {
          raw_material_id: rmId,
          name: rmId ? rawMaterialNames[rmId] ?? null : null,
          unit_of_measure: uom,
          quantity: qty,
        })
      }
    }
  }

  return {
    energy,
    labor_hours,
    materials_consumed: Array.from(materialGroups.values()),
    total_logs: (logs || []).length,
  }
}

type RawRun = Record<string, any>
type RawActivity = Record<string, any>
type RawPersonLink = Record<string, any>
type RawPartner = Record<string, any>
type RawInventoryItem = Record<string, any>

const toIso = (v: any): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v)

function personName(p: RawPersonLink): string | null {
  const first = p?.first_name ?? ""
  const last = p?.last_name ?? ""
  const full = `${first} ${last}`.trim()
  return full.length ? full : null
}

export type BuildStoryInput = {
  designId: string
  runs: RawRun[]
  activitiesByRun: Record<string, RawActivity[]>
  logs: RawLog[]
  /** rows from the designs-person link entryPoint (person + extra `role`) */
  personLinks: RawPersonLink[]
  partners: RawPartner[]
  inventoryItems: RawInventoryItem[]
}

/** Assemble the full public-safe production story. */
export function buildProductionStory(input: BuildStoryInput): ProductionStory {
  const {
    designId,
    runs,
    activitiesByRun,
    logs,
    personLinks,
    partners,
    inventoryItems,
  } = input

  // Materials: flatten inventory_items.raw_materials, de-dup by raw material id
  const materialMap = new Map<string, StoryMaterial>()
  const rawMaterialNames: Record<string, string | null> = {}
  for (const inv of inventoryItems || []) {
    // raw_materials may arrive as a single object (belongsTo) or a list —
    // normalize so de-dup works either way.
    const rawRms = inv?.raw_materials
    const rms = Array.isArray(rawRms) ? rawRms : rawRms ? [rawRms] : []
    for (const rm of rms) {
      if (!rm?.id || materialMap.has(rm.id)) continue
      rawMaterialNames[rm.id] = rm.name ?? null
      materialMap.set(rm.id, {
        id: rm.id,
        name: rm.name ?? null,
        composition: rm.composition ?? null,
        color: rm.color ?? null,
        media: rm.media ?? null,
        material_type: rm.material_type?.name ?? null,
      })
    }
  }

  const storyRuns: ProductionStoryRun[] = (runs || []).map((r) => ({
    id: r.id,
    status: r.status,
    run_type: r.run_type,
    quantity: r.quantity ?? null,
    produced_quantity: r.produced_quantity ?? null,
    rejected_quantity: r.rejected_quantity ?? null,
    started_at: toIso(r.started_at),
    finished_at: toIso(r.finished_at),
    completed_at: toIso(r.completed_at),
    created_at: toIso(r.created_at),
    activity: (activitiesByRun[r.id] || []).map((a) => ({
      id: a.id,
      activity_type: a.activity_type,
      kind: a.kind,
      summary: a.summary ?? null,
      created_at: toIso(a.created_at),
    })),
  }))

  const people: StoryPerson[] = (personLinks || [])
    .map((link) => {
      const person = link?.person ?? link
      if (!person?.id) return null
      return {
        id: person.id,
        name: personName(person),
        role: link?.role ?? null,
      }
    })
    .filter(Boolean) as StoryPerson[]

  const storyPartners: StoryPartner[] = (partners || [])
    .filter((p) => p?.id)
    .map((p) => ({ id: p.id, name: p.name ?? null }))

  return {
    design_id: designId,
    runs: storyRuns,
    consumption: summarizeConsumption(logs, rawMaterialNames),
    people,
    partners: storyPartners,
    materials: Array.from(materialMap.values()),
  }
}
